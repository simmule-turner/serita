// The commands on a table's formulas: recalculating it and reading or changing its #+TBLFM: lines.
// The calculation itself is core/tblfm.js; this module finds the lines and keeps the messages Org gives.

import { tableAt } from './table.js';
import { recalc, splitFormulas } from './tblfm.js';

const TBLFM = /^[ \t]*#\+TBLFM:/i;
const MAX_ITERATIONS = 10;

/** The table that `line` belongs to (a table line or one of its #+TBLFM: lines): { start, end, tblfm: [lines] }, or null. */
export function formulaLines(text, line) {
  const lines = text.split('\n');
  let at = line;
  while (at > 0 && TBLFM.test(lines[at] ?? '')) at--;
  const t = tableAt(text, at);
  if (!t) return null;
  const tblfm = [];
  for (let i = t.end; TBLFM.test(lines[i] ?? ''); i++) tblfm.push(i);
  return { start: t.start, end: t.end, tblfm };
}

/** The formulas of the table, each { lhs, rhs, flags, source, line }; `source` is the text as written. */
export function formulasOf(text, line) {
  const f = formulaLines(text, line);
  if (!f) return null;
  const lines = text.split('\n');
  const out = [];
  for (const n of f.tblfm) {
    for (const source of splitFormulas(lines[n])) {
      const eq = source.indexOf('=');
      if (eq < 0) continue;
      const rest = source.slice(eq + 1);
      const semi = rest.indexOf(';');
      out.push({ lhs: source.slice(0, eq).trim(), rhs: semi < 0 ? rest : rest.slice(0, semi), flags: semi < 0 ? '' : rest.slice(semi + 1), source, line: n });
    }
  }
  return out;
}

const dataRowNumber = (text, f, line) => {
  const lines = text.split('\n');
  if (/^\s*\|\s*-/.test(lines[line])) return 0; // a horizontal line has no row to do
  let n = 0;
  for (let i = f.start; i <= line && i < f.end; i++) if (!/^\s*\|\s*-/.test(lines[i])) n++;
  return n;
};

/** Org's table commands use the first #+TBLFM: line of a table. */
const applyAll = (text, f, opts) => {
  const r = recalc(text, f.tblfm[0], opts);
  return r.error ? r : { text: r.text };
};

/**
 * Recalculates the table at `line`. mode is 'row' (C-c *), 'all' (C-u C-c *), 'iterate' (C-u C-u C-c *) or 'line' (C-c C-c on a #+TBLFM: line, which applies only that line).
 * Returns { text, message? } or { text, error }.
 * @param {string} text @param {number} line @param {'row'|'all'|'iterate'|'line'} mode @param {object} [opts]
 */
export function recalculate(text, line, mode, opts = {}) {
  const r = recalculateRun(text, line, mode, opts);
  return opts.trace ? { ...r, trace: opts.trace } : r;
}

function recalculateRun(text, line, mode, opts) {
  const f = formulaLines(text, line);
  if (!f) return { text, error: 'Not in table' };
  if (mode === 'line') {
    const r = recalc(text, line, opts);
    return r.error ? r : { text: r.text };
  }
  if (f.tblfm.length === 0) return { text };
  if (mode === 'row') {
    const r = applyAll(text, f, { ...opts, only: dataRowNumber(text, f, line) });
    return r.error ? r : { text: r.text, message: 'Re-applying formulas... done' };
  }
  if (mode === 'whole') return applyAll(text, f, opts);
  if (mode === 'all') {
    if (TBLFM.test(text.split('\n')[line] ?? '')) { const ls = text.split('\n'); ls[line] = ` ${ls[line]}`; return { text: ls.join('\n') }; }
    return applyAll(text, f, opts);
  }
  let cur = text;
  for (let i = 1; i <= MAX_ITERATIONS; i++) {
    const r = applyAll(cur, formulaLines(cur, f.start) ?? f, opts);
    if (r.error) return r;
    if (r.text === cur) return { text: cur, message: `Convergence after ${i} iterations` };
    cur = r.text;
  }
  return { text: cur, error: `No convergence after ${MAX_ITERATIONS} iterations` };
}

/** Recalculates every table that has a #+TBLFM: line (org-table-recalculate-buffer-tables), silently. */
export function recalculateBuffer(text, opts = {}) {
  let out = text;
  let count = 0;
  for (let i = 0; i < out.split('\n').length; i++) {
    const lines = out.split('\n');
    if (!TBLFM.test(lines[i]) || TBLFM.test(lines[i - 1] ?? '')) continue;
    const f = formulaLines(out, i);
    if (!f) continue;
    const r = applyAll(out, f, opts);
    if (r.error) return { text, error: r.error };
    out = r.text;
    count++;
  }
  return { text: out, count };
}

/** org-table-iterate-buffer-tables: recalculates every table over and over until the buffer stops changing. */
export function iterateBuffer(text, opts = {}) {
  let cur = text;
  for (let i = 1; i <= MAX_ITERATIONS; i++) {
    const next = recalculateBuffer(cur, opts).text;
    if (next === cur) return { text: cur, message: `Convergence after ${i} iterations` };
    cur = next;
  }
  return { text: cur, error: `No convergence after ${MAX_ITERATIONS} iterations` };
}

/**
 * Sets, replaces or (with an empty rhs) removes the formula for `lhs`, keeping it with the table's #+TBLFM: line; a table without one gets a line after it.
 * `rhs` is the expression with its flags, as typed after the `=`.
 */
export function setFormula(text, line, lhs, rhs) {
  const f = formulaLines(text, line);
  if (!f) return { text, error: 'Not in table' };
  const lines = text.split('\n');
  const body = rhs.trim();
  const keep = [];
  let found = false;
  const all = formulasOf(text, line);
  for (const x of all) {
    if (x.lhs === lhs) { found = true; if (body) keep.push(`${lhs}=${body}`); } else keep.push(x.source);
  }
  if (!found && body) keep.push(`${lhs}=${body}`);
  const first = f.tblfm.length ? f.tblfm[0] : f.end;
  const removed = f.tblfm.length;
  const next = keep.length ? [`#+TBLFM: ${keep.join(' :: ')}`] : [];
  lines.splice(first, removed, ...next);
  return { text: lines.join('\n') };
}

/** C-c C-c in a field that starts with =: the expression becomes the column's formula and that row is calculated. Null when the field does not start with =. */
export function evalFieldFormula(text, line, j) {
  const f = formulaLines(text, line);
  if (!f) return null;
  const cells = text.split('\n')[line].trim().replace(/^\||\|$/g, '').split('|');
  const m = /^=(?!=)(.*)$/.exec((cells[j] ?? '').trim());
  if (!m || !m[1].trim()) return null;
  const set = setFormula(text, line, `$${j + 1}`, m[1].trim());
  return recalculate(set.text, line, 'row');
}

const isColumnLhs = (lhs) => /^\$[-+]?[\w<>#]+$/.test(lhs);
const isNamedLhs = (lhs) => /^\$[A-Za-z_]\w*$/.test(lhs);
const isRelativeLhs = (lhs) => /^@[-+I<>]/.test(lhs);

/** The text C-c ' edits. Formulas come in the order: row targets (@>$2, @I$1), column formulas, single fields and ranges (@2$3), named fields. */
export function editorText(text, line) {
  const list = formulasOf(text, line) ?? [];
  const rank = (l) => (isRelativeLhs(l) ? 0 : isNamedLhs(l) ? 3 : isColumnLhs(l) ? 1 : 2);
  const nums = (l) => (l.match(/\d+/g) ?? []).map(Number);
  const byNumber = (a, b) => { const x = nums(a); const y = nums(b); for (let k = 0; k < Math.max(x.length, y.length); k++) if ((x[k] ?? -1) !== (y[k] ?? -1)) return (x[k] ?? -1) - (y[k] ?? -1); return a < b ? -1 : a > b ? 1 : 0; };
  const sorted = [...list].sort((a, b) => rank(a.lhs) - rank(b.lhs) || (rank(a.lhs) === 0 ? (a.lhs < b.lhs ? -1 : a.lhs > b.lhs ? 1 : 0) : byNumber(a.lhs, b.lhs)));
  const out = [];
  let headed = false;
  for (const f of sorted) {
    const r = rank(f.lhs);
    const head = r === 0 || (r === 2 && !headed) ? '# Field and Range Formulas' : r === 1 ? '# Column Formulas' : r === 3 ? '# Named Field Formulas' : null;
    if (head && !out.includes(head)) { if (out.length) out.push(''); out.push(head); }
    headed = true;
    out.push(`${f.lhs} = ${f.source.slice(f.lhs.length + 1)}`);
  }
  return out.length ? `${out.join('\n')}\n` : '';
}

/**
 * Installs what C-c ' edited as the table's #+TBLFM: line. Blank lines, lines starting with # and lines without a left side, an = and a right side are skipped;
 * a left side given twice is an error.
 */
export function installFormulas(text, line, edited) {
  const f = formulaLines(text, line);
  if (!f) return { text, error: 'Not in table' };
  const items = [];
  const seen = new Set();
  for (const l of edited.split('\n')) {
    const m = /^\s*(@[-+I<>0-9$.]+|\$[-\w<>#]+)\s*=\s*(\S.*?)\s*$/.exec(l);
    if (!m || l.trim().startsWith('#')) continue;
    if (seen.has(m[1])) return { text, error: `Double definition of formula for ${m[1]}` };
    seen.add(m[1]);
    items.push(`${m[1]}=${m[2]}`);
  }
  const lines = text.split('\n');
  const next = `#+TBLFM: ${items.join('::')}`;
  if (f.tblfm.length) lines.splice(f.tblfm[0], f.tblfm.length, next); else lines.splice(f.end, 0, next);
  return { text: lines.join('\n'), message: 'New formulas installed - press C-u C-c C-c to apply.' };
}

/** The formula debugger's substitution history of one field, as Org prints it. */
export function historyText(r) {
  return `Substitution history of formula\nOrig:   ${r.orig}\n$xyz->  ${r.xyz}\n@r$c->  ${r.rc}\n$1->    ${r.subst}\nResult: ${r.result}\nFormat: ${r.format}\nFinal:  ${r.final}\n`;
}
