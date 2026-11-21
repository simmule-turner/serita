// Structure edits on headings. Each takes the text and the heading's line number and returns
// { text, line, remap } where `remap` moves a fold's line number to its place in the new text
// (null when the line is gone). Errors carry the message Emacs shows.

import { splitLines, TAGS } from './parse.js';
import { analyze } from './outline.js';

const join = (lines) => lines.map((l) => l.text + l.eol).join('');
const same = (n) => n;
const headOf = (text, line) => {
  const a = analyze(text);
  const h = a.heads.find((x) => x.line === line);
  if (!h) throw new Error('Not at a heading');
  return { ...a, h };
};

/** Changes the level of one heading, or of its whole subtree. delta is -1 (promote) or +1 (demote). */
export function changeLevel(text, line, delta, subtree) {
  const { heads, h } = headOf(text, line);
  const lines = splitLines(text);
  const targets = heads.filter((x) => (subtree ? x.line >= h.line && x.line < h.end : x.line === h.line));
  if (delta < 0 && targets.some((x) => x.level === 1)) throw new Error('Cannot promote to level 0');
  for (const t of targets) {
    const stars = lines[t.line].text.match(/^\*+/)[0];
    lines[t.line] = { ...lines[t.line], text: '*'.repeat(stars.length + delta) + lines[t.line].text.slice(stars.length) };
  }
  return { text: join(lines), line, remap: same };
}

/** Moves a heading's subtree before its previous sibling (dir -1) or after its next one (dir 1). */
export function moveSubtree(text, line, dir) {
  const { h } = headOf(text, line);
  const sibs = h.parent ? h.parent.children : analyze(text).heads.filter((x) => !x.parent);
  const at = sibs.findIndex((x) => x.line === h.line);
  const other = sibs[at + dir];
  if (!other) throw new Error('Cannot move past superior level or buffer limit');
  const lines = splitLines(text);
  const size = h.end - h.line;
  const osize = other.end - other.line;
  const lastNoEol = lines[lines.length - 1].eol === '';
  const first = dir < 0 ? other : h;
  const second = dir < 0 ? h : other;
  const a = lines.slice(first.line, first.end);
  const b = lines.slice(second.line, second.end);
  // The file's last line may lack a line ending; after the swap that is the end of the other block.
  if (lastNoEol && second.end === lines.length) {
    b[b.length - 1] = { ...b[b.length - 1], eol: '\n' };
    a[a.length - 1] = { ...a[a.length - 1], eol: '' };
  }
  const out = [...lines.slice(0, first.line), ...b, ...a, ...lines.slice(second.end)];
  const newLine = dir < 0 ? h.line - osize : h.line + osize;
  const remap = (n) => {
    if (n >= h.line && n < h.end) return n - h.line + newLine;
    if (n >= other.line && n < other.end) return dir < 0 ? n + size : n - size;
    return n;
  };
  return { text: join(out), line: newLine, remap };
}

/** Adds an empty sibling heading after the subtree of the one at `line`. The new heading's line is returned. */
export function insertHeadingAfter(text, line) {
  const { h } = headOf(text, line);
  const lines = splitLines(text);
  const stars = '*'.repeat(h.level);
  if (h.end > 0 && lines[h.end - 1].eol === '') lines[h.end - 1] = { ...lines[h.end - 1], eol: '\n' };
  lines.splice(h.end, 0, { text: `${stars} `, eol: lines.length > h.end ? '\n' : '' });
  return { text: join(lines), line: h.end, remap: (n) => (n >= h.end ? n + 1 : n) };
}

/** Changes the TODO state in the sequence the heading is in: none, the first word, ..., the last, none. */
export function cycleTodo(text, line) {
  const { h, todo } = headOf(text, line);
  const seq = todo.sequences.find((s) => [...s.open, ...s.done].includes(h.todo)) ?? todo.sequences[0];
  const words = [...seq.open, ...seq.done];
  const next = h.todo === null ? words[0] : words[words.indexOf(h.todo) + 1] ?? null;
  const lines = splitLines(text);
  const t = lines[line].text;
  const m = /^(\*+ +)(?:(\S+)(?: +|$))?/.exec(t);
  const rest = h.todo === null ? t.slice(m[1].length) : t.slice(m[0].length);
  lines[line] = { ...lines[line], text: m[1] + (next === null ? '' : `${next}${rest === '' ? '' : ' '}`) + rest };
  return { text: join(lines), line, remap: same, state: next };
}

const TAGS_COLUMN = 77;

/** Sets the heading's tags. They are aligned so the line ends at column 77, as Emacs does by default. */
export function setTags(text, line, tags) {
  headOf(text, line);
  const lines = splitLines(text);
  const base = lines[line].text.replace(new RegExp(TAGS.source, 'u'), '');
  const tagText = tags.length ? `:${tags.join(':')}:` : '';
  const pad = tagText === '' ? '' : ' '.repeat(Math.max(1, TAGS_COLUMN - base.length - tagText.length));
  lines[line] = { ...lines[line], text: base + pad + tagText };
  return { text: join(lines), line, remap: same };
}

/** Turns a checkbox on or off: [ ] and [-] become [X], [X] becomes [ ]. Returns null when the line has no checkbox. */
export function toggleCheckbox(text, line) {
  const lines = splitLines(text);
  const l = lines[line];
  const m = l && /^([ \t]*(?:[-+*]|\d+[.)])[ \t]+(?:\[@\d+\][ \t]+)?\[)([ X-])\]/.exec(l.text);
  if (!m) return null;
  lines[line] = { ...l, text: `${m[1]}${m[2] === 'X' ? ' ' : 'X'}${l.text.slice(m[0].length - 1)}` };
  return { text: join(lines), line, remap: same };
}
