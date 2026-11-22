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

/**
 * Swaps two blocks of lines (a before b); lines between them stay where they are. The file's last line may lack a
 * line ending, which stays at the end of the file. `remap` moves a line number of the old text to the new one.
 */
function swapBlocks(lines, a, b) {
  const first = lines.slice(a.from, a.to);
  const gap = lines.slice(a.to, b.from);
  const second = lines.slice(b.from, b.to);
  if (b.to === lines.length && lines[lines.length - 1].eol === '') {
    second[second.length - 1] = { ...second[second.length - 1], eol: '\n' };
    first[first.length - 1] = { ...first[first.length - 1], eol: '' };
  }
  const shift = second.length + gap.length;
  const remap = (n) => {
    if (n >= a.from && n < a.to) return n + shift;
    if (n >= b.from && n < b.to) return n - (b.from - a.from);
    if (n >= a.to && n < b.from) return n + second.length - first.length;
    return n;
  };
  return { lines: [...lines.slice(0, a.from), ...second, ...gap, ...first, ...lines.slice(b.to)], remap, firstAt: a.from + shift, secondAt: a.from };
}

/** Moves a heading's subtree before its previous sibling (dir -1) or after its next one (dir 1). */
export function moveSubtree(text, line, dir) {
  const { h } = headOf(text, line);
  const sibs = h.parent ? h.parent.children : analyze(text).heads.filter((x) => !x.parent);
  const other = sibs[sibs.findIndex((x) => x.line === h.line) + dir];
  if (!other) throw new Error('Cannot move past superior level or buffer limit');
  const [first, second] = dir < 0 ? [other, h] : [h, other];
  const r = swapBlocks(splitLines(text), { from: first.line, to: first.end }, { from: second.line, to: second.end });
  return { text: join(r.lines), line: dir < 0 ? r.secondAt : r.firstAt, remap: r.remap };
}

/** Adds an empty sibling heading after the subtree of the one at `line`. The new heading's line is returned. */
export function insertHeadingAfter(text, line, title = '') {
  const { h } = headOf(text, line);
  const lines = splitLines(text);
  const stars = '*'.repeat(h.level);
  if (h.end > 0 && lines[h.end - 1].eol === '') lines[h.end - 1] = { ...lines[h.end - 1], eol: '\n' };
  lines.splice(h.end, 0, { text: `${stars} ${oneLine(title)}`, eol: lines.length > h.end ? '\n' : '' });
  return { text: join(lines), line: h.end, remap: (n) => (n >= h.end ? n + 1 : n) };
}

/**
 * Starts a heading at `pos`, at the level of the heading it is in or under (level 1 before the first heading).
 * At the start of a heading line the new heading goes above it; at the start of any other line that line becomes a heading;
 * anywhere else the line breaks at `pos` and the rest of it becomes the new heading's text.
 * @returns {{ text: string, pos: number, remap: (n: number) => number }}
 */
export function insertHeadingHere(text, pos) {
  const lines = splitLines(text);
  let at = 0;
  let line = 0;
  while (line + 1 < lines.length && at + lines[line].text.length + lines[line].eol.length <= pos) { at += lines[line].text.length + lines[line].eol.length; line++; }
  const heads = analyze(text).heads;
  const here = heads.find((x) => x.line === line);
  const above = [...heads].reverse().find((x) => x.line <= line);
  const stars = '*'.repeat((here ?? above)?.level ?? 1);
  const col = pos - at;
  const mark = `${stars} `;
  if (col === 0 && here) return { text: text.slice(0, pos) + mark + '\n' + text.slice(pos), pos: pos + mark.length, remap: (n) => (n >= line ? n + 1 : n) };
  if (col === 0) return { text: text.slice(0, pos) + mark + text.slice(pos), pos: pos + mark.length, remap: (n) => n };
  return { text: `${text.slice(0, pos)}\n${mark}${text.slice(pos)}`, pos: pos + 1 + mark.length, remap: (n) => (n > line ? n + 1 : n) };
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

export const DEFAULT_TAGS_COLUMN = -77;
const oneLine = (s) => s.replace(/\s*[\r\n]+\s*/g, ' ').trim();

/**
 * A headline's text with its tags aligned to `column`: a negative number is the column the line ends at, a positive one the column
 * the tags start at, and 0 puts them one space after the title. There is always at least one space.
 */
function withTags(base, tags, column) {
  const tagText = tags.length ? `:${tags.join(':')}:` : '';
  if (tagText === '') return base;
  const pad = column < 0 ? -column - base.length - tagText.length : column > 0 ? column - base.length : 1;
  return base + ' '.repeat(Math.max(1, pad)) + tagText;
}

/** Sets the heading's tags. */
export function setTags(text, line, tags, column = DEFAULT_TAGS_COLUMN) {
  headOf(text, line);
  const lines = splitLines(text);
  lines[line] = { ...lines[line], text: withTags(lines[line].text.replace(new RegExp(TAGS.source, 'u'), ''), tags, column) };
  return { text: join(lines), line, remap: same };
}

/** Replaces a heading's title; the stars, TODO word, priority and tags stay. */
export function setTitle(text, line, title, column = DEFAULT_TAGS_COLUMN) {
  const { h } = headOf(text, line);
  const lines = splitLines(text);
  const base = `${'*'.repeat(h.level)} ${h.todo ? `${h.todo} ` : ''}${h.priority ? `[#${h.priority}] ` : ''}${h.comment ? 'COMMENT ' : ''}${oneLine(title)}`;
  lines[line] = { ...lines[line], text: withTags(base, h.tags, column) };
  return { text: join(lines), line, remap: same };
}

const CHECKBOX = /^([ \t]*(?:[-+*]|\d+[.)])[ \t]+(?:\[@\d+\][ \t]+)?\[)([ X-])\]/;
const COOKIE = /\[(\d*)\/(\d*)\]|\[(\d*)%\]/;

/** Rewrites the first statistics cookie in a line: [done/total] or [percent%]. */
function withCookie(text, done, total) {
  return text.replace(COOKIE, (all, a, b) => (a !== undefined ? `[${done}/${total}]` : `[${total ? Math.floor((100 * done) / total) : 0}%]`));
}

/**
 * Turns a checkbox on or off: [ ] and [-] become [X], [X] becomes [ ]. The checkboxes of the items above it, and the
 * cookies ([2/4], [50%]) of those items and of the heading, are brought up to date. Returns null when the line has no checkbox.
 */
export function toggleCheckbox(text, line) {
  const a = analyze(text);
  const lines = splitLines(text);
  const item = a.items.find((x) => x.line === line);
  const m = item && CHECKBOX.exec(lines[line].text);
  if (!m) return null;
  const set = (n, patch) => { lines[n] = { ...lines[n], text: patch(lines[n].text) }; };
  set(line, (t) => `${m[1]}${m[2] === 'X' ? ' ' : 'X'}${t.slice(m[0].length - 1)}`);
  const boxes = (list) => list.map((c) => CHECKBOX.exec(lines[c.line].text)).filter(Boolean);
  const count = (list) => { const b = boxes(list); return { done: b.filter((x) => x[2] === 'X').length, open: b.filter((x) => x[2] === '-').length, total: b.length }; };
  for (let p = item.parent; p; p = p.parent) {
    const { done, open, total } = count(p.children);
    if (total === 0) continue;
    const state = done === total ? 'X' : done === 0 && open === 0 ? ' ' : '-';
    set(p.line, (t) => withCookie(t.replace(CHECKBOX, (all, pre) => `${pre}${state}]`), done, total));
  }
  const head = a.heads.filter((x) => x.line < line && x.bodyEnd > line).pop();
  if (head) {
    const { done, total } = count(a.items.filter((x) => !x.parent && x.line > head.line && x.line < head.bodyEnd));
    if (total > 0) set(head.line, (t) => withCookie(t, done, total));
  }
  return { text: join(lines), line, remap: same };
}

const markerOf = (t) => /^[ \t]*(?:[-+*]|\d+[.)])[ \t]+/.exec(t)[0];

/** The item next to this one in the same list, in direction dir (-1 above, 1 below), when nothing but one blank line is between. */
function neighbor(items, lines, it, dir) {
  const same = items.filter((x) => x.parent === it.parent && x.indent === it.indent);
  const other = same[same.findIndex((x) => x.line === it.line) + dir];
  if (!other) return null;
  const [a, b] = dir < 0 ? [other, it] : [it, other];
  const gap = lines.slice(a.end, b.line);
  return gap.length <= 1 && gap.every((l) => l.text.trim() === '') ? other : null;
}

const ITEM_LOST = new Error('Not on a list item');

/** Moves a list item, with its sub-items, above or below its neighbor. Numbers of an ordered list stay in order. */
export function moveItem(text, line, dir) {
  const a = analyze(text);
  const it = a.items.find((x) => x.line === line);
  if (!it) throw ITEM_LOST;
  const lines = splitLines(text);
  const other = neighbor(a.items, lines, it, dir);
  if (!other) throw new Error('Cannot move the item further');
  const [first, second] = dir < 0 ? [other, it] : [it, other];
  const num = (n) => /^([ \t]*)(\d+)([.)])/.exec(lines[n].text);
  const n1 = num(first.line);
  const n2 = num(second.line);
  if (n1 && n2) {
    const renumber = (n, m, v) => { lines[n] = { ...lines[n], text: lines[n].text.replace(/^([ \t]*)\d+/, `$1${v}`) }; return m; };
    renumber(first.line, n1, n2[2]);
    renumber(second.line, n2, n1[2]);
  }
  const r = swapBlocks(lines, { from: first.line, to: first.end }, { from: second.line, to: second.end });
  return { text: join(r.lines), line: dir < 0 ? r.secondAt : r.firstAt, remap: r.remap };
}

/**
 * Changes a list item's indentation: delta 1 makes it a sub-item of the item above, -1 moves it out to its parent's level.
 * The sub-items stay where they are unless withChildren is set.
 */
export function indentItem(text, line, delta, withChildren) {
  const a = analyze(text);
  const it = a.items.find((x) => x.line === line);
  if (!it) throw ITEM_LOST;
  const lines = splitLines(text);
  let to;
  if (delta > 0) {
    const above = neighbor(a.items, lines, it, -1);
    if (!above) throw new Error('Cannot indent the first item of a list');
    to = above.indent + markerOf(lines[above.line].text).length - above.indent;
  } else {
    if (!it.parent) throw new Error('Cannot outdent a top-level item');
    to = it.parent.indent;
  }
  const d = to - it.indent;
  for (let n = it.line; n < (withChildren ? it.end : it.line + 1); n++) {
    const t = lines[n].text;
    if (t.trim() === '') continue;
    lines[n] = { ...lines[n], text: d > 0 ? ' '.repeat(d) + t : t.slice(Math.min(-d, indentOf(t))) };
  }
  return { text: join(lines), line, remap: same };
}

const indentOf = (s) => s.match(/^[ \t]*/)[0].length;
