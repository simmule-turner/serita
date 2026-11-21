// Local storage provider: files in app storage, with a version on every write.
// A provider handles paths only; the interface layer strips the "local:" prefix.

import { byteLength } from '../../core/bytes.js';

/**
 * @typedef {object} Kv
 * @property {(key: string) => Promise<any>} get
 * @property {(key: string, fn: (current: any) => { result: any, write?: any, remove?: boolean }) => Promise<any>} update
 * @property {() => Promise<string[]>} keys
 *
 * @typedef {object} Provider
 * @property {(path: string) => Promise<import('../interface/contract.js').ReadResult | null>} read
 * @property {(path: string, text: string, opts?: { baseVersion?: string }) => Promise<import('../interface/contract.js').WriteResult>} write
 * @property {(pathPrefix?: string) => Promise<string[]>} list
 * @property {(pathPrefix?: string) => Promise<{ path: string, size: number | null }[]>} entries  sorted by path
 * @property {(path: string) => Promise<void>} remove
 */

/**
 * @param {Kv} kv
 * @param {{ newVersion?: () => string }} [opts]
 * @returns {Provider}
 */
export function createLocalProvider(kv, { newVersion = () => globalThis.crypto.randomUUID() } = {}) {
  const provider = {
    async read(path) {
      const rec = await kv.get(path);
      return rec ? { text: rec.text, version: rec.version } : null;
    },
    write(path, text, { baseVersion } = {}) {
      return kv.update(path, (cur) => {
        if (cur?.version !== baseVersion) {
          return { result: { ok: false, conflict: { theirs: cur?.text ?? null, theirsVersion: cur?.version ?? null } } };
        }
        const version = newVersion();
        return { write: { text, version }, result: { ok: true, version } };
      });
    },
    async entries(pathPrefix = '') {
      const out = [];
      for (const path of (await kv.keys()).filter((k) => k.startsWith(pathPrefix)).sort()) {
        const rec = await kv.get(path);
        if (rec) out.push({ path, size: byteLength(rec.text) });
      }
      return out;
    },
    async list(pathPrefix = '') {
      return (await provider.entries(pathPrefix)).map((e) => e.path);
    },
    async remove(path) {
      await kv.update(path, () => ({ remove: true, result: undefined }));
    },
  };
  return provider;
}
