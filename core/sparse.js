// Which lines a sparse tree keeps: the lines that match a regexp, or the headings with an unfinished TODO keyword.
// Written from the Emacs manual's description of sparse trees and observed Emacs results; no Emacs source was read.

import { emacsRegexp } from './regexp.js';
import { sparseFolds } from './outline.js';
import { propertiesOf } from './properties.js';

const COMPARE = { '=': (a, b) => a === b, '<>': (a, b) => a !== b, '<': (a, b) => a < b, '>': (a, b) => a > b, '<=': (a, b) => a <= b, '>=': (a, b) => a >= b };

/**
 * A match expression as Emacs's tag search reads it: tags joined with | (or), and + or & (and), - (not); LEVEL=2 and Property="value"
 * comparisons; and after a /, TODO keywords separated by | (a leading ! negates). Tags are inherited from the headings above.
 * @returns {(h: any, text: string) => boolean}
 */
export function matcher(expr, a) {
  if (expr.trim() === '') throw new Error(`Invalid match tag: "${expr}"`);
  const [tagPart, todoPart] = expr.split('/');
  // A term is a tag, a {regexp} over the tags, or a property comparison; names may be in double quotes; , reads as |.
  const ors = tagPart.split(/[|,]/).map((alt) => [...alt.matchAll(/([-+&]?)(?:\{([^}]*)\}|"?([^-+&=<>\s"{]+)"?)(?:(<>|<=|>=|=|<|>)(?:"([^"]*)"|([^-+&|,]*)))?/g)].map((m) => ({ not: m[1] === '-', re: m[2] !== undefined ? emacsRegexp(m[2]) : null, name: m[3], op: m[4], value: m[5] ?? m[6] })));
  // After the /: a leading ! keeps only unfinished TODO entries; the keywords follow, separated by |, each with an optional - to exclude it.
  const todoOnly = (todoPart ?? '').startsWith('!');
  const words = (todoPart ?? '').replace(/^!/, '').split('|').map((x) => x.trim()).filter(Boolean).map((w) => ({ not: w.startsWith('-'), word: w.replace(/^-/, '') }));
  const tagsOf = (h) => { const t = new Set(); for (let x = h; x; x = x.parent) for (const g of x.tags ?? []) t.add(g); return t; };
  const special = { LEVEL: (h) => h.level, TODO: (h) => h.todo ?? '', PRIORITY: (h) => h.priority ?? 'B', ITEM: (h) => h.title };
  const test = (h, text, term) => {
    let ok;
    if (term.op) {
      const name = term.name.toUpperCase();
      const have = special[name] ? special[name](h) : (propertiesOf(text, h.line).find(([k]) => k.toUpperCase() === name) ?? [])[1];
      if (have === undefined) return false;
      const numeric = name === 'LEVEL';
      ok = COMPARE[term.op](numeric ? Number(have) : String(have), numeric ? Number(term.value) : term.value);
    } else if (term.re) ok = [...tagsOf(h)].some((g) => { term.re.lastIndex = 0; return term.re.test(g); });
    else ok = tagsOf(h).has(term.name);
    return term.not ? !ok : ok;
  };
  return (h, text) => {
    const tagOk = ors.every((o) => o.length === 0) || ors.some((o) => o.length > 0 && o.every((t) => test(h, text, t)));
    if (!tagOk) return false;
    if (todoOnly && !(h.todo && !a.todo.done.includes(h.todo))) return false;
    if (words.length === 0) return true;
    const pos = words.filter((w) => !w.not).map((w) => w.word);
    const neg = words.filter((w) => w.not).map((w) => w.word);
    return (pos.length === 0 || pos.includes(h.todo)) && !neg.includes(h.todo);
  };
}

/**
 * @param {string} text
 * @param {{ heads: any[], todo: { open: string[], done: string[] } }} a the analysis of the text
 * @param {{ kind: 'regexp' | 'match' | 'todo' | 'todo-keyword', arg?: string }} how
 * @returns {{ lines: number[], ranges: { line: number, from: number, to: number }[], folds: object }}
 */
export function sparseTree(text, a, { kind, arg = '' }) {
  let lines;
  if (kind === 'regexp' && arg === '') throw new Error('Regexp cannot be empty');
  if (kind === 'regexp') {
    const re = emacsRegexp(arg, true); // matching ignores case even with capitals in the regexp, as in Emacs
    const starts = [0]; for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
    const lineOf = (o) => { let n = 0; while (n + 1 < starts.length && starts[n + 1] <= o) n++; return n; };
    const keep = new Set();
    for (const m of text.matchAll(re)) { if (m[0] === '') continue; for (let n = lineOf(m.index); n <= lineOf(m.index + m[0].length - 1); n++) keep.add(n); }
    lines = [...keep].sort((x, y) => x - y);
  } else if (kind === 'match') {
    const ok = matcher(arg, a);
    lines = a.heads.filter((h) => ok(h, text)).map((h) => h.line);
  } else if (kind === 'todo') {
    lines = a.heads.filter((h) => h.todo && !a.todo.done.includes(h.todo)).map((h) => h.line);
  } else {
    const wanted = arg.split('|').map((x) => x.trim()).filter(Boolean);
    lines = a.heads.filter((h) => h.todo && wanted.includes(h.todo)).map((h) => h.line);
  }
  // What Emacs highlights: the text a regexp matched, or the TODO keyword of each entry; a tag or property match highlights nothing.
  const ranges = [];
  const rows = text.split('\n');
  if (kind === 'regexp') {
    const re = emacsRegexp(arg, true);
    const starts = [0]; for (let i = 0; i < text.length; i++) if (text[i] === '\n') starts.push(i + 1);
    const lineOf = (o) => { let n = 0; while (n + 1 < starts.length && starts[n + 1] <= o) n++; return n; };
    for (const m of text.matchAll(re)) {
      if (m[0] === '') continue;
      const end = m.index + m[0].length;
      for (let line = lineOf(m.index); line <= lineOf(end - 1); line++) ranges.push({ line, from: Math.max(m.index, starts[line]) - starts[line], to: Math.min(end, starts[line] + rows[line].length) - starts[line] });
    }
  } else if (kind === 'todo' || kind === 'todo-keyword') {
    for (const line of lines) { const m = /^\*+ +/.exec(rows[line]); const k = a.heads.find((h) => h.line === line).todo; ranges.push({ line, from: m[0].length, to: m[0].length + k.length }); }
  }
  return { lines, ranges, folds: sparseFolds(a.heads, lines) };
}

/**
 * A sparse tree by date: the SCHEDULED and DEADLINE stamps of every entry compared with ISO dates. Before is strictly earlier,
 * after includes the date itself, between includes the start and leaves out the end (as recorded from Emacs).
 * `type` is the date type C-c / c cycles through: null (scheduled and deadline), 'all' (every active or inactive timestamp in the entry's
 * text, heading included, but not the SCHEDULED, DEADLINE and CLOSED stamps), 'scheduled' or 'deadline'.
 * @returns {{ lines: number[], count: number, folds: object }}
 */
export function dateSparse(text, a, { mode, from, to = null, type = null }) {
  const rows = text.split('\n');
  const keep = [];
  let count = 0;
  const inRange = (d) => (mode === 'before' ? d < from : mode === 'after' ? d >= from : d >= from && d < to);
  const planning = type === 'scheduled' ? /SCHEDULED:\s*<(\d{4}-\d\d-\d\d)/g : type === 'deadline' ? /DEADLINE:\s*<(\d{4}-\d\d-\d\d)/g : /(?:DEADLINE|SCHEDULED):\s*<(\d{4}-\d\d-\d\d)/g;
  for (const [k, h] of a.heads.entries()) {
    let hit = 0;
    let at = h.line + 1;
    if (type === 'all') {
      const end = a.heads[k + 1]?.line ?? rows.length;
      for (let n = h.line; n < end; n++) {
        const row = (rows[n] ?? '').replace(/(?:CLOSED|DEADLINE|SCHEDULED):\s*[<[][^>\]]*[>\]]/g, '');
        for (const m of row.matchAll(/[<[](\d{4}-\d\d-\d\d)/g)) if (inRange(m[1])) { hit++; at = n; }
      }
    } else {
      const row = rows[h.line + 1] ?? '';
      if (!/^\s*(?:CLOSED|DEADLINE|SCHEDULED):/.test(row)) continue;
      for (const m of row.matchAll(planning)) if (inRange(m[1])) hit++;
    }
    if (hit) { count += hit; keep.push(at); }
  }
  return { lines: keep, count, folds: sparseFolds(a.heads, withBodies(a, keep)) };
}

/** Emacs reveals the whole text of an entry a date matched, not only the line that matched (v0.1.89 sp3-*). */
function withBodies(a, lines) {
  const out = new Set(lines);
  for (const line of lines) {
    const h = a.heads.find((x) => x.line <= line && line < x.end);
    const next = a.heads.find((x) => x.line > h.line);
    for (let n = h.line + 1; n < (next ? next.line : Infinity) && n < h.end; n++) out.add(n);
  }
  return [...out];
}

/**
 * A sparse tree of the unfinished entries whose DEADLINE is past due or within `days` of `today` (ISO dates): C-c / d. An entry's own
 * warning period is not used; the count is of deadline stamps.
 * @returns {{ lines: number[], count: number, folds: object }}
 */
export function deadlineSparse(text, a, { days = 14, today }) {
  const rows = text.split('\n');
  const [y, m, d] = today.split('-').map(Number);
  const limit = new Date(Date.UTC(y, m - 1, d + days + 2)).toISOString().slice(0, 10); // Emacs counts a deadline up to `days` + 2 away as within `days`, at any hour (v0.1.89 dd-*, v0.1.90 dw-*)
  const keep = [];
  let count = 0;
  for (const h of a.heads) {
    if (h.todo && a.todo.done.includes(h.todo)) continue;
    const row = rows[h.line + 1] ?? '';
    const hit = [...row.matchAll(/DEADLINE:\s*<(\d{4}-\d\d-\d\d)/g)].filter((x) => x[1] <= limit).length;
    if (hit) { count += hit; keep.push(h.line + 1); }
  }
  return { lines: keep, count, folds: sparseFolds(a.heads, keep) };
}
