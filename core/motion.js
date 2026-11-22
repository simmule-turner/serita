// Cursor motion on a text, as Emacs does it: characters, words, lines, screen lines with a remembered column.
// Pure functions over a string and an offset; the app supplies where the screen lines break.

const WORD = /[\p{L}\p{N}]/u;
const wordAt = (v, i) => WORD.test(String.fromCodePoint(v.codePointAt(i)));
const wordBefore = (v, i) => { const c = v.codePointAt(i - 1); return WORD.test(String.fromCodePoint(c >= 0xdc00 && c <= 0xdfff && i > 1 ? v.codePointAt(i - 2) : c)); };
const step = (v, i) => (v.codePointAt(i) > 0xffff ? 2 : 1);

export const lineStart = (v, p) => (p <= 0 ? 0 : v.lastIndexOf('\n', p - 1) + 1);
export const lineEnd = (v, p) => { const n = v.indexOf('\n', p); return n < 0 ? v.length : n; };

/** @returns {{ pos: number, error: string | null }} error is 'end-of-buffer' or 'beginning-of-buffer' */
export function forwardChar(v, p) { return p >= v.length ? { pos: p, error: 'end-of-buffer' } : { pos: p + step(v, p), error: null }; }
export function backwardChar(v, p) {
  if (p <= 0) return { pos: p, error: 'beginning-of-buffer' };
  const c = v.charCodeAt(p - 1);
  return { pos: p - (c >= 0xdc00 && c <= 0xdfff && p > 1 ? 2 : 1), error: null };
}

/** To the end of the next word: letters and digits make words; everything else is skipped. There is no error at the ends. */
export function forwardWord(v, p) {
  let i = p;
  while (i < v.length && !wordAt(v, i)) i += step(v, i);
  while (i < v.length && wordAt(v, i)) i += step(v, i);
  return i;
}
export function backwardWord(v, p) {
  let i = p;
  while (i > 0 && !wordBefore(v, i)) i -= 1;
  while (i > 0 && wordBefore(v, i)) i -= 1;
  return i;
}

/**
 * One screen line up or down, keeping a goal column across consecutive moves. `rowStarts(start, end)` gives the offsets where the
 * screen lines of the line [start, end) begin (the first is start). Past the last line the cursor goes to the end of it, and the
 * first line to its start, with an error.
 * @returns {{ pos: number, goal: number, error: string | null }}
 */
export function moveVertical(v, p, dir, goal, rowStarts = (s) => [s]) {
  const ls = lineStart(v, p);
  const le = lineEnd(v, p);
  const rows = rowStarts(ls, le);
  let at = rows.length - 1;
  while (rows[at] > p) at--;
  const col = goal ?? p - rows[at];
  const land = (rs, i, end) => { const from = rs[i]; const last = i + 1 >= rs.length; return from + Math.min(col, (last ? end : rs[i + 1] - 1) - from); };
  if (dir > 0) {
    if (at + 1 < rows.length) return { pos: land(rows, at + 1, le), goal: col, error: null };
    if (le >= v.length) return { pos: le, goal: col, error: 'end-of-buffer' };
    const ns = le + 1;
    const ne = lineEnd(v, ns);
    return { pos: land(rowStarts(ns, ne), 0, ne), goal: col, error: null };
  }
  if (at > 0) return { pos: land(rows, at - 1, le), goal: col, error: null };
  if (ls === 0) return { pos: ls, goal: col, error: 'beginning-of-buffer' };
  const pe = ls - 1;
  const ps = lineStart(v, pe);
  const prs = rowStarts(ps, pe);
  return { pos: land(prs, prs.length - 1, pe), goal: col, error: null };
}
