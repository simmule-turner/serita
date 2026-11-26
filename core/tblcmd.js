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
  if (mode === 'all') return applyAll(text, f, opts);
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
