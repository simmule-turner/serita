// Structure edits on headings. Each takes the text and the heading's line number and returns
// { text, line, remap } where `remap` moves a fold's line number to its place in the new text
// (null when the line is gone). Errors carry the message Emacs shows.

import { splitLines, TAGS } from './parse.js';
import { analyze } from './outline.js';
import { repair } from './lists.js';

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
export function insertHeadingAfter(text, line, title = '', atParentEnd = false) {
  const { h } = headOf(text, line);
  const end = atParentEnd && h.parent ? h.parent.end : h.end;
  const lines = splitLines(text);
  const stars = '*'.repeat(h.level);
  if (end > 0 && lines[end - 1].eol === '') lines[end - 1] = { ...lines[end - 1], eol: '\n' };
  lines.splice(end, 0, { text: `${stars} ${oneLine(title)}`, eol: lines.length > end ? '\n' : '' });
  return { text: join(lines), line: end, remap: (n) => (n >= end ? n + 1 : n) };
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

/**
 * Changes the TODO state in the sequence the heading is in: none, the first word, ..., the last, none (dir 1);
 * dir -1 goes the other way; `to` (a keyword, or null for none) names the state to set instead; tags are aligned again at `column`. The statistics cookie of the parent heading, [done/total] or [percent%], counts its child
 * headings that have a TODO word and is brought up to date.
 */
export function cycleTodo(text, line, dir = 1, column = DEFAULT_TAGS_COLUMN, to = undefined) {
  const { h, todo } = headOf(text, line);
  const seq = todo.sequences.find((s) => [...s.open, ...s.done].includes(h.todo)) ?? todo.sequences[0];
  const states = [null, ...seq.open, ...seq.done];
  const at = states.indexOf(h.todo);
  const next = to !== undefined ? to : states[(at + dir + states.length) % states.length];
  const lines = splitLines(text);
  const t = lines[line].text;
  const m = /^(\*+ +)(?:(\S+)(?: +|$))?/.exec(t);
  const rest = h.todo === null ? t.slice(m[1].length) : t.slice(m[0].length);
  const changed = m[1] + (next === null ? '' : `${next}${rest === '' ? '' : ' '}`) + rest;
  lines[line] = { ...lines[line], text: h.tags.length ? withTags(changed.replace(/\s+:[^\s:]+(?::[^\s:]+)*:\s*$/, ''), h.tags, column) : changed };
  if (h.parent && COOKIE.test(lines[h.parent.line].text)) {
    const states2 = h.parent.children.map((c) => (c === h ? next : c.todo)).filter((x) => x !== null);
    const done = states2.filter((x) => todo.done.includes(x)).length;
    lines[h.parent.line] = { ...lines[h.parent.line], text: withCookie(lines[h.parent.line].text, done, states2.length) };
  }
  return { text: join(lines), line, remap: same, state: next };
}

/** The state C-N and C-u C-u ask for: the Nth keyword of the sequence (none past its end), or the first of the next sequence; undefined for any other argument. */
export function todoTarget(a, todo, from) {
  const seq = todo.sequences.find((x) => [...x.open, ...x.done].includes(from)) ?? todo.sequences[0];
  if (a?.num > 0) { const all = [...seq.open, ...seq.done]; return a.num <= all.length ? all[a.num - 1] : null; }
  if (a?.list === 16) return todo.sequences[(todo.sequences.indexOf(seq) + 1) % todo.sequences.length].open[0] ?? null;
  return undefined;
}

const PRIORITY_DEFAULT = 'B';

/**
 * Sets the priority of the heading ([#A] to [#C], or null for none), keeping its TODO word, title and tags, which are aligned again.
 * `step` is what S-up (-1) and S-down (1) do: with no priority they give B; the next one goes up to A or down to C, and past
 * the end the priority is removed.
 */
export function setPriority(text, line, priority, column = DEFAULT_TAGS_COLUMN) {
  const { h } = headOf(text, line);
  const lines = splitLines(text);
  const base = `${'*'.repeat(h.level)} ${h.todo ? `${h.todo} ` : ''}${priority ? `[#${priority}] ` : ''}${h.comment ? 'COMMENT ' : ''}${h.title}`.trimEnd();
  lines[line] = { ...lines[line], text: withTags(base, h.tags, column) };
  return { text: join(lines), line, remap: same };
}

export function stepPriority(text, line, dir, column = DEFAULT_TAGS_COLUMN) {
  const { h } = headOf(text, line);
  const code = h.priority ? h.priority.charCodeAt(0) : null;
  let next;
  if (code === null) next = PRIORITY_DEFAULT;
  else if (dir < 0) next = h.priority === 'A' ? null : String.fromCharCode(code - 1);
  else next = h.priority === 'C' ? null : String.fromCharCode(code + 1);
  return setPriority(text, line, next, column);
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
export function toggleCheckbox(text, line, { lenient = false } = {}) {
  const a = analyze(text);
  const lines = splitLines(text);
  const item = a.items.find((x) => x.line === line);
  const m = item && CHECKBOX.exec(lines[line].text);
  if (!m) return null;
  const set = (n, patch) => { lines[n] = { ...lines[n], text: patch(lines[n].text) }; };
  const kids = item.children.filter((c) => CHECKBOX.test(lines[c.line].text));
  if (kids.length) {
    // C-c C-c refuses a partly checked item; org-toggle-checkbox just sets its box from the ones below
    if (m[2] === '-' && !lenient) throw new Error('Cannot toggle an item with unfinished sub-items');
    // C-c C-c on an item with checkboxes below it sets its box from them; a partly checked item cannot be switched
    const done = kids.filter((c) => CHECKBOX.exec(lines[c.line].text)[2] === 'X').length;
    const open = kids.filter((c) => CHECKBOX.exec(lines[c.line].text)[2] === '-').length;
    set(line, (t) => t.replace(CHECKBOX, (all, pre) => `${pre}${done === kids.length ? 'X' : done === 0 && open === 0 ? ' ' : '-'}]`));
  } else set(line, (t) => `${m[1]}${m[2] === 'X' ? ' ' : 'X'}${t.slice(m[0].length - 1)}`);
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
  const r = swapBlocks(lines, { from: first.line, to: first.end }, { from: second.line, to: second.end });
  const at = dir < 0 ? r.secondAt : r.firstAt;
  const fixed = repair(join(r.lines), at);
  return { text: fixed.text ?? join(r.lines), line: at, remap: r.remap };
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
  for (let n = it.line; n < (withChildren ? it.end : it.bodyEnd); n++) {
    const t = lines[n].text;
    if (t.trim() === '') continue;
    lines[n] = { ...lines[n], text: d > 0 ? ' '.repeat(d) + t : t.slice(Math.min(-d, indentOf(t))) };
  }
  const fixed = repair(join(lines), line);
  return { text: fixed.text ?? join(lines), line, remap: same };
}

const indentOf = (s) => s.match(/^[ \t]*/)[0].length;

const ANY_COOKIE = /\[(\d*)\/(\d*)\]|\[(\d*)%\]/g;
const fillCookies = (t, done, total) => t.replace(ANY_COOKIE, (all, a) => (a !== undefined ? `[${done}/${total}]` : `[${total ? Math.floor((100 * done) / total) : 0}%]`));

/**
 * org-update-checkbox-count with a prefix argument: every statistics cookie of a heading or list item is set from the
 * checkboxes below it, the direct ones, or with hierarchical false all of those under an item. A cookie before the first heading counts
 * the lists up to it. Items in blocks do not count.
 */
export function updateCheckboxCounts(text, { hierarchical = true } = {}) {
  const a = analyze(text);
  const lines = splitLines(text);
  const box = (it) => CHECKBOX.exec(lines[it.line].text);
  const below = (it) => { const out = []; const walk = (x) => { for (const c of x.children) { out.push(c); if (!hierarchical) walk(c); } }; walk(it); return out; };
  const stats = (list) => { const b = list.map(box).filter(Boolean); return { done: b.filter((x) => x[2] === 'X').length, total: b.length }; };
  const set = (n, done, total) => { if (ANY_COOKIE.test(lines[n].text)) lines[n] = { ...lines[n], text: fillCookies(lines[n].text, done, total) }; ANY_COOKIE.lastIndex = 0; };
  const first = a.heads[0]?.line ?? lines.length;
  for (const it of a.items) { const { done, total } = stats(below(it)); set(it.line, done, total); }
  for (const h of a.heads) { const { done, total } = stats(a.items.filter((x) => !x.parent && x.line > h.line && x.line < h.bodyEnd)); set(h.line, done, total); }
  const inItem = new Set(a.items.map((x) => x.line));
  for (let n = 0; n < first; n++) if (!inItem.has(n)) { const { done, total } = stats(a.items.filter((x) => !x.parent && x.line > n && x.line < first)); set(n, done, total); }
  return join(lines);
}

/** org-update-statistics-cookies for TODO counts: a heading cookie counts its child headings that have a TODO word (all descendants when hierarchical is false). */
export function updateTodoCounts(text, { hierarchical = true } = {}) {
  const a = analyze(text);
  const lines = splitLines(text);
  const todo = a.todo ?? headOf(text, a.heads[0]?.line ?? 0).todo;
  for (const h of a.heads) {
    if (!COOKIE.test(lines[h.line].text)) continue;
    const kids = []; const walk = (x) => { for (const c of x.children) { kids.push(c); if (!hierarchical) walk(c); } }; walk(h);
    const withState = kids.filter((c) => c.todo !== null);
    if (!withState.length) continue;
    lines[h.line] = { ...lines[h.line], text: fillCookies(lines[h.line].text, withState.filter((c) => todo.done.includes(c.todo)).length, withState.length) };
  }
  return join(lines);
}

/** C-c C-c on a statistics cookie of a heading or list item: the cookie is set from the checkboxes below; null when the cursor is not on one. */
export function updateCookieAt(text, line, col) {
  const lines = splitLines(text);
  const t = lines[line]?.text ?? '';
  const hit = [...t.matchAll(ANY_COOKIE)].find((m) => col >= m.index && col <= m.index + m[0].length);
  if (!hit || !(/^\*+ /.test(t) || CHECKBOX_OR_ITEM.test(t))) return null;
  const next = splitLines(updateCheckboxCounts(text))[line].text;
  const mine = [...next.matchAll(ANY_COOKIE)].find((m) => m.index === hit.index);
  lines[line] = { ...lines[line], text: t.slice(0, hit.index) + (mine?.[0] ?? hit[0]) + t.slice(hit.index + hit[0].length) };
  return { text: join(lines), line, col: hit.index + (mine?.[0] ?? hit[0]).length };
}
const CHECKBOX_OR_ITEM = /^[ \t]*(?:[-+*]|\d+[.)])[ \t]/;
