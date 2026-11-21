// What the Text view shows: the document with folded lines left out and "..." after a heading that
// hides something. The text itself never changes; these functions map between the shown text and
// the real text, so an edit made in the view lands in the right place.

import { splitLines } from './parse.js';

/**
 * @param {string} text
 * @param {Set<number>} hidden   line numbers to leave out
 * @param {Set<number>} dots     line numbers that get "..." after them
 * @param {{ hideStars?: boolean }} [o]  hideStars shows all but the last leading star as a space (same length)
 */
export function project(text, hidden, dots, { hideStars = false } = {}) {
  const segs = [];
  let value = '';
  let full = 0;
  splitLines(text).forEach((l, line) => {
    if (!hidden.has(line)) {
      const shown = hideStars ? l.text.replace(/^\*+(?= )/, (m) => ' '.repeat(m.length - 1) + '*') : l.text;
      const mark = dots.has(line) ? '...' : '';
      segs.push({ line, pv: value.length, full, textLen: l.text.length, dots: mark.length });
      value += shown + mark + l.eol;
    }
    full += l.text.length + l.eol.length;
  });
  return { value, segs };
}

function segAt(segs, key, p) {
  let lo = 0;
  let hi = segs.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segs[mid][key] <= p) { found = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return found < 0 ? null : segs[found];
}

/** An offset in the shown text to the same place in the real text. Inside "..." it is the end of the heading's text. */
export function toFull({ segs }, p) {
  const s = segAt(segs, 'pv', p);
  if (!s) return 0;
  const off = p - s.pv;
  if (off <= s.textLen) return s.full + off;
  if (off <= s.textLen + s.dots) return s.full + s.textLen;
  return s.full + off - s.dots;
}

/** An offset in the real text to the shown text. A place inside folded text becomes the end of the heading above it. */
export function toShown({ segs }, f) {
  const s = segAt(segs, 'full', f);
  return s ? s.pv + Math.min(f - s.full, s.textLen) : 0;
}

/** The line number (in the real text) at a place in the shown text. */
export function lineAt({ segs }, p) {
  return segAt(segs, 'pv', p)?.line ?? 0;
}

/**
 * If an edit of the shown text touches a "..." (or the line break after it), the heading it belongs to.
 * Such an edit opens the fold first, so nothing is changed in text the person cannot see.
 */
export function touchedFold({ segs }, from, to, insert) {
  for (const s of segs) {
    if (s.dots === 0) continue;
    const a = s.pv + s.textLen;
    if ((from < a + s.dots + 1 && to > a) || (insert.includes('\n') && from >= a && from <= a + s.dots)) return s.line;
  }
  return null;
}
