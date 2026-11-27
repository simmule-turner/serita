// Plain lists: new items, bullets and numbering, checkboxes, items made from text and headings, and sorting.
// Written from the Org manual and observed Emacs 30.1 results (conformance v0.1.73, li-*); no Emacs source was read.
// Every edit takes the text, the cursor's line (0-based) and column, and returns { text, line, col } or { error }.

import { splitLines } from './parse.js';
import { analyze } from './outline.js';
import { updateCheckboxCounts } from './outline-edit.js';

const join = (lines) => lines.map((l) => l.text + l.eol).join('');
const indentOf = (s) => s.match(/^[ \t]*/)[0].length;
/** The bullets C-c - cycles through, in order. */
export const BULLETS = ['-', '+', '1.', '1)'];

const ITEM = /^([ \t]*)([-+*]|\d+[.)])([ \t]*)(\[@(\d+)\][ \t]*)?(\[([ X-])\](?:[ \t]+|$))?/;

/** The parts of an item line: indent, bullet, counter, checkbox, and the column where the item's text starts. */
export function info(t) {
  const m = ITEM.exec(t);
  if (!m || (m[3] === '' && t.length > m[1].length + m[2].length)) return null;
  const bullet = m[2];
  const ordered = /\d/.test(bullet);
  const rest = t.slice(m[0].length);
  return {
    indent: m[1].length, bullet, space: m[3] || ' ', ordered, num: ordered ? Number(bullet.slice(0, -1)) : null, delim: ordered ? bullet.slice(-1) : null,
    counter: m[5] !== undefined ? Number(m[5]) : null, box: m[7] ?? null, boxAt: m[6] !== undefined ? m[1].length + bullet.length + m[3].length + (m[4]?.length ?? 0) : null,
    textStart: m[0].length, bulletEnd: m[1].length + bullet.length + m[3].length, described: /^(?:.*?[ \t])?::(?:[ \t]|$)/.test(rest),
  };
}

const itemAt = (a, line) => a.items.filter((x) => x.line <= line && line < x.end).pop() ?? null;
const root = (it) => { let x = it; while (x.parent) x = x.parent; return x; };

/** The items of the list an item is in, at its level: neighbors with at most one blank line between. */
function chainOf(a, lines, it) {
  const same = a.items.filter((x) => x.parent === it.parent && x.indent === it.indent);
  const ok = (p, q) => { const gap = lines.slice(p.end, q.line); return gap.length <= 1 && gap.every((l) => l.text.trim() === ''); };
  let lo = same.indexOf(it);
  let hi = lo;
  while (lo > 0 && ok(same[lo - 1], same[lo])) lo--;
  while (hi < same.length - 1 && ok(same[hi], same[hi + 1])) hi++;
  return same.slice(lo, hi + 1);
}

const groups = (a, lines, items) => {
  const out = [];
  for (const it of items) {
    const last = out[out.length - 1];
    if (last && last[0].indent === it.indent && chainOf(a, lines, it)[0] === last[0]) last.push(it); else out.push([it]);
  }
  return out;
};

const shiftLine = (l, d) => (d === 0 || l.text.trim() === '' ? l : { ...l, text: d > 0 ? ' '.repeat(d) + l.text : l.text.slice(Math.min(-d, indentOf(l.text))) });

/**
 * Makes a list tidy: every item of a level takes the bullet of the first one (or `style`), numbers run on from 1 (or from a [@n] counter),
 * and what is under an item moves with its bullet. The sub-lists are put right the same way.
 */
function fix(a, lines, chain, shift, style) {
  const first = info(lines[chain[0].line].text);
  const want = style ?? first.bullet;
  const ordered = /\d/.test(want);
  const delim = ordered ? want.slice(-1) : null;
  let n = null;
  for (const it of chain) {
    const m = info(lines[it.line].text);
    if (ordered) n = m.counter ?? (n === null ? 1 : n + 1); // the first item starts at 1 unless it has a counter
    const bullet = ordered ? `${n}${delim}` : want;
    const own = bullet.length - m.bullet.length;
    const t = lines[it.line].text;
    lines[it.line] = { ...lines[it.line], text: ' '.repeat(Math.max(0, m.indent + shift)) + bullet + t.slice(m.indent + m.bullet.length) };
    const kids = it.children;
    const owned = new Set();
    for (const c of kids) for (let k = c.line; k < c.end; k++) owned.add(k);
    for (let k = it.line + 1; k < it.end; k++) if (!owned.has(k)) lines[k] = shiftLine(lines[k], shift + own);
    for (const g of groups(a, lines, kids)) fix(a, lines, g, shift + own, null);
  }
}

/** Repairs the list the item at `line` is in (all of its levels). Returns the new lines, or null when there is no item. */
function repairLines(text, line, style) {
  const a = analyze(text);
  const lines = splitLines(text);
  const it = itemAt(a, line);
  if (!it) return null;
  // a chosen bullet style changes the list the item is in, a sub-list alone when it is in one
  if (style && it.parent) {
    const chain = groups(a, lines, it.parent.children).find((g) => g.includes(it));
    fix(a, lines, chain, 0, style);
    return lines;
  }
  const top = root(it);
  fix(a, lines, chainOf(a, lines, top), 0, style ?? null);
  return lines;
}

/** org-list-repair, and what C-c C-c does on an item with no checkbox. */
export function repair(text, line, col = 0) {
  const lines = repairLines(text, line);
  if (!lines) return { error: 'Not at a list item' };
  return { text: join(lines), line, col: Math.max(0, col + lines[line].text.length - splitLines(text)[line].text.length) };
}

const track = (col, a, b, n) => (col > b ? col + n - (b - a) : col >= a && b > a ? a : col);

/**
 * M-RET on an item: a new item. Before the text of the item it goes above; elsewhere the line is split at the cursor and what follows
 * goes to the new item. It takes the bullet of this item (numbers run on) and no checkbox, unless `box` (M-S-RET) asks for one.
 * Returns null when the cursor is not in an item.
 */
export function insertItem(text, line, col, { box = false } = {}) {
  const a = analyze(text);
  const lines = splitLines(text);
  const it = itemAt(a, line);
  if (!it) return null;
  const own = info(lines[it.line].text);
  const bullet = own.ordered ? `${own.num + (line === it.line && col <= own.textStart ? 0 : 1)}${own.delim}` : own.bullet;
  const head = ' '.repeat(own.indent) + bullet + own.space;
  const mark = box ? '[ ] ' : '';
  const tag = own.described ? ' :: ' : '';
  let at;
  const tagEnd = own.described ? lines[it.line].text.indexOf(' :: ') : -1; // the cursor in the tag of a description item is before its text
  if (line === it.line && (col <= own.textStart || (tagEnd >= 0 && col <= tagEnd))) {
    at = it.line;
    lines.splice(at, 0, { text: head + mark + tag, eol: '\n' });
    if (tag) lines[at].text = head + mark + tag;
  } else {
    const t = lines[line].text;
    const before = t.slice(0, col).replace(/[ \t]+$/, '');
    const after = t.slice(col).replace(/^[ \t]+/, '');
    const eol = lines[line].eol;
    lines[line] = { text: before, eol: '\n' };
    at = line + 1;
    lines.splice(at, 0, { text: head + mark + tag + after, eol });
  }
  const out = repairLines(join(lines), at);
  const t = out[at].text;
  const m = info(t);
  return { text: join(out), line: at, col: tag ? m.indent + m.bullet.length + own.space.length : m.textStart };
}

/** The bullet after `bullet` when cycling forward (or back) through BULLETS. */
export const nextBullet = (bullet, back = false) => {
  const kind = /\d/.test(bullet) ? (bullet.endsWith('.') ? '1.' : '1)') : bullet === '*' ? '-' : bullet;
  const i = BULLETS.indexOf(kind);
  return BULLETS[(i + (back ? BULLETS.length - 1 : 1)) % BULLETS.length];
};

/** Makes the text lines in a region (0-based, `from` up to `to`) items; blank lines stay. */
function makeItems(text, from, to) {
  const lines = splitLines(text);
  for (let n = from; n < to && n < lines.length; n++) {
    const t = lines[n].text;
    if (t.trim() === '' || info(t) || /^\*+ /.test(t)) { if (/^(\*+) /.test(t)) lines[n] = { ...lines[n], text: t.replace(/^\*+/, '-') }; continue; }
    const k = indentOf(t);
    lines[n] = { ...lines[n], text: t.slice(0, k) + '- ' + t.slice(k) };
  }
  return lines;
}

/**
 * C-c - outside a table: on an item it changes the bullet of the whole list to the next kind (`which` a number picks the kind (counting round, so -1 is the last), 'previous' goes back);
 * on a line of text or a heading it makes an item; on a region it makes every line an item. A blank line is left alone.
 * @param {{ region?: [number, number], which?: number | 'previous' }} opts
 */
export function ctrlCMinus(text, line, col, { region = null, which } = {}) {
  if (region) { const lines = makeItems(text, region[0], region[1]); return { text: join(lines), line, col }; }
  const a = analyze(text);
  const it = itemAt(a, line);
  if (it) {
    const own = info(splitLines(text)[it.line].text);
    // an indented list may also use * as its bullet, so a number counts through five kinds there and four at the left margin
    const kinds = own.indent > 0 ? ['-', '+', '*', '1.', '1)'] : BULLETS;
    const style = typeof which === 'number' ? kinds[((which % kinds.length) + kinds.length) % kinds.length] : nextBullet(own.bullet, which === 'previous');
    const lines = repairLines(text, it.line, style);
    const old = splitLines(text)[line].text;
    const mine = info(old);
    const cur = info(lines[line].text);
    // the cursor in a changed bullet goes to its start; after it, it moves with the text
    return { text: join(lines), line, col: line === it.line ? track(col, mine.indent, mine.indent + mine.bullet.length, cur.bullet.length) : col + lines[line].text.length - old.length };
  }
  const t = splitLines(text)[line]?.text ?? '';
  if (t.trim() === '') return { text, line, col };
  const lines = makeItems(text, line, line + 1);
  const k = indentOf(t);
  return { text: join(lines), line, col: /^\*+ /.test(t) ? track(col, 0, t.indexOf(' '), 1) : track(col, k, k, 2) };
}

/** org-toggle-item: an item becomes a line of text, a line of text becomes an item; a region does the same for each line. */
export function toggleItem(text, line, col, { region = null } = {}) {
  if (region) {
    const lines = splitLines(text);
    const rows = [];
    for (let n = region[0]; n < region[1] && n < lines.length; n++) if (lines[n].text.trim() !== '') rows.push(n);
    if (rows.length && rows.every((n) => info(lines[n].text))) {
      for (const n of rows) { const m = info(lines[n].text); lines[n] = { ...lines[n], text: ' '.repeat(m.indent) + lines[n].text.slice(m.bulletEnd) }; }
      return { text: join(lines), line, col };
    }
    return { text: join(makeItems(text, region[0], region[1])), line, col };
  }
  const lines = splitLines(text);
  const t = lines[line]?.text ?? '';
  const m = info(t);
  if (m) {
    lines[line] = { ...lines[line], text: ' '.repeat(m.indent) + t.slice(m.bulletEnd) };
    return { text: join(lines), line, col: track(col, m.indent, m.bulletEnd, 0) };
  }
  if (t.trim() === '') return { text, line, col };
  return ctrlCMinus(text, line, col);
}

/** org-toggle-heading: an item or a line of text becomes a heading one level below the heading above; a heading becomes text. */
export function toggleHeading(text, line, col) {
  const a = analyze(text);
  const lines = splitLines(text);
  const t = lines[line]?.text ?? '';
  const stars = /^(\*+) /.exec(t);
  if (stars) { lines[line] = { ...lines[line], text: t.slice(stars[0].length) }; return { text: join(lines), line, col: Math.max(0, col - stars[0].length) }; }
  if (t.trim() === '') return { text, line, col };
  const above = [...a.heads].reverse().find((h) => h.line < line);
  const mark = '*'.repeat((above?.level ?? 0) + 1) + ' ';
  const m = info(t);
  if (m) { lines[line] = { ...lines[line], text: mark + t.slice(m.bulletEnd) }; return { text: join(lines), line, col: 0 }; }
  lines[line] = { ...lines[line], text: mark + t.slice(indentOf(t)) };
  return { text: join(lines), line, col: col + mark.length - indentOf(t) };
}

/**
 * org-toggle-checkbox with a prefix argument. C-u adds an empty checkbox to an item that has none and removes the one it has;
 * C-u C-u sets it to the intermediate [-]. Applies to the item at the cursor, or to every item in a region.
 * @param {{ list: 4 | 16, region?: [number, number] }} opts
 */
export function boxCommand(text, line, col, { list, region = null }) {
  const lines = splitLines(text);
  const rows = [];
  if (region) { for (let n = region[0]; n < region[1] && n < lines.length; n++) if (info(lines[n].text)) rows.push(n); }
  else { const it = itemAt(analyze(text), line); if (it) rows.push(it.line); }
  if (!rows.length) return { error: 'Not at an item or heading, and no active region' };
  let at = col;
  for (const n of rows) {
    const t = lines[n].text;
    const m = info(t);
    let next;
    let span;
    if (list === 16) {
      if (m.box !== null) { next = t.slice(0, m.boxAt) + '[-]' + t.slice(m.boxAt + 3); span = [m.boxAt, m.boxAt + 3, 3]; }
      else { const p = m.indent + m.bullet.length + m.space.length + (m.counter !== null ? t.slice(m.bulletEnd).search(/\]/) + 2 : 0); next = t.slice(0, p) + '[-] ' + t.slice(p); span = [p, p, 4]; }
    } else if (m.box !== null) {
      next = t.slice(0, m.boxAt) + t.slice(m.textStart); span = [m.boxAt - 1, m.textStart - 1, 0];
    } else {
      const p = m.bulletEnd + (m.counter !== null ? t.slice(m.bulletEnd).search(/\]/) + 2 : 0);
      next = t.slice(0, p) + '[ ] ' + t.slice(p); span = [p, p, 4];
    }
    lines[n] = { ...lines[n], text: next };
    if (n === line) at = track(col, span[0], span[1], span[2]);
  }
  return { text: updateCheckboxCounts(join(lines)), line, col: at };
}

const TIME = /[<[](\d{4})-(\d\d)-(\d\d)(?:\s+\S+)?(?:\s+(\d\d?):(\d\d))?[^>\]]*[>\]]/;

/**
 * org-sort-list: sorts the items of the list at the cursor (their sub-items go with them). `key` is a alphabetical (ignoring case),
 * n numeric (the first number), t by the first time stamp, x by checkbox state; a capital letter reverses. Equal items keep their order.
 * @param {string} key one of a n t x A N T X
 */
export function sortList(text, line, key) {
  const a = analyze(text);
  const lines = splitLines(text);
  const it = itemAt(a, line);
  if (!it) return { error: 'Not at a list item' };
  const chain = chainOf(a, lines, it);
  const k = key.toLowerCase();
  if (!['a', 'n', 't', 'x'].includes(k)) return { error: `Invalid sorting type: ${key}` };
  const rows = chain.map((c) => {
    const m = info(lines[c.line].text);
    const body = lines[c.line].text.slice(m.textStart);
    let value;
    if (k === 'a') value = body.toLowerCase();
    else if (k === 'n') { const n = /^\s*([-+]?\d+(?:\.\d+)?)/.exec(body); value = n ? Number(n[1]) : 0; }
    else if (k === 't') { const s = TIME.exec(body); value = s ? `${s[1]}${s[2]}${s[3]}${(s[4] ?? '00').padStart(2, '0')}${s[5] ?? '00'}` : ''; }
    else value = m.box ?? '';
    return { c, value, block: lines.slice(c.line, c.end) };
  });
  const cmp = (x, y) => (x.value < y.value ? -1 : x.value > y.value ? 1 : 0);
  rows.sort((x, y) => (key === k ? cmp(x, y) : cmp(y, x)));
  const from = chain[0].line;
  const to = chain[chain.length - 1].end;
  const between = lines.slice(from, to).filter((_, i) => !chain.some((c) => from + i >= c.line && from + i < c.end));
  const next = [...lines.slice(0, from), ...rows.flatMap((r) => r.block), ...between, ...lines.slice(to)];
  const out = repairLines(join(next), from) ?? next;
  return { text: Array.isArray(out) ? join(out) : out, line: from, col: info(splitLines(join(next))[from].text)?.ordered ? info(lines[line].text)?.textStart ?? 0 : 0, messages: ['Sorting items...', 'Sorting items...done'] };
}

/**
 * RET in the text of an item's first line (Emacs 30.1, li2-ret-*): the line breaks at the cursor, the left part loses its trailing space and
 * the new line is indented to where the item's text starts (not past a checkbox). Returns null elsewhere, where RET stays a plain newline.
 */
export function returnInItem(text, line, col) {
  const lines = splitLines(text);
  const it = itemAt(analyze(text), line);
  if (!it || it.line !== line) return null;
  const own = info(lines[line].text);
  if (col < own.textStart) return null;
  const t = lines[line].text;
  const pad = ' '.repeat(own.indent + own.bullet.length + own.space.length);
  lines[line] = { text: t.slice(0, col).replace(/[ \t]+$/, ''), eol: '\n' };
  lines.splice(line + 1, 0, { text: pad + t.slice(col), eol: lines[line].eol === '' ? '' : '\n' });
  const eol = splitLines(text)[line].eol;
  lines[line + 1] = { ...lines[line + 1], eol };
  return { text: join(lines), line: line + 1, col: pad.length };
}

/** Whether the line is the first line of an item (S-LEFT and S-RIGHT anywhere on it change the bullet, as C-c - does). */
export function onItemLine(text, line) {
  const it = itemAt(analyze(text), line);
  return !!it && it.line === line;
}
