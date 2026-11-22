// The places the Back button returns to, newest last. A place is { kind: 'place', id, offset } (a buffer and a spot in it) or
// { kind: 'agenda' }. It is kept in memory only, so a reload starts empty. No DOM here.

const same = (a, b) => a.kind === b.kind && a.id === b.id && a.offset === b.offset;

/** @param {{ max?: number }} [opts] how many places to keep */
export function createHistory({ max = 100 } = {}) {
  /** @type {{ kind: 'place' | 'agenda', id?: number, offset?: number }[]} */
  let entries = [];
  return {
    /** Records a place being left. The place already on top is not recorded again. */
    push(entry) {
      if (entries.length && same(entries[entries.length - 1], entry)) return;
      entries = [...entries, entry].slice(-max);
    },
    /** The place Back would go to, or null. Places that `valid` refuses (a closed buffer) are dropped first. */
    peek(valid = () => true) {
      while (entries.length && !valid(entries[entries.length - 1])) entries = entries.slice(0, -1);
      return entries[entries.length - 1] ?? null;
    },
    /** Takes the place Back goes to off the history, or null when there is none. */
    pop(valid = () => true) {
      const top = this.peek(valid);
      if (top) entries = entries.slice(0, -1);
      return top;
    },
    size: () => entries.length,
  };
}
