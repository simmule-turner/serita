// Whole-line edits on plain text. A position is an offset in the text; every function returns
// the new text and where the cursor goes. No DOM here.

const startOf = (text, p) => (p <= 0 ? 0 : text.lastIndexOf('\n', p - 1) + 1);
const endOf = (text, p) => { const i = text.indexOf('\n', p); return i < 0 ? text.length : i; };

/** The 1-based line number at `p` and the number of lines in the text. */
export function lineInfo(text, p) {
  return { line: text.slice(0, p).split('\n').length, count: text.split('\n').length };
}

/** The offset where line `n` (1-based) starts; a number past the end gives the last line. */
export function lineStart(text, n) {
  const lines = text.split('\n');
  const k = Math.min(Math.max(1, n), lines.length) - 1;
  return lines.slice(0, k).reduce((sum, l) => sum + l.length + 1, 0);
}

/** Copies the line below itself; the cursor goes to the same column in the copy. */
export function duplicateLine(text, p) {
  const s = startOf(text, p);
  const e = endOf(text, p);
  const line = text.slice(s, e);
  return { text: `${text.slice(0, e)}\n${line}${text.slice(e)}`, pos: e + 1 + (p - s) };
}

/** Removes the whole line with its line break; `killed` is what was removed. */
export function killWholeLine(text, p) {
  const s = startOf(text, p);
  const e = endOf(text, p);
  const to = e < text.length ? e + 1 : e;
  return { text: text.slice(0, s) + text.slice(to), killed: text.slice(s, to), pos: s };
}

/** Swaps the line with the one above (dir -1) or below (dir 1); null at the ends of the text. */
export function moveLine(text, p, dir) {
  const lines = text.split('\n');
  const { line } = lineInfo(text, p);
  const i = line - 1;
  const j = i + dir;
  if (j < 0 || j >= lines.length) return null;
  const col = p - lineStart(text, line);
  [lines[i], lines[j]] = [lines[j], lines[i]];
  const out = lines.join('\n');
  return { text: out, pos: lineStart(out, j + 1) + Math.min(col, lines[j].length) };
}

/** Adds `delta` columns of leading spaces, or takes away up to that many (negative delta). */
export function indentLine(text, p, delta) {
  const s = startOf(text, p);
  const e = endOf(text, p);
  const line = text.slice(s, e);
  let next;
  if (delta >= 0) next = ' '.repeat(delta) + line;
  else next = line.slice(Math.min(-delta, /^ */.exec(line)[0].length));
  const shift = next.length - line.length;
  return { text: text.slice(0, s) + next + text.slice(e), pos: Math.max(s, p + shift) };
}

/** Kills from `p` to the end of the line, or the line break itself when `p` is already at the end; null at the end of the text. */
export function killLine(text, p) {
  const e = text.indexOf('\n', p);
  const to = e < 0 ? text.length : e === p ? e + 1 : e;
  if (to === p) return null;
  return { text: text.slice(0, p) + text.slice(to), killed: text.slice(p, to), pos: p };
}
