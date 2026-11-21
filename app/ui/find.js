// Plain incremental search, as Emacs does it by default: case is ignored unless the query
// contains an uppercase letter. Positions are UTF-16 offsets into the text.

/** Lowercases without changing the length of the text, so offsets stay valid. */
const fold = (s) => Array.from(s, (c) => { const l = c.toLowerCase(); return l.length === c.length ? l : c; }).join('');

export const isCaseSensitive = (query) => query !== fold(query);

/**
 * Finds the next match. Forward: the first match starting at or after `from`.
 * Backward: the last match ending at or before `from`. When there is none, the search
 * wraps once and reports it. Returns null when the text does not contain the query at all.
 * @param {string} text
 * @param {string} query
 * @param {{ from: number, backward?: boolean }} o
 * @returns {{ start: number, end: number, wrapped: boolean } | null}
 */
export function search(text, query, { from, backward = false }) {
  if (query === '') return null;
  const exact = isCaseSensitive(query);
  const hay = exact ? text : fold(text);
  const q = exact ? query : fold(query);
  const hit = (i, wrapped) => (i < 0 ? null : { start: i, end: i + q.length, wrapped });
  if (backward) {
    const first = from - q.length;
    const i = first < 0 ? -1 : hay.lastIndexOf(q, first);
    return i >= 0 ? hit(i, false) : hit(hay.lastIndexOf(q), true);
  }
  const i = hay.indexOf(q, from);
  return i >= 0 ? hit(i, false) : hit(hay.indexOf(q), true);
}
