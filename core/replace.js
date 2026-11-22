// Query replace as Emacs does it: the search string, the replacement, the answers y n ! . q ^ (and SPC, DEL, RET), the case of the
// replacement following the case of each match, and the escapes \& \N \# \\ in a regexp replacement. No DOM here.
// Written from the Emacs manual's description and from observed Emacs results; no Emacs source was read.

import { emacsRegexp, hasUpper } from './regexp.js';

const escapeLiteral = (s) => s.replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&');

/** The replacement text for one match: \& is the whole match, \N a group, \# the count so far, \\ a backslash. */
export function expand(template, match, count) {
  let out = '';
  for (let i = 0; i < template.length; i++) {
    const c = template[i];
    if (c !== '\\') { out += c; continue; }
    const d = template[++i];
    if (d === undefined) throw new Error('Trailing backslash in the replacement');
    if (d === '&') out += match[0];
    else if (/[0-9]/.test(d)) { if (Number(d) >= match.length) throw new Error('Invalid use of \\ in replacement text'); out += match[Number(d)] ?? ''; }
    else if (d === '#') out += String(count);
    else if (d === '\\') out += '\\';
    else throw new Error('Invalid use of \\ in replacement text');
  }
  return out;
}

/** Follows the case of the text that was found: all capitals give capitals; a capital at the start of each word capitalizes each word. */
export function followCase(replacement, found) {
  if (!/\p{L}/u.test(found)) return replacement;
  const multiLetter = (found.match(/\p{L}/gu) ?? []).length > 1;
  if (!/\p{Ll}/u.test(found) && multiLetter) return replacement.toUpperCase();
  const words = found.match(/\p{L}[\p{L}\p{N}]*/gu) ?? [];
  if (words.every((w) => /^\p{Lu}/u.test(w) && !/\p{Lu}/u.test(w.slice(1)))) return replacement.replace(/\p{L}[\p{L}\p{N}]*/gu, (w) => w[0].toUpperCase() + w.slice(1));
  return replacement;
}

/**
 * Starts a replace from `at`. `regexp` means from is an Emacs regexp and to may use \& \N \#.
 * Answers go to `answer(key)`: 'y' or ' ' replaces this match, 'n' or DEL skips it, '!' replaces all that are left,
 * '.' replaces this one and stops, 'q' or RET stops, '^' goes back one match.
 * @returns {{ text: string, match: {start: number, end: number} | null, count: number, point: number, done: boolean, answer: (key: string) => void }}
 */
export function startReplace(text, { from, to, regexp = false, at = 0 }) {
  const fold = !hasUpper(from);
  const re = regexp ? emacsRegexp(from, fold) : new RegExp(escapeLiteral(from), `gmu${fold ? 'i' : ''}`);
  const s = { text, match: null, count: 0, point: at, done: false };
  let pos = at;
  let found = null;
  const history = [];
  const find = () => {
    re.lastIndex = pos;
    found = re.exec(s.text);
    if (found && found[0] === '' && found.index === pos && history.length && history.at(-1).emptyAt === pos) { re.lastIndex = pos + 1; found = re.exec(s.text); }
    if (!found) { s.match = null; s.done = true; return; }
    s.match = { start: found.index, end: found.index + found[0].length };
    s.point = s.match.end;
  };
  const replace = () => {
    let r = regexp ? expand(to, found, s.count) : to;
    if (fold) r = followCase(r, found[0]);
    s.text = s.text.slice(0, s.match.start) + r + s.text.slice(s.match.end);
    s.count++;
    pos = s.match.start + r.length;
    s.point = pos;
    if (found[0] === '') pos++;
  };
  const remember = () => history.push({ text: s.text, pos, count: s.count, point: s.point, match: s.match, found, done: s.done });
  find();
  s.answer = (key) => {
    if (s.done) return;
    remember();
    if (key === 'y' || key === ' ') { replace(); find(); }
    else if (key === 'n' || key === 'Backspace' || key === 'Delete') { pos = s.match.end + (found[0] === '' ? 1 : 0); find(); }
    else if (key === '!') { while (!s.done) { replace(); find(); } }
    else if (key === '.') { replace(); s.match = null; s.done = true; }
    else if (key === 'q' || key === 'Enter') s.done = true;
    else if (key === '^') {
      history.pop();
      const h = history.pop();
      if (h) { s.text = h.text; pos = h.pos; s.count = h.count; s.point = h.point; s.match = h.match; found = h.found; s.done = h.done; }
    }
  };
  return s;
}
