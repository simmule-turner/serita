// Files on the device itself, reached through the browser's file picker (File System Access API).
// The browser only reaches files the user picks, so a picked file's handle is kept (in the key-value
// store, by name) and the file is read and written through it. A file's version is its last-modified
// time, so a save is refused when the file changed on disk since it was read.
// Names are the file's own name; a second, different file with the same name gets "<2>", "<3>", ...

import { CapabilityUnavailable } from '../interface/contract.js';

/**
 * @param {{ kv: import('./local.js').Kv, env?: any }} opts
 * @returns {import('./local.js').Provider & { pickOpen(): Promise<string|null>, pickSave(suggestedName: string): Promise<string|null> }}
 */
export function createDeviceProvider({ kv, env = globalThis }) {
  const need = () => {
    if (typeof env.showOpenFilePicker !== 'function' || typeof env.showSaveFilePicker !== 'function') {
      throw new CapabilityUnavailable('storage', 'this browser cannot open and save files on the device');
    }
  };
  const cancelled = (e) => e?.name === 'AbortError';
  const version = (file) => String(file.lastModified);

  async function grant(handle, mode) {
    if ((await handle.queryPermission({ mode })) === 'granted') return;
    if ((await handle.requestPermission({ mode })) !== 'granted') {
      throw new CapabilityUnavailable('storage', 'permission to use this file was not given');
    }
  }

  async function register(handle) {
    for (const key of await kv.keys()) {
      const rec = await kv.get(key);
      if (rec && await rec.handle.isSameEntry(handle)) return key;
    }
    let key = handle.name;
    for (let n = 2; await kv.get(key); n++) key = `${handle.name}<${n}>`;
    await kv.update(key, () => ({ write: { handle }, result: undefined }));
    return key;
  }

  async function picked(pick) {
    need();
    try {
      const r = await pick();
      return await register(Array.isArray(r) ? r[0] : r);
    } catch (e) { if (cancelled(e)) return null; throw e; }
  }

  const provider = {
    pickOpen: () => picked(() => env.showOpenFilePicker({ multiple: false })),
    pickSave: (suggestedName) => picked(() => env.showSaveFilePicker({ suggestedName })),

    async read(path) {
      const rec = await kv.get(path);
      if (!rec) return null;
      await grant(rec.handle, 'read');
      try {
        const file = await rec.handle.getFile();
        return { text: await file.text(), version: version(file) };
      } catch (e) { if (e?.name === 'NotFoundError') return null; throw e; }
    },

    async write(path, text, { baseVersion } = {}) {
      const rec = await kv.get(path);
      if (!rec) throw new Error(`${path} was not picked on this device; use Open or Save as to choose it`);
      await grant(rec.handle, 'readwrite');
      const cur = await rec.handle.getFile();
      if (version(cur) !== baseVersion) return { ok: false, conflict: { theirs: await cur.text(), theirsVersion: version(cur) } };
      const w = await rec.handle.createWritable();
      await w.write(text);
      await w.close();
      return { ok: true, version: version(await rec.handle.getFile()) };
    },

    async entries(prefix = '') {
      return (await kv.keys()).filter((k) => k.startsWith(prefix)).sort().map((path) => ({ path, size: null }));
    },
    async list(prefix = '') { return (await provider.entries(prefix)).map((e) => e.path); },

    async remove() {
      throw new CapabilityUnavailable('storage', 'files on the device are not deleted from here');
    },
  };
  return provider;
}
