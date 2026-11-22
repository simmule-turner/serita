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
  const [tagPart, todoPart] = expr.split('/');
  const ors = tagPart.split('|').map((alt) => [...alt.matchAll(/([-+&]?)([^-+&=<>\s]+)(?:(<>|<=|>=|=|<|>)(?:"([^"]*)"|([^-+&|]*)))?/g)].map((m) => ({ not: m[1] === '-', name: m[2], op: m[3], value: m[4] ?? m[5] })));
  const wantedTodo = (todoPart ?? '').replace(/^!/, '').split('|').map((x) => x.trim()).filter(Boolean);
  const negate = (todoPart ?? '').startsWith('!');
  const tagsOf = (h) => { const t = new Set(); for (let x = h; x; x = x.parent) for (const g of x.tags ?? []) t.add(g); return t; };
  const test = (h, text, term) => {
    let ok;
    if (term.op) {
      const have = term.name.toUpperCase() === 'LEVEL' ? h.level : (propertiesOf(text, h.line).find(([k]) => k.toUpperCase() === term.name.toUpperCase()) ?? [])[1];
      if (have === undefined) return false;
      const numeric = term.name.toUpperCase() === 'LEVEL';
      ok = COMPARE[term.op](numeric ? Number(have) : String(have), numeric ? Number(term.value) : term.value);
    } else ok = tagsOf(h).has(term.name);
    return term.not ? !ok : ok;
  };
  return (h, text) => {
    const tagOk = ors.every((o) => o.length === 0) || ors.some((o) => o.length > 0 && o.every((t) => test(h, text, t)));
    if (!tagOk) return false;
    if (wantedTodo.length === 0) return true;
    return negate ? !wantedTodo.includes(h.todo) : wantedTodo.includes(h.todo);
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
  if (kind === 'regexp') {
    const re = emacsRegexp(arg, true); // matching ignores case even with capitals in the regexp, as in Emacs
    lines = text.split('\n').flatMap((l, i) => { re.lastIndex = 0; return re.test(l) ? [i] : []; });
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
    for (const line of lines) for (const m of rows[line].matchAll(re)) if (m[0] !== '') ranges.push({ line, from: m.index, to: m.index + m[0].length });
  } else if (kind === 'todo' || kind === 'todo-keyword') {
    for (const line of lines) { const m = /^\*+ +/.exec(rows[line]); const k = a.heads.find((h) => h.line === line).todo; ranges.push({ line, from: m[0].length, to: m[0].length + k.length }); }
  }
  return { lines, ranges, folds: sparseFolds(a.heads, lines) };
}
