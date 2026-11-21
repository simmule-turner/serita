// Document state with shared undo and redo.
// A state is an immutable value. Edits are text replacements; every edit batch records
// its inverse, so undo restores the text exactly. Views never keep their own history.

import { parse } from './parse.js';
import { serialize } from './serialize.js';

/**
 * @typedef {{ from: number, to: number, insert: string }} Edit
 * @typedef {{
 *   text: string,
 *   tree: ReturnType<typeof parse>,
 *   options: import('./parse.js').ParseOptions,
 *   past: readonly (readonly Edit[])[],
 *   future: readonly (readonly Edit[])[],
 * }} DocState
 */

/**
 * @param {string} text
 * @param {import('./parse.js').ParseOptions} [options]
 * @returns {DocState}
 */
export function createDocument(text, options = {}) {
  return Object.freeze({ text, tree: parse(text, options), options, past: Object.freeze([]), future: Object.freeze([]) });
}

/**
 * Apply a batch of non-overlapping edits given in the coordinates of the current text.
 * Returns the new text and the inverse batch (in the new text's coordinates).
 * @param {string} text
 * @param {readonly Edit[]} edits
 * @returns {{ text: string, inverse: Edit[] }}
 */
function applyBatch(text, edits) {
  const sorted = [...edits].sort((a, b) => a.from - b.from || a.to - b.to);
  for (let i = 0; i < sorted.length; i++) {
    const e = sorted[i];
    if (!(0 <= e.from && e.from <= e.to && e.to <= text.length)) throw new RangeError(`edit out of range: ${e.from}-${e.to}`);
    if (i > 0 && e.from < sorted[i - 1].to) throw new RangeError('edits overlap');
  }
  let out = '';
  let pos = 0;
  let shift = 0;
  const inverse = [];
  for (const e of sorted) {
    out += text.slice(pos, e.from) + e.insert;
    const start = e.from + shift;
    inverse.push({ from: start, to: start + e.insert.length, insert: text.slice(e.from, e.to) });
    shift += e.insert.length - (e.to - e.from);
    pos = e.to;
  }
  return { text: out + text.slice(pos), inverse };
}

const next = (doc, text, past, future) =>
  Object.freeze({ text, tree: parse(text, doc.options), options: doc.options, past, future });

/**
 * Apply one undoable change made of one or more edits.
 * @param {DocState} doc
 * @param {readonly Edit[]} edits
 * @returns {DocState}
 */
export function edit(doc, edits) {
  if (edits.length === 0) return doc;
  const { text, inverse } = applyBatch(doc.text, edits);
  return next(doc, text, Object.freeze([...doc.past, Object.freeze(inverse)]), Object.freeze([]));
}

/** @param {DocState} doc @returns {DocState} */
export function undo(doc) {
  if (doc.past.length === 0) return doc;
  const inverse = doc.past[doc.past.length - 1];
  const { text, inverse: redo } = applyBatch(doc.text, inverse);
  return next(doc, text, Object.freeze(doc.past.slice(0, -1)), Object.freeze([...doc.future, Object.freeze(redo)]));
}

/** @param {DocState} doc @returns {DocState} */
export function redo(doc) {
  if (doc.future.length === 0) return doc;
  const batch = doc.future[doc.future.length - 1];
  const { text, inverse } = applyBatch(doc.text, batch);
  return next(doc, text, Object.freeze([...doc.past, Object.freeze(inverse)]), Object.freeze(doc.future.slice(0, -1)));
}

/** @param {DocState} doc @returns {string} */
export const text = (doc) => serialize(doc.tree);
