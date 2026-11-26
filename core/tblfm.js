// Table formulas: the #+TBLFM: lines under a table, applied as Org's table recalculation does.
// A formula is `target=expression;flags`. Targets: a column ($3), a field (@2$3), a range of fields (@2$3..@4$3) or of rows (@2..@4$3).
// In an expression, $N @N @-N @<  @> @I.. $name stand for fields and a..b for a range; the expression itself goes to core/calc.js.

import { editTable, tableAt, tableView } from './table.js';
import { evalLisp } from './tblisp.js';
import { DEFAULTS, evaluate, fixed, fromNumber, parseNumber, text as calcText, toNumber } from './calc.js';

const TBLFM = /^[ \t]*#\+TBLFM:(.*)$/i;
class Failure extends Error { constructor(kind, message, partial = false) { super(message); this.kind = kind; this.partial = partial; } }

/** Splits a TBLFM line's formulas at `::`, outside double quotes. */
export function splitFormulas(line) {
  const body = TBLFM.exec(line)?.[1] ?? '';
  const out = [];
  let cur = ''; let q = false;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '"') q = !q;
    if (!q && ch === ':' && body[i + 1] === ':') { out.push(cur); cur = ''; i++; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map((f) => f.trim()).filter(Boolean);
}

const ROMAN = { I: 1, II: 2, III: 3, IIII: 4 };
const COL = '(?:[-+]?\\d+|[<>]+|#|0)';
const ROW = '(?:[-+]?\\d+|[<>]+|#|0|I+(?:[-+]\\d+)?|[-+]I+)';
const NAME = '[A-Za-z_][A-Za-z_0-9]*';
const FIELD = `(?:@${ROW})?(?:\\$(?:${COL}|${NAME}))?`;
const REF = new RegExp(`(?<![A-Za-z_0-9$@])((?:@${ROW}\\$(?:${COL}|${NAME})|@${ROW}|\\$(?:${COL}|${NAME})))(?:\\.\\.((?:@${ROW}\\$(?:${COL}|${NAME})|@${ROW}|\\$(?:${COL}|${NAME}))))?`, 'g');

/**
 * The table's shape for references.
 * @param {(string[]|null)[]} grid
 */
function model(grid, constants) {
  const data = []; // grid index of each data row, in order
  const rules = []; // how many data rows come before each hline
  grid.forEach((r, i) => { if (r === null) rules.push(data.length); else data.push(i); });
  const marks = new Map(grid.map((r, i) => [i, r?.[0] ?? '']));
  const names = new Map();
  for (const i of data) {
    if (marks.get(i) === '!') grid[i].forEach((c, j) => { if (c) names.set(c, j + 1); });
  }
  // a ^ row names the fields above it, a _ row the fields below it
  const fields = new Map();
  data.forEach((i, k) => {
    const mark = marks.get(i);
    const target = mark === '^' ? k : mark === '_' ? k + 2 : 0; // 1-based data row
    if (target >= 1 && target <= data.length) grid[i].forEach((c, j) => { if (j > 0 && c) fields.set(c, { row: target, col: j + 1 }); });
  });
  // a $ row holds parameters, name=value
  const params = new Map();
  for (const i of data) if (marks.get(i) === '$') for (const c of grid[i]) { const eq = /^([A-Za-z_]\w*)=(.*)$/.exec(c.trim()); if (eq) params.set(eq[1], eq[2].trim()); }
  const columns = Math.max(0, ...data.map((i) => grid[i].length));
  return { grid, data, rules, names, fields, params, columns, constants };
}

/** The rows a column formula fills: the data rows below the first hline when there is one, leaving out marked rows. */
function fillRows(m) {
  const first = m.rules.length ? m.rules[0] : 0;
  const marks = m.data.map((i) => m.grid[i][0] ?? '');
  const auto = marks.some((k) => k === '#' || k === '*');
  if (!auto && marks.some((k) => ['_', '^', '!', '$'].includes(k))) return [];
  const rows = [];
  for (let n = first; n < m.data.length; n++) {
    const mark = marks[n];
    if (auto ? mark !== '#' && mark !== '*' : mark === '/') continue;
    rows.push(n + 1);
  }
  return rows;
}

/** A row designator as a data row number (1-based), relative to row `at`. */
function rowNumber(m, d, at) {
  if (d === '#') return at;
  if (d === '0') return at;
  if (/^[<]+$/.test(d)) return d.length;
  if (/^[>]+$/.test(d)) return m.data.length - d.length + 1;
  if (/^[-+]\d+$/.test(d)) return at + Number(d);
  if (/^\d+$/.test(d)) return Number(d);
  throw new Failure('user-error', `Bad row reference @${d}`);
}
const columnNumber = (m, d, at) => {
  if (d === '#') return at;
  if (d === '0') return at;
  if (/^[<]+$/.test(d)) return d.length;
  if (/^[>]+$/.test(d)) return m.columns - d.length + 1;
  if (/^[-+]\d+$/.test(d)) return at + Number(d);
  if (/^\d+$/.test(d)) return Number(d);
  if (m.names.has(d)) return m.names.get(d);
  throw new Failure('user-error', `Unknown column ${d}`);
};

/** Where an hline reference like @I points: the data row just after that hline, or just before it for the end of a range. */
function hlineRow(m, d, end) {
  const k = ROMAN[d.replace(/[-+]\d+$/, '')];
  const before = m.rules[k - 1];
  if (before === undefined) return null;
  const off = /([-+])(\d+)$/.exec(d);
  if (off) return off[1] === '+' ? before + Number(off[2]) : before - Number(off[2]) + 1;
  return end ? before : before + 1;
}

function parseRef(m, s, row, col, end) {
  const a = /^@([^$]*)/.exec(s)?.[1];
  const b = /\$(.*)$/.exec(s)?.[1];
  const r = a === undefined ? undefined : /^I/.test(a) ? { hline: a } : a;
  let rr = row;
  if (r !== undefined) rr = typeof r === 'object' ? hlineRow(m, r.hline, end) : rowNumber(m, r, row);
  const cc = b === undefined ? col : columnNumber(m, b, col);
  return { row: rr, col: cc, hline: typeof r === 'object', rowGiven: r !== undefined, colGiven: b !== undefined };
}

const cell = (m, row, col) => {
  if (row < 1 || row > m.data.length) throw new Failure('args-out-of-range', `Row ${row} is outside the table`);
  if (col < 1 || col > m.columns) throw new Failure('user-error', `Column ${col} is outside the table`);
  return m.grid[m.data[row - 1]][col - 1] ?? '';
};

/** What stands in an expression for a cell: a number as written, a blank as 0 (nan with E), anything else as it is, or 0 with N. */
function fieldText(raw, flags) {
  const v = raw.trim();
  if (v === '') return flags.E ? 'nan' : '0';
  if (flags.T || flags.t || flags.U) {
    const d = /^([-+]?)(\d+):(\d\d)(?::(\d\d))?$/.exec(v);
    if (d) { const secs = Number(d[2]) * 3600 + Number(d[3]) * 60 + Number(d[4] ?? 0); return d[1] === '-' ? `(-${secs})` : String(secs); }
    return parseNumber(v, DEFAULTS.prec) ? v : '0';
  }
  if (flags.N && /^[-+]?\d+:\d/.test(v)) return /^[-+]?\d+/.exec(v)[0]; // a time reads as the number it starts with, not as a fraction
  if (parseNumber(v, DEFAULTS.prec)) return v.startsWith('-') ? `(${v})` : v;
  if (/^[<[]\d{4}-\d\d-\d\d(?: [A-Za-z]+)?(?: \d\d:\d\d(?::\d\d)?)?[>\]]$/.test(v)) return v;
  if (flags.N) return /^[-+]?(?:\d+\.?\d*|\.\d+)/.exec(v)?.[0] ?? '0';
  return v;
}


/** The table named by a #+NAME: line right above it, as a model; null when there is none. */
function remoteModel(m, name) {
  const lines = (m.text ?? '').split('\n');
  const at = lines.findIndex((l) => /^[ \t]*#\+NAME:/i.test(l) && l.replace(/^[ \t]*#\+NAME:[ \t]*/i, '').trim() === name);
  if (at < 0) return null;
  const v = tableView(m.text, at + 1);
  if (!v) return null;
  return model(v.rows.map((r) => (r.rule ? null : r.cells)), m.constants);
}

/** Replaces remote(name, ref) by what the field or range of the other table stands for. */
function expandRemote(m, rhs, row, col, one, many) {
  if (/remote\(/.test(rhs) && rhs.replace(/remote\([^\s,()]+,[^\s()]*\)/g, '').includes('remote(')) throw new Failure('user-error', 'Bad remote reference');
  return rhs.replace(/remote\(([^\s,()]+),([^\s()]*)\)/g, (whole, name, ref) => {
    const r = remoteModel(m, name);
    if (!r) throw new Failure('user-error', `Table ${name} not found`);
    if (!ref.includes('@')) return one('0');
    if (ref.includes('..')) {
      const [a, b] = ref.split('..');
      const from = parseRef(r, a, row, col, false); const to = parseRef(r, b, row, col, true);
      const items = [];
      for (let i = Math.min(from.row, to.row); i <= Math.max(from.row, to.row); i++) for (let j = Math.min(from.col, to.col); j <= Math.max(from.col, to.col); j++) items.push(cell(r, i, j));
      return many(items);
    }
    const p = parseRef(r, ref, row, col, false);
    return one(cell(r, p.row, p.col));
  });
}

function substitute(m, rhs, row, col, flags) {
  rhs = expandRemote(m, rhs, row, col, (raw) => { const t = fieldText(raw, flags); return t.startsWith('(') ? t : `(${t})`; },
    (items) => `[${items.filter((x) => x.trim() !== '').map((x) => fieldText(x, flags)).join(', ')}]`);
  return rhs.replace(REF, (whole, a, b) => {
    if (b !== undefined || /\.\./.test(whole)) {
      const from = parseRef(m, a, row, col, false);
      const to = parseRef(m, b ?? a, row, col, true);
      if (from.row === null || to.row === null) return '[]';
      const items = [];
      const r1 = Math.min(from.row, to.row); const r2 = Math.max(from.row, to.row);
      const c1 = Math.min(from.col, to.col); const c2 = Math.max(from.col, to.col);
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) { const v = cell(m, r, c).trim(); if (v !== '') items.push(fieldText(v, flags)); }
      return `[${items.join(', ')}]`;
    }
    if (/^\$(?![-+]?\d|[<>#0])/.test(a) && !/^@/.test(a)) {
      const n = a.slice(1);
      if (m.constants?.has(n)) return `(${m.constants.get(n)})`;
      if (m.params.has(n)) return `(${m.params.get(n)})`;
      if (m.fields.has(n)) { const f = m.fields.get(n); return fieldText(cell(m, f.row, f.col), flags); }
      if (!m.names.has(n)) return '(#ERROR)';
    }
    if (a === '$#') return String(col);
    if (a === '@#') return String(row);
    const p = parseRef(m, a, row, col, false);
    if (p.row === null) throw new Failure('user-error', 'Bad hline reference');
    const t = fieldText(cell(m, p.row, p.col), flags);
    return t.startsWith('(') ? t : `(${t})`; // Org wraps what a field stands for, so $1.5 is $1 times .5
  });
}

const CONVERSION = '%[-+ 0#]*\\d*(?:\\.\\d+)?[dfegsixXo]';
const FORMAT = new RegExp(`^[^%]*${CONVERSION}[^%]*$`);

/** `;N;%.2f;f3` and the like: { N, E, L, T, t, U, format, mode, digits, prec }. */
function parseFlags(spec) {
  const flags = {};
  if (spec === undefined) return flags;
  for (const part of spec.split(';')) {
    if (part === '') continue;
    let k;
    if (part.startsWith('%')) {
      if (!FORMAT.test(part)) throw new Failure('error', 'Bad format');
      flags.format = part;
    } else if ((k = /^([fsnp])(\d+)$/.exec(part))) {
      if (k[1] === 'p') flags.prec = Number(k[2]); else { flags.mode = { f: 'fix', s: 'sci', n: 'eng' }[k[1]]; flags.digits = Number(k[2]); }
    } else {
      let rest = '';
      for (const ch of part) if ('NELTtUDRFS'.includes(ch)) flags[ch] = true; else rest += ch;
      if (rest) flags.format = rest; // Org hands what is left to format
    }
  }
  return flags;
}

/** C's %g: P significant digits, scientific when the exponent is below -4 or at least P, trailing zeros dropped. */
function gFormat(x, p) {
  if (x === 0) return '0';
  const exp = Math.floor(Math.log10(Math.abs(Number(x.toPrecision(p)))));
  if (exp < -4 || exp >= p) return x.toExponential(p - 1).replace(/\.?0+e/, 'e').replace(/e([-+])(\d)$/, 'e$10$2');
  return String(Number(x.toPrecision(p)));
}

/** printf for the numeric conversions a format flag can name. */
function printf(template, v) {
  const at = template.indexOf('%');
  if (at < 0) return template;
  const m = new RegExp(`^(${CONVERSION.replace('%', '%').replace(/\(\?:/g, '(?:')})`).exec(template.slice(at));
  const spec = m[1];
  const [, fl, width, precision, conv] = /^%([-+ 0#]*)(\d*)(?:\.(\d+))?([dfegsixXo])$/.exec(spec);
  const x = toNumber(v);
  let body;
  if (conv === 'f') body = fixed(v, precision === undefined ? 6 : Number(precision));
  else if (conv === 'd' || conv === 'i') body = String(Math.trunc(x));
  else if (conv === 'e') body = x.toExponential(precision === undefined ? 6 : Number(precision)).replace(/e([-+])(\d)$/, 'e$10$2');
  else if (conv === 'x' || conv === 'X' || conv === 'o') {
    const n = BigInt(Math.trunc(x));
    body = (n < 0n ? '-' : '') + (n < 0n ? -n : n).toString(conv === 'o' ? 8 : 16);
    if (conv === 'X') body = body.toUpperCase();
  } else if (conv === 'g') body = gFormat(x, precision === undefined ? 6 : Math.max(1, Number(precision)));
  else body = calcText(v);
  if (fl.includes('+') && x >= 0 && !body.startsWith('-')) body = `+${body}`;
  const w = Number(width || 0);
  if (body.length < w) {
    if (fl.includes('-')) body = body.padEnd(w);
    else if (fl.includes('0') && /^[-+]?\d/.test(body)) { const s = /^[-+]/.test(body) ? body[0] : ''; body = s + body.slice(s.length).padStart(w - s.length, '0'); }
    else body = body.padStart(w);
  }
  return template.slice(0, at) + body + template.slice(at + spec.length);
}

/** Seconds as hh:mm:ss (T), hh:mm (U) or decimal hours (t). */
function duration(v, flags) {
  if ((flags.format && flags.format.includes('%')) || flags.N) return '#ERROR';
  const secs = toNumber(v);
  if (flags.t) return (secs / 3600).toFixed(2);
  const neg = secs < 0;
  const a = Math.floor(Math.abs(secs));
  const two = (n) => String(n).padStart(2, '0');
  const h = Math.floor(a / 3600);
  return `${neg ? '-' : ''}${two(h)}:${two(Math.floor(a / 60) % 60)}${flags.U ? '' : `:${two(a % 60)}`}`;
}

/** A '(...) formula: each field becomes a Lisp string, or a number with the N or L flag. */
function runLisp(m, rhs, flags, row, col, opts = {}) {
  const lispField = (raw) => {
    const v = raw.trim();
    if (flags.N || flags.L) return parseNumber(v, DEFAULTS.prec) ? v : flags.N ? '0' : JSON.stringify(v);
    return JSON.stringify(v);
  };
  const expanded = expandRemote(m, rhs, row, col, (raw) => lispField(raw), (items) => `(list ${items.map(lispField).join(' ')})`);
  const src = expanded.replace(REF, (whole, a, b) => {
    if (b !== undefined) {
      const from = parseRef(m, a, row, col, false); const to = parseRef(m, b, row, col, true);
      if (from.row === null || to.row === null) return "'()";
      const items = [];
      for (let r = Math.min(from.row, to.row); r <= Math.max(from.row, to.row); r++) for (let c = Math.min(from.col, to.col); c <= Math.max(from.col, to.col); c++) items.push(lispField(cell(m, r, c)));
      return `(list ${items.join(' ')})`;
    }
    if (a === '$#') return String(col);
    if (a === '@#') return String(row);
    const p = parseRef(m, a, row, col, false);
    if (p.row === null) throw new Failure('user-error', 'Bad hline reference');
    return lispField(cell(m, p.row, p.col));
  });
  if (opts.note) opts.note.subst = src.trim();
  try { return evalLisp(src.trim().replace(/^'/, '')); } catch (e) { if (e instanceof Error && !(e instanceof Failure)) return '#ERROR'; throw e; }
}

/** One field's value; with opts.trace the steps are kept for the formula debugger, and opts.limit stops (Abort) before the field after that many. */
function run(m, rhs, flags, row, col, opts) {
  if (!opts.trace) return runField(m, rhs, flags, row, col, opts);
  const note = {};
  const value = runField(m, rhs, flags, row, col, { ...opts, note });
  const cur = opts.current;
  opts.trace.push({
    field: `@${row}$${col}`,
    orig: cur && isColumn(cur.lhs) && !cur.hasFlags ? cur.rhs : '?',
    xyz: rhs, rc: rhs, subst: note.subst ?? rhs, result: note.raw ?? value, format: flags.format ?? 'NONE', final: value,
  });
  if (opts.limit != null && opts.trace.length > opts.limit) throw new Failure('user-error', 'Abort', true);
  return value;
}

function runField(m, rhs, flags, row, col, opts) {
  if (rhs.startsWith("'(")) { const v = runLisp(m, rhs, flags, row, col, opts); return v; }
  const src = substitute(m, rhs, row, col, flags);
  if (opts.note) opts.note.subst = src;
  if (src.includes('#ERROR')) return '#ERROR';
  let v;
  try { v = evaluate(src, { prec: flags.prec ?? opts.prec ?? DEFAULTS.prec, angle: flags.R ? 'rad' : 'deg', frac: !!flags.F, symbolic: !!flags.S }); } catch (e) { if (e.message === 'syntax') return '#ERROR'; throw e; }
  if (v.k === 'd' && (flags.T || flags.t || flags.U)) throw new Failure('error', 'wrong-type-argument');
  if ((v.k === 's' || v.k === 'x') && flags.N) return '#ERROR';
  if ((v.k === 's' || v.k === 'x') && (flags.T || flags.t || flags.U)) throw new Failure('error', 'wrong-type-argument');
  if (v.k !== 'q' && v.k !== 'f') return calcText(v);
  if (opts.note) opts.note.raw = calcText(v);
  if (flags.T || flags.t || flags.U) return flags.format && !flags.format.includes('%') ? flags.format : duration(v, flags);
  if (flags.format) return printf(flags.format, v);
  return calcText(v, { ...DEFAULTS, radix: opts.radix, ...(flags.mode ? { mode: flags.mode, digits: flags.digits } : { ...(opts.mode ? { mode: opts.mode } : {}), digits: opts.digits ?? DEFAULTS.digits }) });
}

function parseFormula(f) {
  const eq = f.indexOf('=');
  if (eq <= 0) return null;
  const lhs = f.slice(0, eq).trim();
  const rest = f.slice(eq + 1);
  const semi = rest.search(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/);
  const rhs = (semi < 0 ? rest : rest.slice(0, semi)).trim();
  const flags = semi < 0 ? undefined : rest.slice(semi + 1);
  if (rhs === '') return null;
  return { lhs, rhs, flags: parseFlags(flags), hasFlags: semi >= 0 };
}

const setCell = (m, row, col, value) => {
  const r = m.grid[m.data[row - 1]];
  while (r.length < col) r.push('');
  r[col - 1] = value;
  m.columns = Math.max(m.columns, col);
};

/** Applies one formula to the model: a column formula fills its rows; a field or range sets those fields. */
function apply(m, f, rows, opts) {
  const lhs = f.lhs;
  opts.current = f;
  if (/^\$[-+]?\d+$|^\$[<>]+$/.test(lhs)) {
    const col = columnNumber(m, lhs.slice(1), 0);
    for (const row of rows) setCell(m, row, col, run(m, f.rhs, f.flags, row, col, opts));
    return;
  }
  const plus = /^@\+I(?:\$(\d+)(?:\.\.@\+I\$(\d+))?)?$/.exec(lhs); // the last row, from column 1 to the column named
  if (plus) {
    const row = m.data.length;
    const last = Math.max(1, Number(plus[2] ?? plus[1] ?? 1));
    if (row < 1) throw new Failure('args-out-of-range', 'Row 1 is outside the table');
    const first = plus[2] ? Math.max(1, Number(plus[1])) : 1;
    for (let c = first; c <= last; c++) {
      if (c > m.columns) throw new Failure('user-error', 'Missing columns in the table. Aborting', true);
      setCell(m, row, c, run(m, f.rhs, f.flags, row, c, opts));
    }
    return;
  }
  if (/^@[^$]*\$[A-Za-z_]/.test(lhs)) return; // a field in a column named by a ! row is left alone
  const [a, b] = lhs.split('..');
  if (/^@[^$]*\.\.|^@[^$]*$/.test(lhs) === false && !/^@/.test(lhs)) throw new Failure('user-error', `Bad target ${lhs}`);
  let targets = [];
  {
    if (/\$0$|^@[-+]?I|^@I/.test(lhs) || /@[-+]?I/.test(lhs)) throw new Failure('user-error', `Bad target ${lhs}`);
    const p = parseRef(m, a.includes('$') ? a : `${a}$1`, 0, 0, false);
    const q = b === undefined ? p : parseRef(m, b, 0, 0, true);
    for (let r = Math.min(p.row, q.row); r <= Math.max(p.row, q.row); r++) for (let c = Math.min(p.col, q.col); c <= Math.max(p.col, q.col); c++) targets.push([r, c]);
  }
  for (const [r, c] of targets) {
    if (r < 1 || r > m.data.length) throw new Failure('args-out-of-range', `Row ${r} is outside the table`);
    if (c > m.columns) throw new Failure('user-error', 'Missing columns in the table. Aborting', true);
    setCell(m, r, c, run(m, f.rhs, f.flags, r, c, opts));
  }
}

/** Splits formulas into the column formulas and the field formulas. */
const isColumn = (lhs) => /^\$[-+]?[\w<>#]+$/.test(lhs);

/**
 * Recalculates the table above the #+TBLFM: line at `line` with that line's formulas.
 * `only` limits the column formulas to one data row (1-based). Returns { text } or { text, error } when a formula cannot be applied (the text is then unchanged).
 * @param {string} text @param {number} line @param {{ only?: number|null, constants?: Map<string,string>, prec?: number }} [opts]
 */
export function recalc(text, line, opts = {}) {
  const lines = text.split('\n');
  if (!TBLFM.test(lines[line] ?? '')) return { text, error: 'Not at a #+TBLFM: line' };
  let end = line;
  while (end > 0 && TBLFM.test(lines[end - 1])) end--;
  const t = end > 0 ? tableAt(text, end - 1) : null;
  if (!t) return { text };
  try {
    const formulas = splitFormulas(lines[line]).map(parseFormula).filter(Boolean);
    let failed = null;
    const out = editTable(text, t.start, (grid) => {
      const m = model(grid, opts.constants);
      m.text = text;
      const dup = formulas.find((f, i) => formulas.findIndex((g) => g.lhs === f.lhs) !== i);
      if (dup) throw new Failure('user-error', `Double definition \`${dup.lhs}=' in TBLFM line, please fix by hand`);
      if (formulas.filter((f) => /^@\+I/.test(f.lhs)).length > 1) throw new Failure('user-error', 'More than one @+I target');
      const ordered = [...formulas].sort((a, b) => (a.lhs < b.lhs ? -1 : a.lhs > b.lhs ? 1 : 0));
      const rows = opts.only ? [opts.only] : opts.only === 0 ? [] : fillRows(m); // C-c * does its row whatever its mark or place
      try { for (const f of ordered) apply(m, f, rows, opts); } catch (e) { if (!(e instanceof Failure)) throw e; failed = e; if (!e.partial) throw e; } // what was set before the error stays
      // a result holding | is two fields once the line is read again
      return grid.map((r) => (r && r.some((c) => c.includes('|')) ? r.flatMap((c) => c.split('|').map((x) => x.trim())) : r));
    });
    if (failed) return { text: out.text, error: failed.message, kind: failed.kind };
    return { text: out.text };
  } catch (e) {
    if (e instanceof Failure) return { text, error: e.message, kind: e.kind };
    throw e;
  }
}
