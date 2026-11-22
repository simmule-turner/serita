// Which lines a sparse tree keeps: the lines that match a regexp, or the headings with an unfinished TODO keyword.
// Written from the Emacs manual's description of sparse trees and observed Emacs results; no Emacs source was read.

import { emacsRegexp } from './regexp.js';
import { sparseFolds } from './outline.js';

/**
 * @param {string} text
 * @param {{ heads: any[], todo: { open: string[], done: string[] } }} a the analysis of the text
 * @param {{ kind: 'regexp' | 'todo' | 'todo-keyword', arg?: string }} how
 * @returns {{ lines: number[], folds: object }}
 */
export function sparseTree(text, a, { kind, arg = '' }) {
  let lines;
  if (kind === 'regexp') {
    const re = emacsRegexp(arg, true); // matching ignores case even with capitals in the regexp, as in Emacs
    lines = text.split('\n').flatMap((l, i) => { re.lastIndex = 0; return re.test(l) ? [i] : []; });
  } else if (kind === 'todo') {
    lines = a.heads.filter((h) => h.todo && !a.todo.done.includes(h.todo)).map((h) => h.line);
  } else {
    const wanted = arg.split('|').map((x) => x.trim()).filter(Boolean);
    lines = a.heads.filter((h) => h.todo && wanted.includes(h.todo)).map((h) => h.line);
  }
  return { lines, folds: sparseFolds(a.heads, lines) };
}
