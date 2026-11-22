// The kill ring: what was cut, most recent first. Consecutive kills join into one entry, as in Emacs.

/** @param {number} [size] how many entries to keep */
export function createKillRing(size = 60) {
  let ring = [];
  return {
    /** Adds `text`; with `append`, it joins the newest entry instead of starting a new one. */
    kill(text, { append = false } = {}) {
      if (text === '') return;
      ring = append && ring.length > 0 ? [ring[0] + text, ...ring.slice(1)] : [text, ...ring].slice(0, size);
    },
    /** The `n`th newest entry (0 is the newest), or undefined when the ring is empty. */
    get: (n = 0) => ring[n],
    size: () => ring.length,
  };
}
