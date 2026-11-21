// Local storage provider: files in app storage, with a version on every write.
// A provider handles paths only; the interface layer strips the "local:" prefix.

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
 * @property {(path: string) => Promise<void>} remove
 */

/**
 * @param {Kv} kv
 * @param {{ newVersion?: () => string }} [opts]
 * @returns {Provider}
 */
export function createLocalProvider(kv, { newVersion = () => globalThis.crypto.randomUUID() } = {}) {
  return {
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
    async list(pathPrefix = '') {
      return (await kv.keys()).filter((k) => k.startsWith(pathPrefix)).sort();
    },
    async remove(path) {
      await kv.update(path, () => ({ remove: true, result: undefined }));
    },
  };
}
