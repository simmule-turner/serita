// The list of recently opened or saved files, newest first. Emacs keeps 20 by default.

export const MAX_RECENT = 20;

/** @param {{ getItem(k: string): string|null, setItem(k: string, v: string): void }} store */
export function createRecent(store, { max = MAX_RECENT } = {}) {
  const load = () => {
    const raw = store.getItem('serita.recent');
    return raw === null ? [] : JSON.parse(raw);
  };
  const save = (list) => store.setItem('serita.recent', JSON.stringify(list));
  return {
    list: load,
    /** Puts a name first; an older entry for it goes away, and the list is cut at the maximum. */
    add(name) { save([name, ...load().filter((n) => n !== name)].slice(0, max)); },
    remove(name) { save(load().filter((n) => n !== name)); },
    clear() { save([]); },
  };
}
