// IndexedDB key-value store. Same contract as kv-memory.js; update() runs in one
// read-write transaction, so two tabs cannot both win the same version check.

/**
 * @param {{ indexedDB: IDBFactory, name?: string, store?: string }} opts
 * @returns {Promise<import('./local.js').Kv>}
 */
export async function openIdbKv({ indexedDB, name = 'serita', store = 'files' }) {
  const db = await new Promise((resolve, reject) => {
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore(store); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  const request = (r) => new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return {
    get: (key) => request(db.transaction(store, 'readonly').objectStore(store).get(key)),
    keys: async () => (await request(db.transaction(store, 'readonly').objectStore(store).getAllKeys())).map(String),
    update: (key, fn) => new Promise((resolve, reject) => {
      const t = db.transaction(store, 'readwrite');
      const s = t.objectStore(store);
      let result;
      const g = s.get(key);
      g.onsuccess = () => {
        try {
          const r = fn(g.result);
          result = r.result;
          if (r.remove) s.delete(key);
          else if ('write' in r) s.put(r.write, key);
        } catch (e) { t.abort(); reject(e); }
      };
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error ?? new Error('transaction aborted'));
    }),
  };
}
