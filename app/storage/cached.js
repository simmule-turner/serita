// Offline cache and queued saves around a remote provider (GitHub, WebDAV).
// It has the same read/write/list/remove shape as any provider, plus sync(), pending(),
// resolve() and discard(). Each cache record is:
//   { base: { text, version } | null,   the last copy known to be on the server
//     local?: string, token?: string,   an unsynced local edit and the version token handed out for it
//     deleted?: true,                   a delete waiting to be sent
//     seq: number }
// NetworkUnavailable and a server error (status 500 or more) mean the server cannot be reached for now: writes and deletes are queued.
// Any other error is real and is thrown, never queued.

import { NetworkUnavailable } from '../interface/contract.js';
import { byteLength } from '../../core/bytes.js';

/**
 * @typedef {{ path: string, base: string | null, mine: string | null, theirs: string | null, theirsVersion: string | null }} SyncConflict
 * @typedef {{ synced: string[], conflicts: SyncConflict[], pending: number, offline: boolean, error?: string }} SyncResult
 */

/** The server cannot take the request now: no network, or it answered with a 5xx status. */
const unreachable = (e) => e instanceof NetworkUnavailable || (typeof e?.status === 'number' && e.status >= 500);

const isDirty = (rec) => rec !== undefined && (rec.local !== undefined || rec.deleted === true);

/**
 * @param {{ remote: import('./local.js').Provider, cache: import('./local.js').Kv, isOnline?: () => boolean }} opts
 */
export function createCachedProvider({ remote, cache, isOnline = () => true }) {
  const attempt = (fn) => {
    if (!isOnline()) throw new NetworkUnavailable();
    return fn();
  };
  const put = (path, value) => cache.update(path, () => ({ write: value, result: undefined }));
  const drop = (path) => cache.update(path, () => ({ remove: true, result: undefined }));

  const provider = {
    /** `cached` answers from the saved copy when there is one, without asking the server (the caller checks later). */
    async read(path, { cached = false } = {}) {
      const rec = await cache.get(path);
      if (rec?.deleted) return null;
      if (rec?.local !== undefined) return { text: rec.local, version: rec.token };
      if (cached && rec?.base) return { text: rec.base.text, version: rec.base.version };
      try {
        const r = await attempt(() => remote.read(path));
        if (r) await put(path, { base: r, seq: rec?.seq ?? 0 });
        else if (rec) await drop(path);
        return r;
      } catch (e) {
        if (unreachable(e) && rec?.base) return { text: rec.base.text, version: rec.base.version };
        throw e;
      }
    },

    async write(path, text, { baseVersion } = {}) {
      const rec = await cache.get(path);
      if (rec?.local !== undefined && baseVersion !== rec.token) {
        return { ok: false, conflict: { theirs: rec.local, theirsVersion: rec.token } };
      }
      if (rec?.deleted && baseVersion !== undefined) return { ok: false, conflict: { theirs: null, theirsVersion: null } };
      const pushBase = isDirty(rec) ? rec.base?.version : baseVersion;
      try {
        const r = await attempt(() => remote.write(path, text, { baseVersion: pushBase }));
        if (r.ok) await put(path, { base: { text, version: r.version }, seq: rec?.seq ?? 0 });
        return r;
      } catch (e) {
        if (!unreachable(e)) throw e;
        const seq = (rec?.seq ?? 0) + 1;
        const token = `local:${seq}`;
        const base = rec?.base ?? (baseVersion !== undefined ? { text: null, version: baseVersion } : null);
        await put(path, { base, local: text, token, seq });
        return { ok: true, version: token };
      }
    },

    async entries(prefix = '', options) {
      const keys = (await cache.keys()).filter((k) => k.startsWith(prefix));
      const recs = new Map(await Promise.all(keys.map(async (k) => [k, await cache.get(k)])));
      const sizeOf = (r) => { const t = r.local ?? r.base?.text; return typeof t === 'string' ? byteLength(t) : null; };
      const deleted = new Set(keys.filter((k) => recs.get(k).deleted));
      let found;
      try {
        found = await attempt(() => remote.entries(prefix, options));
      } catch (e) {
        if (!unreachable(e)) throw e;
        found = keys.map((path) => ({ path, size: sizeOf(recs.get(path)) }));
      }
      const byPath = new Map(found.map((e) => [e.path, e]));
      for (const [path, r] of recs) {
        const queuedNew = r.base === null && r.local !== undefined;
        if (queuedNew || (r.local !== undefined && byPath.has(path))) byPath.set(path, { path, size: sizeOf(r) });
      }
      return [...byPath.values()].filter((e) => !deleted.has(e.path)).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    },

    async list(prefix = '') {
      return (await provider.entries(prefix)).map((e) => e.path);
    },

    async remove(path) {
      const rec = await cache.get(path);
      try {
        await attempt(() => remote.remove(path));
        await drop(path);
      } catch (e) {
        if (!unreachable(e)) throw e;
        if (rec?.base?.version) await put(path, { base: rec.base, deleted: true, seq: rec.seq ?? 0 });
        else await drop(path);
      }
    },

    /** What is waiting to be sent. */
    async pending() {
      const out = [];
      for (const path of (await cache.keys()).sort()) {
        const rec = await cache.get(path);
        if (isDirty(rec)) out.push({ path, kind: rec.deleted ? 'delete' : 'write' });
      }
      return out;
    },

    /**
     * Send everything waiting. A file the server changed meanwhile comes back as a conflict
     * (with the base, mine and theirs texts) and stays queued until resolved or discarded.
     * @returns {Promise<SyncResult>}
     */
    async sync() {
      /** @type {SyncResult} */
      const out = { synced: [], conflicts: [], pending: 0, offline: false };
      for (const { path } of await provider.pending()) {
        const rec = await cache.get(path);
        try {
          if (rec.deleted) {
            const cur = await attempt(() => remote.read(path));
            if (!cur) { await drop(path); out.synced.push(path); }
            else if (cur.version === rec.base?.version) { await attempt(() => remote.remove(path)); await drop(path); out.synced.push(path); }
            else out.conflicts.push({ path, base: rec.base?.text ?? null, mine: null, theirs: cur.text, theirsVersion: cur.version });
          } else {
            const r = await attempt(() => remote.write(path, rec.local, { baseVersion: rec.base?.version }));
            if (r.ok) { await put(path, { base: { text: rec.local, version: r.version }, seq: rec.seq }); out.synced.push(path); }
            else out.conflicts.push({ path, base: rec.base?.text ?? null, mine: rec.local, theirs: r.conflict.theirs, theirsVersion: r.conflict.theirsVersion });
          }
        } catch (e) {
          if (!unreachable(e)) throw e;
          out.offline = true;
          if (!(e instanceof NetworkUnavailable)) out.error = e.message;
          break;
        }
      }
      out.pending = (await provider.pending()).length;
      return out;
    },

    /**
     * Settle a conflict with the text the user chose (mine, or a merge). Sends it against the
     * server version the conflict reported. A further change on the server returns a new conflict.
     */
    async resolve(path, text, theirsVersion) {
      const r = await attempt(() => remote.write(path, text, { baseVersion: theirsVersion ?? undefined }));
      if (r.ok) await put(path, { base: { text, version: r.version }, seq: (await cache.get(path))?.seq ?? 0 });
      return r;
    },

    /** Keep theirs: forget the local change or queued delete; the next read takes the server copy. */
    async discard(path) { await drop(path); },
  };
  return provider;
}
