// Org tables: reading, aligning and editing them. Pure functions on text; a position is a 0-based line and a column
// within that line. Each edit returns { text, line, col } and, when Emacs would signal a user error, also `error`
// (the text may still have changed, as aligning happens first). Written from the Org manual's description of tables
// and checked against answers from Emacs (test/fixtures/emacs-tables.json).

import { splitLines } from './parse.js';
import { analyze } from './outline.js';

/** Display columns of a string: East Asian wide characters and emoji take two, combining marks none. */
export function stringWidth(s) {
  let w = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0);
    if ((c >= 0x300 && c <= 0x36f) || (c >= 0x200b && c <= 0x200f) || (c >= 0xfe00 && c <= 0xfe0f) || (c >= 0x20d0 && c <= 0x20ff)) continue;
    const wide = (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf && c !== 0x303f) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff)
      || (c >= 0xfe30 && c <= 0xfe6f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x1f300 && c <= 0x1f64f) || (c >= 0x1f680 && c <= 0x1f6ff)
      || (c >= 0x1f900 && c <= 0x1f9ff) || (c >= 0x20000 && c <= 0x3fffd);
    w += wide ? 2 : 1;
  }
  return w;
}

/** org-table-number-regexp: what makes a field a number when a column is aligned. */
const NUMBER = /^([<>]?[-+^.0-9]*[0-9][-+^.0-9eEdDx()%:]*|0[xX][0-9a-fA-F]+|nan|[-+]?inf)$/i;
/** org-table-number-fraction: the share of numbers that right-aligns a column. */
const NUMBER_FRACTION = 0.5;
const COOKIE = /^<([lrc])?([0-9]+)?>$/;

const isRuleLine = (s) => /^[ \t]*\|-/.test(s);
const isRowLine = (s) => /^[ \t]*\|/.test(s);

/** The cells of a row line, trimmed, and the line's indentation. */
function readRow(s) {
  const indent = /^[ \t]*/.exec(s)[0];
  if (isRuleLine(s)) return { indent, rule: true, raw: [], cells: [] };
  let body = s.slice(indent.length + 1).replace(/[ \t]+$/, '');
  if (body.endsWith('|')) body = body.slice(0, -1);
  const raw = body.split('|');
  return { indent, rule: false, raw, cells: raw.map((c) => c.trim()) };
}

/** The lines [start, end) of the table that line `line` is in, or null. Lines inside blocks are not table lines. */
export function tableAt(text, line) {
  const { nodes } = analyze(text);
  const is = (i) => nodes[i]?.type === 'table-row' || nodes[i]?.type === 'table-rule';
  if (!is(line)) return null;
  let start = line;
  let end = line + 1;
  while (start > 0 && is(start - 1)) start--;
  while (is(end)) end++;
  return { start, end };
}

/** The 0-based index of the field the column is in; -1 before the first bar. A bar belongs to the field on its left. */
function fieldAt(s, col) {
  let n = 0;
  for (let i = 0; i < Math.min(col, s.length); i++) if (s[i] === '|') n++;
  return n - 1;
}

const barAt = (s, k) => { let at = -1; for (let i = 0; i <= k; i++) at = s.indexOf('|', at + 1); return at; };
/** Where the cursor goes when moving into field k of an aligned line: two columns after its bar. */
const fieldStart = (s, k) => { const b = barAt(s, k); return b < 0 ? s.length : Math.min(b + 2, s.length); };

/** How each column is aligned and how wide it is. `rows` are readRow results. */
function columnInfo(rows) {
  const data = rows.filter((r) => !r.rule);
  const n = Math.max(0, ...data.map((r) => r.cells.length));
  const width = [];
  const align = [];
  for (let j = 0; j < n; j++) {
    let w = 1;
    let letter = null;
    let numbers = 0;
    let fields = 0;
    for (const r of data) {
      const c = r.cells[j] ?? '';
      w = Math.max(w, stringWidth(c));
      const k = COOKIE.exec(c);
      if (k && (k[1] || k[2]) && !letter && k[1]) letter = k[1];
      if (c === '') continue;
      fields++;
      if (NUMBER.test(c)) numbers++;
    }
    width.push(w);
    align.push(letter ?? (fields > 0 && numbers / fields >= NUMBER_FRACTION ? 'r' : 'l'));
  }
  return { n, width, align };
}

function pad(c, w, a) {
  const gap = w - stringWidth(c);
  if (gap <= 0) return c;
  if (a === 'r') return ' '.repeat(gap) + c;
  if (a === 'c') return ' '.repeat(Math.floor(gap / 2)) + c + ' '.repeat(gap - Math.floor(gap / 2));
  return c + ' '.repeat(gap);
}

/** The aligned lines of a table, and where each cell's text starts in them. */
function layout(rows, indent) {
  const { n, width, align } = columnInfo(rows);
  if (n === 0) return { lines: rows.map(() => `${indent}||`), starts: rows.map(() => []), n };
  const starts = [];
  const lines = rows.map((r) => {
    if (r.rule) { starts.push([]); return `${indent}|${width.map((w) => '-'.repeat(w + 2)).join('+')}|`; }
    const at = [];
    let pos = indent.length + 1;
    const parts = width.map((w, j) => {
      const c = r.cells[j] ?? '';
      const lead = align[j] === 'r' ? Math.max(0, w - stringWidth(c)) : align[j] === 'c' ? Math.floor(Math.max(0, w - stringWidth(c)) / 2) : 0;
      at.push(pos + 1 + lead);
      pos += w + 3;
      return ` ${pad(c, w, align[j])} `;
    });
    starts.push(at);
    return `${indent}|${parts.join('|')}|`;
  });
  return { lines, starts, n };
}

/** Replaces lines [start, end) with `next`. The last line keeps its line ending, as the lines it replaces had. */
function splice(text, start, end, next) {
  const ls = splitLines(text);
  const lastEol = ls[end - 1]?.eol ?? '';
  ls.splice(start, end - start, ...next.map((t, i) => ({ text: t, eol: i === next.length - 1 ? lastEol : '\n' })));
  return ls.map((l, i) => l.text + (l.eol === '' && i < ls.length - 1 ? '\n' : l.eol)).join('');
}

const linesOf = (text) => splitLines(text).map((l) => l.text);

/** The table at `line`, read: { lines, start, end, rows, indent }. */
function load(text, line) {
  const t = tableAt(text, line);
  if (!t) return null;
  const lines = linesOf(text);
  const rows = lines.slice(t.start, t.end).map(readRow);
  return { ...t, lines, rows, indent: rows[0].indent };
}

const NOT_IN_TABLE = { error: 'Not in table' };
const here = (text, line, col) => ({ text, line, col });

/** Aligns the table; the cursor goes to the start of its field's text, or stays at the end of the line when it was after the last bar. */
export function align(text, line, col) {
  const t = load(text, line);
  if (!t) return { ...here(text, line, col), ...NOT_IN_TABLE };
  const old = t.lines[line];
  const rowIdx = line - t.start;
  const { lines, starts } = layout(t.rows, t.indent);
  const next = splice(text, t.start, t.end, lines);
  const seps = (str) => [...str].flatMap((ch, k) => (ch === '|' || ch === '+' ? [k] : []));
  const f = fieldAt(old, col);
  let c;
  if (f < 0) c = Math.min(col, t.indent.length);
  else if (t.rows[rowIdx].rule) { const b = seps(lines[rowIdx]); c = f + 1 < b.length ? b[f] + 1 : lines[rowIdx].length; }
  else if (f >= (t.rows[rowIdx].cells.length || 1) && col > old.lastIndexOf('|')) c = lines[rowIdx].length;
  else c = starts[rowIdx][Math.min(f, starts[rowIdx].length - 1)] ?? lines[rowIdx].length;
  return here(next, line, c);
}

const emptyRow = (n) => `|${' |'.repeat(Math.max(n, 1))}`;

/** Goes to field k of line `to`, in text that is already aligned. */
const goField = (text, to, k) => { const s = linesOf(text)[to]; return here(text, to, fieldStart(s, k)); };

/** TAB: aligns, then moves to the next field; at the end of the table adds a row. */
export function nextField(text, line, col) {
  const t = load(text, line);
  if (!t) return { ...here(text, line, col), ...NOT_IN_TABLE };
  const idx = t.rows[line - t.start].rule ? -1 : fieldAt(t.lines[line], col);
  const { lines, n } = layout(t.rows, t.indent);
  let out = splice(text, t.start, t.end, lines);
  if (t.rows[line - t.start].rule) { for (let i = line + 1; i < t.end; i++) if (!t.rows[i - t.start].rule) return goField(out, i, 0); }
  else if (idx + 1 < n) return goField(out, line, idx + 1);
  for (let i = line + 1; i < t.end; i++) if (!t.rows[i - t.start].rule) return goField(out, i, 0);
  const add = [...lines, emptyRow(n)];
  out = splice(text.endsWith('\n') || t.end < t.lines.length ? text : `${text}\n`, t.start, t.end, layout(add.map(readRow), t.indent).lines);
  return goField(out, t.end, 0);
}

/** S-TAB: aligns, then moves to the previous field. */
export function previousField(text, line, col) {
  const t = load(text, line);
  if (!t) return { ...here(text, line, col), ...NOT_IN_TABLE };
  const idx = t.rows[line - t.start].rule ? 0 : fieldAt(t.lines[line], col);
  const { lines, n } = layout(t.rows, t.indent);
  const out = splice(text, t.start, t.end, lines);
  const stay = here(out, line, col);
  if (idx > 0) return goField(out, line, Math.min(idx, n) - 1);
  for (let i = line - 1; i >= t.start; i--) if (!t.rows[i - t.start].rule) return goField(out, i, n - 1);
  return { ...stay, error: 'Beginning of table' };
}

/** RET in a field: aligns and goes to the same field of the next row, adding a row when the next line is not a row. */
export function nextRow(text, line, col) {
  const t = load(text, line);
  if (!t) return { ...here(text, line, col), ...NOT_IN_TABLE };
  const idx = Math.max(0, t.rows[line - t.start].rule ? 0 : fieldAt(t.lines[line], col));
  const { lines, n } = layout(t.rows, t.indent);
  const nextIsRow = line + 1 < t.end && !t.rows[line + 1 - t.start].rule;
  if (nextIsRow) return goField(splice(text, t.start, t.end, lines), line + 1, Math.min(idx, n - 1));
  const add = [...lines.slice(0, line - t.start + 1), emptyRow(n), ...lines.slice(line - t.start + 1)];
  return goField(splice(text, t.start, t.end, layout(add.map(readRow), t.indent).lines), line + 1, Math.min(idx, n - 1));
}

const LAST_NUMBER = /^(.*?)([-+]?\d+(?:\.\d+)?)([^0-9]*)$/;
/** S-RET adds one to the last number of a field it copies (org-table-copy-increment); a date counts its year up and a time its hours. */
const increment = (v) => {
  const date = /^(\d{4})(-\d\d-\d\d)$/.exec(v);
  if (date) return `${Number(date[1]) + 1}${date[2]}`;
  const time = /^(\d+)(:\d\d(?::\d\d)?)$/.exec(v);
  if (time) return `${Number(time[1]) + 1}${time[2]}`;
  const m = LAST_NUMBER.exec(v);
  return m ? `${m[1]}${Number(m[2]) + 1}${m[3]}` : v;
};

/** Sets cell j of a row line, keeping the other cells. */
const setCell = (row, j, value, n) => { const cells = [...row.cells]; while (cells.length < n) cells.push(''); cells[j] = value; return `${row.indent}|${cells.map((c) => ` ${c} `).join('|')}|`; };

/** S-RET: fills an empty field from above, or copies a field down to the next row; numbers count up. */
export function copyDown(text, line, col) {
  const t = load(text, line);
  if (!t || t.rows[line - t.start].rule) return { ...here(text, line, col), ...NOT_IN_TABLE };
  const j = Math.max(0, fieldAt(t.lines[line], col));
  const n = columnInfo(t.rows).n;
  const row = t.rows[line - t.start];
  const redo = (lines, to) => { const out = splice(text, t.start, t.end, layout(lines.map(readRow), t.indent).lines); return goField(out, to, j); };
  const lines = t.lines.slice(t.start, t.end);
  if ((row.cells[j] ?? '') === '') {
    for (let i = line - 1; i >= t.start; i--) {
      const r = t.rows[i - t.start];
      if (!r.rule && (r.cells[j] ?? '') !== '') { lines[line - t.start] = setCell(row, j, increment(r.cells[j]), n); return redo(lines, line); }
    }
    return { ...here(text, line, col), error: 'No non-empty field found' };
  }
  const value = increment(row.cells[j]);
  const below = line + 1 < t.end && !t.rows[line + 1 - t.start].rule;
  if (below) lines[line + 1 - t.start] = setCell(t.rows[line + 1 - t.start], j, value, n);
  else lines.splice(line + 1 - t.start, 0, setCell(readRow(emptyRow(n)), j, value, n));
  return redo(lines, line + 1);
}

/** M-RET: splits the field at the cursor and moves the rest into the same field of the row below. */
export function splitField(text, line, col) {
  const t = load(text, line);
  if (!t || t.rows[line - t.start].rule) return { ...here(text, line, col), ...NOT_IN_TABLE };
  const j = Math.max(0, fieldAt(t.lines[line], col));
  const n = columnInfo(t.rows).n;
  const row = t.rows[line - t.start];
  const s = t.lines[line];
  const raw = row.raw[j] ?? '';
  const lead = raw.length - raw.trimStart().length;
  const o = Math.max(0, Math.min(col - (barAt(s, j) + 1) - lead, (row.cells[j] ?? '').length));
  const whole = row.cells[j] ?? '';
  const left = whole.slice(0, o).trimEnd();
  const rest = whole.slice(o).trimStart();
  const lines = t.lines.slice(t.start, t.end);
  lines[line - t.start] = setCell(row, j, left, n);
  const below = line + 1 < t.end && !t.rows[line + 1 - t.start].rule;
  if (below) { const r = t.rows[line + 1 - t.start]; lines[line + 1 - t.start] = setCell(r, j, [rest, r.cells[j] ?? ''].filter(Boolean).join(' '), n); }
  else lines.splice(line + 1 - t.start, 0, setCell(readRow(emptyRow(n)), j, rest, n));
  const out = splice(text, t.start, t.end, layout(lines.map(readRow), t.indent).lines);
  return goField(out, line + 1, j);
}

/** C-c -: a horizontal line below the row (above with `above`), as wide as the row's own fields. */
export function insertHline(text, line, col, above = false) {
  const t = load(text, line);
  if (!t) return { ...here(text, line, col), ...NOT_IN_TABLE };
  let base = text;
  let c = col;
  let rows = t.rows;
  if (t.rows[line - t.start].rule) {
    const a = align(text, line, col);
    base = a.text;
    c = 1;
    const t2 = load(base, line);
    rows = t2.rows;
    const rule = t2.lines[line];
    return here(splice(base, line + 1, line + 1, [rule]), line, c);
  }
  const raw = rows[line - t.start].raw;
  const rule = `${t.indent}|${(raw.length ? raw : ['']).map((r) => '-'.repeat(r.length)).join('+')}|`;
  const at = above ? line : line + 1;
  if (!above && at === t.lines.length && !text.endsWith('\n')) return here(`${text}${rule}\n`, t.start, t.indent.length + 2); // Org 9.7.11 does this: the rule lands on the last row's line
  return here(splice(base, at, at, [rule]), above ? line + 1 : line, c);
}

/** C-c RET: a horizontal line below the row, then to the row after it. */
export function hlineAndMove(text, line, col) {
  const r = insertHline(text, line, col, false);
  if (r.error) return r;
  const t = load(r.text, line);
  const idx = Math.max(0, fieldAt(linesOf(text)[line], col));
  const { lines, n } = layout(t.rows, t.indent);
  const at = line + 2;
  const hasRow = at < t.end && !t.rows[at - t.start].rule;
  if (hasRow) return goField(splice(r.text, t.start, t.end, lines), at, Math.min(idx, n - 1));
  const add = [...lines.slice(0, at - t.start), emptyRow(n), ...lines.slice(at - t.start)];
  return goField(splice(r.text, t.start, t.end, layout(add.map(readRow), t.indent).lines), at, Math.min(idx, n - 1));
}

/** M-up and M-down: swaps the line with its neighbor in the table. */
export function moveRow(text, line, col, dir) {
  const t = load(text, line);
  if (!t) return { ...here(text, line, col), ...NOT_IN_TABLE };
  const to = line + dir;
  if (to < t.start || to >= t.end) return { ...here(text, line, col), error: `Cannot move row ${dir < 0 ? 'up' : 'down'}` };
  const lines = t.lines.slice(t.start, t.end);
  const a = line - t.start;
  [lines[a], lines[to - t.start]] = [lines[to - t.start], lines[a]];
  return here(splice(text, t.start, t.end, lines), to, Math.min(col, lines[to - t.start].length));
}

/** M-S-up: deletes the row. */
export function deleteRow(text, line, col) {
  const t = load(text, line);
  if (!t) return { ...here(text, line, col), ...NOT_IN_TABLE };
  const lines = t.lines.slice(t.start, t.end);
  lines.splice(line - t.start, 1);
  const out = splice(text, t.start, t.end, lines);
  if (lines.length === 0) return here(out, Math.min(line, Math.max(0, linesOf(out).length - 1)), 0);
  const to = Math.min(line, t.start + lines.length - 1);
  return here(out, to, Math.min(col, linesOf(out)[to].length));
}

/** M-S-down: a new empty row above the row (below with `below`), then aligns. */
export function insertRow(text, line, col, below = false) {
  const t = load(text, line);
  if (!t) return { ...here(text, line, col), ...NOT_IN_TABLE };
  const { n } = columnInfo(t.rows);
  const lines = t.lines.slice(t.start, t.end);
  const at = line - t.start + (below ? 1 : 0);
  lines.splice(at, 0, emptyRow(n));
  const out = splice(text, t.start, t.end, layout(lines.map(readRow), t.indent).lines);
  return goField(out, t.start + at, 0);
}

/** Rewrites every row's cells with `fn(cells, row)`, rules unchanged, then aligns. */
function mapColumns(t, fn) {
  const { n } = columnInfo(t.rows);
  return t.rows.map((r, i) => (r.rule ? t.lines[i + t.start] : `${r.indent}|${fn([...r.cells, ...Array(Math.max(0, n - r.cells.length)).fill('')], r.cells.length).map((c) => ` ${c} `).join('|')}|`));
}

/** M-left and M-right: swaps the column with its neighbor. */
export function moveColumn(text, line, col, dir) {
  const t = load(text, line);
  if (!t) return { ...here(text, line, col), ...NOT_IN_TABLE };
  const idx = Math.max(0, fieldAt(t.lines[line], col));
  const { n } = columnInfo(t.rows);
  const to = idx + dir;
  if (to < 0 || to >= n) return { ...here(text, line, col), error: `Cannot move column ${dir < 0 ? 'left' : 'right'}` };
  const rows = mapColumns(t, (cells, had) => { if (had > Math.max(idx, to)) [cells[idx], cells[to]] = [cells[to], cells[idx]]; return cells; });
  return goField(splice(text, t.start, t.end, layout(rows.map(readRow), t.indent).lines), line, to);
}

/** M-S-left: deletes the column. */
export function deleteColumn(text, line, col) {
  const t = load(text, line);
  if (!t) return { ...here(text, line, col), ...NOT_IN_TABLE };
  const idx = Math.max(0, fieldAt(t.lines[line], col));
  const rows = mapColumns(t, (cells) => { cells.splice(idx, 1); return cells; });
  if (columnInfo(t.rows).n <= 1) return here(splice(text, t.start, t.end, rows.map(() => `${t.indent}||`)), line, t.indent.length + 1);
  const out = splice(text, t.start, t.end, layout(rows.map(readRow), t.indent).lines);
  const s = linesOf(out)[line];
  return here(out, line, idx < columnInfo(rows.map(readRow)).n ? fieldStart(s, idx) : s.length);
}

/** M-S-right: a new empty column to the left of the cursor's column. */
export function insertColumn(text, line, col) {
  const t = load(text, line);
  if (!t) return { ...here(text, line, col), ...NOT_IN_TABLE };
  const idx = Math.max(0, fieldAt(t.lines[line], col));
  const rows = mapColumns(t, (cells) => { cells.splice(idx, 0, ''); return cells; });
  const out = splice(text, t.start, t.end, layout(rows.map(readRow), t.indent).lines);
  if (t.rows[line - t.start].rule) { for (let i = line + 1; i < t.end; i++) if (!t.rows[i - t.start].rule) return goField(out, i, idx); }
  return goField(out, line, idx);
}

/** Alphabetic order as Emacs gives it here: letters compared without case and accents, ties kept in order. */
const COLLATE = new Intl.Collator('en', { sensitivity: 'base' });

/** The number a field starts with, or 0 (string-to-number). */
const toNumber = (s) => { const m = /^[ \t]*[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(s); return m ? Number(m[0]) : 0; };
/** HH:MM or HH:MM:SS as seconds. */
const toSeconds = (s) => { const m = /^(\d+):(\d+)(?::(\d+))?$/.exec(s.trim()); return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0) : 0; };

/** The key functions C-c ^ f accepts by name: what each does to the text of a field. */
const SORT_KEYS = {
  upcase: (x) => x.toUpperCase(), downcase: (x) => x.toLowerCase(), identity: (x) => x, length: (x) => [...x].length, 'string-to-number': toNumber,
  capitalize: (x) => x.toLowerCase().replace(/(^|[^\p{L}\p{N}])(\p{L})/gu, (_, a, b) => a + b.toUpperCase()), 'string-trim': (x) => x.trim(),
};
const codepoints = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
/** The compare functions: true when the first key goes before the second. */
const SORT_COMPARE = {
  'string<': (a, b) => codepoints(a, b) < 0, 'string-lessp': (a, b) => codepoints(a, b) < 0, 'string>': (a, b) => codepoints(a, b) > 0, 'string-greaterp': (a, b) => codepoints(a, b) > 0,
  '<': (a, b) => a < b, '>': (a, b) => a > b, '<=': (a, b) => a <= b, '>=': (a, b) => a >= b,
};

/** What each name C-c ^ f accepts does, for the lists a prompt offers. */
export const SORT_KEY_HELP = [['upcase', 'ignore case: A and a are equal'], ['downcase', 'ignore case: A and a are equal'], ['capitalize', 'compare with a capital first letter'], ['identity', 'the text as written'], ['length', 'by the number of characters'], ['string-to-number', 'by the number a field starts with'], ['string-trim', 'ignore spaces around the text']];
export const SORT_COMPARE_HELP = [['', 'default: numbers by <, text by string<'], ['string<', 'A to Z, by character code'], ['string>', 'Z to A, by character code'], ['<', 'smaller numbers first'], ['>', 'larger numbers first'], ['<=', 'smaller or equal first'], ['>=', 'larger or equal first']];

/**
 * The functions C-c ^ f asks for, by name (the key function, then the compare function; an empty compare name is the default of sort-subr: numbers by <, strings by string<).
 * A name that is not one of the built-in ones fails as Emacs does with a void function.
 * @returns {{ key: (s: string) => string|number, compare: ((a: any, b: any) => boolean) | null }}
 */
export function sortFunctions(keyName, compareName) {
  const void_ = (n) => new Error(`Symbol’s function definition is void: ${n}`);
  const k = keyName.trim();
  if (k === '') throw new Error('No function given');
  if (!Object.prototype.hasOwnProperty.call(SORT_KEYS, k)) throw void_(k);
  const c = compareName.trim();
  if (c !== '' && !Object.prototype.hasOwnProperty.call(SORT_COMPARE, c)) throw void_(c);
  return { key: SORT_KEYS[k], compare: c === '' ? null : SORT_COMPARE[c] };
}

/**
 * C-c ^: sorts the rows between horizontal lines around the cursor by its column.
 * `kind` is a (alphabetic), n (numeric) or t (time); a capital reverses. C-u changes nothing in Org 9.7.11's results, so there is no case-sensitive variant.
 */
export function sortRows(text, line, col, kind, fn = null) {
  const t = load(text, line);
  if (!t) return { ...here(text, line, col), ...NOT_IN_TABLE };
  if (t.rows[line - t.start].rule) return { ...here(text, line, col), error: 'Not in a sorting section' };
  const idx = Math.max(0, fieldAt(t.lines[line], col));
  let from = line;
  let to = line;
  while (from - 1 >= t.start && !t.rows[from - 1 - t.start].rule) from--;
  while (to + 1 < t.end && !t.rows[to + 1 - t.start].rule) to++;
  const lower = kind.toLowerCase();
  const key = (i) => { const c = t.rows[i - t.start].cells[idx] ?? ''; return lower === 'f' ? fn.key(c) : lower === 'n' ? toNumber(c) : lower === 't' ? toSeconds(c) : c; };
  const cmp = lower === 'a' ? COLLATE.compare : (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const order = Array.from({ length: to - from + 1 }, (_, k) => from + k).map((i) => ({ i, k: key(i) }));
  if (lower === 'f') {
    // sort-subr with the function: a goes before b when it says so; F asks the other way round, so equal keys keep their order
    const before = fn.compare ?? ((a, b) => (typeof a === 'number' && typeof b === 'number' ? a < b : codepoints(String(a), String(b)) < 0));
    const flip = kind === 'F';
    order.sort((a, b) => (before(flip ? b.k : a.k, flip ? a.k : b.k) ? -1 : before(flip ? a.k : b.k, flip ? b.k : a.k) ? 1 : 0) || a.i - b.i);
  } else {
    order.sort((a, b) => cmp(a.k, b.k) || a.i - b.i);
    if (kind !== lower) order.reverse();
  }
  const lines = t.lines.slice(t.start, t.end);
  order.forEach((o, k) => { lines[from - t.start + k] = t.lines[o.i]; });
  return here(splice(text, t.start, t.end, lines), line, Math.min(col, lines[line - t.start].length));
}

/** C-c ?: where the cursor is, as Org words it. */
export function fieldInfo(text, line, col) {
  const t = load(text, line);
  if (!t) return null;
  let row = 0;
  for (let i = t.start; i <= line; i++) if (!t.rows[i - t.start].rule) row++;
  const c = Math.max(0, fieldAt(t.lines[line], col)) + 1;
  let letters = '';
  for (let n = c; n > 0; n = Math.floor((n - 1) / 26)) letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
  return `line @${row}, col $${c}, ref @${row}$${c} or ${letters}${row}`;
}

/** An empty table of `columns` by `rows` lines, with a rule after the first, inserted before the line. */
export function createTable(text, line, columns = 5, rows = 2, col = 0) {
  const cell = `|${'   |'.repeat(columns)}`;
  const rule = `|${Array(columns).fill('---').join('+')}|`;
  const ls = splitLines(text);
  const at = Math.min(line, ls.length);
  const here0 = ls[at]?.text ?? '';
  const before = here0.slice(0, col);
  const after = here0.slice(col);
  if (before.trim() === '') {
    const add = (rows > 1 ? [cell, rule, ...Array(rows - 1).fill(cell)] : [cell]).map((x) => before + x);
    return here(ls.length === 0 ? `${add.join('\n')}\n` : splice(text, at, at, add), at, 0);
  }
  // Org 9.7.11 observed: with text before the cursor the rule comes first and the row before it is not made
  const add = [before, rule, ...Array(rows).fill(cell), ...(after === '' ? [] : [after])];
  return here(splice(`${text}${text.endsWith('\n') ? '' : '\n'}`, at, at + 1, add), at, 0);
}

/** Splits delimited text into rows of fields. `sep` is 'guess', 'tab', 'comma', a number of spaces, or a regexp source. */
export function splitDelimited(lines, sep = 'guess') {
  const csv = (s) => {
    const out = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < s.length; i++) {
      const ch = s[i];
      if (q) { if (ch === '"' && s[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; } else if (ch === '"' && cur === '') q = true;
      else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch;
    }
    out.push(cur);
    return out;
  };
  let how = sep;
  if (sep === 'guess') how = lines.some((l) => l.includes('\t')) ? 'tab' : lines.some((l) => l.includes(',')) ? 'comma' : 1;
  // Org 9.7.11 observed: a bar is a separator in every mode
  const bars = (f) => f.flatMap((c) => c.split('|')).map((c) => c.trim());
  return lines.map((l) => {
    if (how === 'tab') return bars(l.split('\t'));
    if (how === 'comma') return bars(csv(l));
    if (typeof how === 'number') return bars(l.trim().split(new RegExp(` {${how},}|\\t+`)));
    return bars(l.split(new RegExp(how)));
  });
}

/** Turns lines [from, to) into an aligned table. */
export function convertRegion(text, from, to, sep = 'guess') {
  const ls = linesOf(text);
  const part = ls.slice(from, to);
  const fields = splitDelimited(part.map((l) => l.trim() === '' ? '' : l), sep);
  const rows = fields.map((f, i) => (part[i].trim() === '' ? readRow('| |') : { indent: '', rule: false, raw: f, cells: f }));
  const lines = layout(rows, '').lines;
  return here(splice(text, from, to, lines), from, 0);
}

/** The table as rows of strings, with 'hline' for each rule (org-table-to-lisp). */
export function toLisp(text, line) {
  const t = load(text, line);
  return t ? t.rows.map((r) => (r.rule ? 'hline' : r.cells)) : null;
}

/** The table as text in a format: 'csv', 'tsv' or 'org'. */
export function exportTable(text, line, format) {
  const t = load(text, line);
  if (!t) return null;
  const data = t.rows.filter((r) => !r.rule);
  if (format === 'org') return `${layout(t.rows, t.indent).lines.join('\n')}\n`;
  if (format === 'tsv') return data.map((r) => r.cells.join('\t')).join('\n') + '\n';
  const q = (c) => (/[",]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);
  return data.map((r) => r.cells.map(q).join(',')).join('\n') + '\n';
}

/** Rows become columns and columns rows; rules go. */
export function transpose(text, line) {
  const t = load(text, line);
  if (!t) return { ...here(text, line, 0), ...NOT_IN_TABLE };
  const data = t.rows.filter((r) => !r.rule);
  const n = columnInfo(t.rows).n;
  const rows = Array.from({ length: n }, (_, j) => ({ indent: t.indent, rule: false, raw: [], cells: data.map((r) => r.cells[j] ?? '') }));
  const out = splice(text, t.start, t.end, layout(rows, t.indent).lines);
  return here(out, t.start, t.indent.length + 2);
}

/** Aligns lines of table text, for code that builds a table (capture). */
export function alignLines(lines) {
  const rows = lines.map(readRow);
  return layout(rows, rows[0]?.indent ?? '').lines;
}

/** What a view needs to draw the table at `line`: rows of cells (rules have none), each column's alignment and width cookie. */
export function tableView(text, line) {
  const t = load(text, line);
  if (!t) return null;
  const { n, align } = columnInfo(t.rows);
  const limit = Array.from({ length: n }, (_, j) => {
    for (const r of t.rows) { const k = r.rule ? null : COOKIE.exec(r.cells[j] ?? ''); if (k?.[2]) return Number(k[2]); }
    return null;
  });
  const rows = t.rows.map((r, i) => ({ line: t.start + i, rule: r.rule, cells: Array.from({ length: r.rule ? 0 : n }, (_, j) => r.cells[j] ?? ''), cookies: !r.rule && r.cells.some((c) => COOKIE.test(c)) && r.cells.every((c) => c === '' || COOKIE.test(c)) }));
  return { start: t.start, end: t.end, n, align, limit, rows };
}

/** The column within its line where field `j` of the row at `line` starts, so the row commands can be aimed at a tapped cell. */
export function cellCol(text, line, j) {
  const s = linesOf(text)[line] ?? '';
  return fieldStart(s, j);
}

/** Replaces the text of field `j` in the row at `line` and aligns the table. */
export function setField(text, line, j, value) {
  const t = load(text, line);
  if (!t || t.rows[line - t.start].rule) return { ...here(text, line, 0), ...NOT_IN_TABLE };
  if (value.includes('|')) return { ...here(text, line, cellCol(text, line, j)), error: 'A cell cannot contain |' };
  const n = columnInfo(t.rows).n;
  const lines = t.lines.slice(t.start, t.end);
  lines[line - t.start] = setCell(t.rows[line - t.start], j, value.replace(/\n/g, ' ').trim(), Math.max(n, j + 1));
  return goField(splice(text, t.start, t.end, layout(lines.map(readRow), t.indent).lines), line, j);
}

/** org-table-sum without a region: the numbers in the field's column, as Emacs prints them; null outside a table. */
export function sumColumn(text, line, col) {
  const t = load(text, line);
  if (!t) return null;
  const j = Math.max(fieldAt(t.lines[line], col), 0);
  let sum = 0;
  for (const r of t.rows) if (!r.rule && NUMBER.test((r.cells[j] ?? '').trim())) sum += Number((r.cells[j]).trim());
  return String(Math.round(sum * 1e10) / 1e10);
}

/** org-table-blank-field: empties the field and re-aligns; the cursor stays at the field start. */
export function blankField(text, line, col) {
  const t = load(text, line);
  if (!t) return { ...here(text, line, col), ...NOT_IN_TABLE };
  if (t.rows[line - t.start].rule) return { ...here(text, line, col), error: 'Not in table data field' };
  const s = t.lines[line];
  const j = Math.max(fieldAt(s, col), 0);
  const from = barAt(s, j) + 1;
  const to = s.indexOf('|', from) < 0 ? s.length : s.indexOf('|', from);
  const next = `${s.slice(0, from)}${' '.repeat(to - from)}${s.slice(to)}`;
  return here(splice(text, line, line + 1, [next]), line, fieldStart(next, j));
}

/** Reads the table at `line` as rows of cell texts (null for a rule), lets `edit` return the new rows, and writes them back aligned. Returns null outside a table. */
export function editTable(text, line, edit) {
  const t = load(text, line);
  if (!t) return null;
  const next = edit(t.rows.map((r) => (r.rule ? null : [...r.cells])));
  const rows = next.map((c) => (c === null ? { indent: t.indent, rule: true, raw: [], cells: [] } : { indent: t.indent, rule: false, raw: c, cells: c }));
  return { text: splice(text, t.start, t.end, layout(rows, t.indent).lines), start: t.start, end: t.end };
}
