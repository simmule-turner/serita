// WebDAV storage provider (RFC 4918 over HTTP).
// The version of a file is its ETag, kept exactly as the server sent it. A save of an existing
// file sends If-Match; a new file sends If-None-Match: *, so the server refuses to overwrite
// anything it has changed or created in the meantime (412). Credentials come from the
// platform's secure store through getCredentials and are never kept here.
//
// Server requirements, reported as errors when not met: an ETag on every GET and on the reply
// to a PUT, and a 207 multi-status reply to PROPFIND.

import { CapabilityUnavailable, NetworkUnavailable } from '../interface/contract.js';
import { parseXml, childrenOf } from './xml.js';

const DAV = 'DAV:';

export class WebdavError extends Error {
  /** @param {number} status @param {string} message */
  constructor(status, message) {
    super(`WebDAV ${status}: ${message}`);
    this.name = 'WebdavError';
    this.status = status;
  }
}

const encodePath = (path) => path.split('/').map(encodeURIComponent).join('/');
const utf8ToBase64 = (s) => {
  const bytes = new TextEncoder().encode(s);
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
};
const ok2xx = (s) => s >= 200 && s < 300;

const PROPFIND_BODY = '<?xml version="1.0" encoding="utf-8"?><propfind xmlns="DAV:"><prop><resourcetype/><getcontentlength/></prop></propfind>';

/**
 * @param {{
 *   baseUrl: string,
 *   getCredentials: () => Promise<{ username: string, password: string } | null | undefined>,
 *   fetch?: typeof fetch,
 * }} opts
 * @returns {import('./local.js').Provider}
 */
export function createWebdavProvider({ baseUrl, getCredentials, fetch = (...a) => globalThis.fetch(...a) }) {
  const root = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const rootPath = new URL(root).pathname;
  const urlOf = (path) => root + encodePath(path);

  async function call(method, url, { headers = {}, body } = {}) {
    const creds = await getCredentials();
    if (!creds) throw new CapabilityUnavailable('storage', 'the webdav provider has no credentials');
    try {
      return await fetch(url, {
        method,
        headers: { Authorization: `Basic ${utf8ToBase64(`${creds.username}:${creds.password}`)}`, ...headers },
        body,
        cache: 'no-store', // a version check is only true if the reply came from the server, not from the browser's HTTP cache
      });
    } catch (e) { throw new NetworkUnavailable(e); }
  }
  const fail = async (res) => new WebdavError(res.status, (await res.text().catch(() => '')).slice(0, 200) || 'request failed');

  async function getFile(path) {
    const res = await call('GET', urlOf(path));
    if (res.status === 404) return null;
    if (res.status !== 200) throw await fail(res);
    const version = res.headers.get('ETag');
    if (!version) throw new WebdavError(0, 'the server did not send an ETag, so saves cannot be checked');
    return { text: await res.text(), version };
  }

  const conflict = (cur) => ({ ok: false, conflict: { theirs: cur?.text ?? null, theirsVersion: cur?.version ?? null } });

  /** Create each missing parent collection of path; an existing one (405) is fine. */
  async function makeParents(path) {
    const parts = path.split('/').slice(0, -1);
    for (let i = 1; i <= parts.length; i++) {
      const res = await call('MKCOL', `${urlOf(parts.slice(0, i).join('/'))}/`);
      if (!ok2xx(res.status) && res.status !== 405) throw await fail(res);
    }
  }

  async function put(path, text, baseVersion) {
    const creating = baseVersion === undefined;
    return call('PUT', urlOf(path), {
      headers: { 'Content-Type': 'text/plain; charset=utf-8', ...(creating ? { 'If-None-Match': '*' } : { 'If-Match': baseVersion }) },
      body: text,
    });
  }

  /** Entries of one collection (Depth 1): relative paths, with a flag for collections. */
  async function propfind(dir) {
    const res = await call('PROPFIND', urlOf(dir), { headers: { Depth: '1', 'Content-Type': 'application/xml; charset=utf-8' }, body: PROPFIND_BODY });
    if (res.status === 404) return null;
    if (res.status !== 207) throw await fail(res);
    const ms = parseXml(await res.text());
    if (ms.ns !== DAV || ms.name !== 'multistatus') throw new WebdavError(207, 'the reply is not a multi-status document');
    const out = [];
    for (const r of childrenOf(ms, DAV, 'response')) {
      const href = childrenOf(r, DAV, 'href')[0]?.text.trim();
      if (!href) continue;
      const pathname = decodeURIComponent(new URL(href, urlOf(dir)).pathname);
      if (!pathname.startsWith(rootPath)) continue;
      const isCollection = childrenOf(r, DAV, 'propstat').some((ps) =>
        childrenOf(ps, DAV, 'prop').some((p) => childrenOf(p, DAV, 'resourcetype').some((t) => childrenOf(t, DAV, 'collection').length > 0)));
      const lengths = childrenOf(r, DAV, 'propstat').flatMap((ps) => childrenOf(ps, DAV, 'prop'))
        .flatMap((p) => childrenOf(p, DAV, 'getcontentlength')).map((n) => n.text.trim()).filter((t) => /^\d+$/.test(t));
      out.push({ path: pathname.slice(rootPath.length).replace(/\/$/, ''), isCollection, size: lengths.length ? Number(lengths[0]) : null });
    }
    return out;
  }

  const provider = {
    read: getFile,

    async write(path, text, { baseVersion } = {}) {
      let res = await put(path, text, baseVersion);
      if (res.status === 409 && baseVersion === undefined) {
        await makeParents(path);
        res = await put(path, text, baseVersion);
      }
      if (ok2xx(res.status)) {
        const version = res.headers.get('ETag');
        if (!version) throw new WebdavError(res.status, 'saved, but the server did not return an ETag; later saves cannot be checked');
        return { ok: true, version };
      }
      if (res.status === 404 || res.status === 412) {
        const cur = await getFile(path);
        if (cur && cur.version !== baseVersion) return conflict(cur);
        if (!cur && baseVersion !== undefined) return conflict(null);
        if (cur) throw new WebdavError(res.status, `the server refused the save although the version is current (sent If-Match ${baseVersion}, the server now reports ${cur.version}; does it use weak ETags?)`);
      }
      throw await fail(res);
    },

    /** With shallow, only the folder that holds the prefix is listed, one request, and its folders come back as { folder: true }. */
    async entries(pathPrefix = '', { shallow = false } = {}) {
      const start = pathPrefix.includes('/') ? pathPrefix.slice(0, pathPrefix.lastIndexOf('/') + 1) : '';
      const files = [];
      if (shallow) {
        const here = (await propfind(start)) ?? [];
        return here.filter((e) => e.path !== start.replace(/\/$/, '') && e.path.startsWith(pathPrefix))
          .map((e) => (e.isCollection ? { path: e.path, size: null, folder: true } : { path: e.path, size: e.size }))
          .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
      }
      let level = [start];
      while (level.length) {
        const listed = await Promise.all(level.map(async (dir) => ({ dir, entries: await propfind(dir) })));
        level = [];
        for (const { dir, entries } of listed) {
          if (entries === null) continue;
          for (const e of entries) {
            if (e.path === dir.replace(/\/$/, '')) continue; // the collection itself
            if (e.isCollection) level.push(`${e.path}/`);
            else files.push({ path: e.path, size: e.size });
          }
        }
      }
      return files.filter((f) => f.path.startsWith(pathPrefix)).sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    },

    async list(pathPrefix = '') {
      return (await provider.entries(pathPrefix)).map((e) => e.path);
    },

    async remove(path) {
      const res = await call('DELETE', urlOf(path));
      if (ok2xx(res.status) || res.status === 404) return;
      throw await fail(res);
    },
  };
  return provider;
}
