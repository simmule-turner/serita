// Plain incremental search, as Emacs does it by default: case is ignored unless the query
// contains an uppercase letter. Positions are UTF-16 offsets into the text.

/** Lowercases without changing the length of the text, so offsets stay valid. */
const fold = (s) => Array.from(s, (c) => { const l = c.toLowerCase(); return l.length === c.length ? l : c; }).join('');

export const isCaseSensitive = (query) => query !== fold(query);

/**
 * Finds the next match. Forward: the first match starting at or after `from`.
 * Backward: the last match ending at or before `from`. When there is none, the result is null, as in Emacs where the search
 * fails first; with `wrap` it goes on from the other end of the text and says so. Null also when the text does not contain the query.
 * @param {string} text
 * @param {string} query
 * @param {{ from: number, backward?: boolean, wrap?: boolean }} o
 * @returns {{ start: number, end: number, wrapped: boolean } | null}
 */
export function search(text, query, { from, backward = false, wrap = false }) {
  if (query === '') return null;
  const exact = isCaseSensitive(query);
  const hay = exact ? text : fold(text);
  const q = exact ? query : fold(query);
  const hit = (i, wrapped) => (i < 0 ? null : { start: i, end: i + q.length, wrapped });
  const again = (i) => (wrap ? hit(i, true) : null);
  if (backward) {
    const first = from - q.length;
    const i = first < 0 ? -1 : hay.lastIndexOf(q, first);
    return i >= 0 ? hit(i, false) : again(hay.lastIndexOf(q));
  }
  const i = hay.indexOf(q, from);
  return i >= 0 ? hit(i, false) : again(hay.indexOf(q));
}
