// In-memory key-value store with the same contract as the IndexedDB one (see kv-idb.js).
//
// Contract: get(key) -> value | undefined
//           update(key, fn) -> result, atomic: fn(current) returns { result, write?, remove? }
//           keys() -> string[]

/** @returns {import('./local.js').Kv} */
export function createMemoryKv() {
  const m = new Map();
  return {
    async get(key) { return m.get(key); },
    async update(key, fn) {
      const r = fn(m.get(key));
      if (r.remove) m.delete(key);
      else if ('write' in r) m.set(key, r.write);
      return r.result;
    },
    async keys() { return [...m.keys()]; },
  };
}
