// Three-way line merge for the save-conflict prompt (keep mine, keep theirs, merge).
// base is the last synced copy, mine is the local text, theirs is what is on the server now.
// Changes in different places merge on their own; a place both sides changed differently
// comes back as a conflict for the user to settle.

import { splitLines } from '../../core/parse.js';

/** Largest line-count product the matcher will take on before asking the user to pick a side. */
export const MAX_CELLS = 25_000_000;

/**
 * @typedef {{ type: 'text', lines: string[] }
 *   | { type: 'conflict', base: string[], mine: string[], theirs: string[] }} Segment
 */

const toLines = (t) => splitLines(t).map((l) => l.text + l.eol);
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Longest common subsequence of two line arrays, as a map from index in a to index in b (or -1).
 * @param {string[]} a
 * @param {string[]} b
 * @returns {Int32Array}
 */
function match(a, b) {
  const out = new Int32Array(a.length).fill(-1);
  let lo = 0;
  while (lo < a.length && lo < b.length && a[lo] === b[lo]) { out[lo] = lo; lo++; }
  let ea = a.length;
  let eb = b.length;
  while (ea > lo && eb > lo && a[ea - 1] === b[eb - 1]) { ea--; eb--; out[ea] = eb; }
  const n = ea - lo;
  const m = eb - lo;
  if (n === 0 || m === 0) return out;
  if (n * m > MAX_CELLS) throw new RangeError('the two versions differ too much to merge by lines');
  const w = m + 1;
  const t = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      t[i * w + j] = a[lo + i] === b[lo + j] ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1]);
    }
  }
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[lo + i] === b[lo + j]) { out[lo + i] = lo + j; i++; j++; }
    else if (t[(i + 1) * w + j] >= t[i * w + j + 1]) i++;
    else j++;
  }
  return out;
}

/**
 * @param {string} base
 * @param {string} mine
 * @param {string} theirs
 * @returns {{ segments: Segment[], clean: boolean, text?: string }}
 */
export function merge3(base, mine, theirs) {
  const B = toLines(base);
  const M = toLines(mine);
  const T = toLines(theirs);
  const bm = match(B, M);
  const bt = match(B, T);

  // Anchors: base lines that survive unchanged in both versions.
  const anchors = [];
  for (let i = 0; i < B.length; i++) if (bm[i] >= 0 && bt[i] >= 0) anchors.push([i, bm[i], bt[i]]);
  anchors.push([B.length, M.length, T.length]);

  /** @type {Segment[]} */
  const segments = [];
  const pushText = (lines) => {
    if (!lines.length) return;
    const last = segments[segments.length - 1];
    if (last?.type === 'text') last.lines.push(...lines);
    else segments.push({ type: 'text', lines: [...lines] });
  };

  let pb = 0;
  let pm = 0;
  let pt = 0;
  for (const [ab, am, at] of anchors) {
    const b = B.slice(pb, ab);
    const m = M.slice(pm, am);
    const t = T.slice(pt, at);
    if (same(m, b)) pushText(t);
    else if (same(t, b) || same(m, t)) pushText(m);
    else segments.push({ type: 'conflict', base: b, mine: m, theirs: t });
    if (ab < B.length) pushText([B[ab]]);
    pb = ab + 1; pm = am + 1; pt = at + 1;
  }

  const clean = segments.every((s) => s.type === 'text');
  return clean
    ? { segments, clean, text: segments.map((s) => s.lines.join('')).join('') }
    : { segments, clean };
}

/**
 * Settle every conflict and return the text.
 * @param {Segment[]} segments
 * @param {(index: number, c: Extract<Segment, { type: 'conflict' }>) => 'mine' | 'theirs' | 'both'} pick
 * @returns {string}
 */
export function resolve(segments, pick) {
  let k = 0;
  return segments.map((s) => {
    if (s.type === 'text') return s.lines.join('');
    const choice = pick(k++, s);
    if (choice === 'mine') return s.mine.join('');
    if (choice === 'theirs') return s.theirs.join('');
    return s.mine.join('') + s.theirs.join('');
  }).join('');
}
