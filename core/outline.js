// The outline of a document: its headings, which lines are hidden by folding, and how
// visibility cycles. Folds are { [headline line number]: 'all' | 'body' }: 'all' hides everything
// under the heading, 'body' hides only its own text and keeps its sub-headings.
// Every view (Outline, Text) reads this one model; none keeps folding of its own.

import { parse, DEFAULT_TODO } from './parse.js';

/**
 * Reads #+TODO, #+SEQ_TODO and #+TYP_TODO lines. Each is a sequence "A B | C"; without "|" the last word is the done state.
 * Fast-selection letters such as "TODO(t)" are dropped. Without any such line the default sequence applies.
 * @param {string} text
 * @returns {{ sequences: { open: string[], done: string[] }[], open: string[], done: string[] }}
 */
export function todoOptions(text) {
  const sequences = [];
  for (const m of text.matchAll(/^[ \t]*#\+(?:SEQ_TODO|TYP_TODO|TODO):[ \t]*(.*)$/gim)) {
    const words = m[1].trim().split(/\s+/).filter(Boolean);
    const bar = words.indexOf('|');
    const clean = (w) => w.replace(/\(.*\)$/, '');
    const open = (bar === -1 ? words.slice(0, -1) : words.slice(0, bar)).map(clean);
    const done = (bar === -1 ? words.slice(-1) : words.slice(bar + 1)).map(clean);
    if (open.length + done.length > 0) sequences.push({ open, done });
  }
  if (sequences.length === 0) sequences.push({ open: [...DEFAULT_TODO.open], done: [...DEFAULT_TODO.done] });
  return { sequences, open: sequences.flatMap((s) => s.open), done: sequences.flatMap((s) => s.done) };
}

/**
 * @typedef {{ line: number, level: number, parent: Head|null, children: Head[], end: number, bodyEnd: number,
 *   todo: string|null, title: string, tags: string[], priority: string|null, comment: boolean }} Head
 */

/**
 * Headings and per-line nodes, in line order. `end` is the line after the heading's subtree;
 * `bodyEnd` is the line where its own text ends (the first sub-heading, or `end`).
 * @param {string} text
 */
export function analyze(text) {
  const todo = todoOptions(text);
  const { root } = parse(text, { todo: { open: todo.open, done: todo.done } });
  /** @type {Head[]} */ const heads = [];
  const nodes = [];
  const walk = (list, parent) => {
    for (const node of list) {
      nodes.push(node);
      if (node.type !== 'headline') continue;
      const h = { line: nodes.length - 1, level: node.level, parent, children: [], end: 0, bodyEnd: 0,
        todo: node.todo, title: node.title, tags: node.tags, priority: node.priority, comment: node.comment };
      heads.push(h);
      parent?.children.push(h);
      walk(node.children, h);
      h.end = nodes.length;
      h.bodyEnd = h.children.length ? h.children[0].line : h.end;
    }
  };
  walk(root.children, null);
  const items = listItems(nodes);
  const drawers = drawersOf(nodes);
  return { heads, items, drawers, foldables: [...heads, ...items, ...drawers].sort((a, b) => a.line - b.line), nodes, total: nodes.length, todo };
}

/** Drawers (:PROPERTIES: and the like) that have an :END: before the next heading. They fold like headings do. */
function drawersOf(nodes) {
  const out = [];
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].type !== 'drawer-begin') continue;
    let end = i + 1;
    while (end < nodes.length && nodes[end].type !== 'drawer-end' && nodes[end].type !== 'headline') end++;
    if (end < nodes.length && nodes[end].type === 'drawer-end') {
      out.push({ line: i, level: 0, parent: null, children: [], end: end + 1, bodyEnd: end + 1, isDrawer: true });
      i = end;
    }
  }
  return out;
}

const indentOf = (s) => s.match(/^[ \t]*/)[0].length;

/**
 * List items, with the lines each one owns: the lines after it that are indented deeper, up to a heading,
 * a line at or left of its own indentation, or a second blank line. They fold like headings do.
 * @returns {{ line: number, indent: number, level: number, parent: any, children: any[], end: number, bodyEnd: number, isItem: true }[]}
 */
function listItems(nodes) {
  const items = [];
  const stack = [];
  nodes.forEach((n, i) => {
    if (n.type !== 'list-item') return;
    let last = i + 1;
    let blank = 0;
    let inBlock = false;
    for (let j = i + 1; j < nodes.length; j++) {
      const m = nodes[j];
      if (m.type === 'headline') break;
      if (m.type === 'blank') { if (++blank >= 2) break; continue; }
      if (m.type === 'block-line' || m.type === 'block-end') {
        if (!inBlock) break;
        if (m.type === 'block-end') inBlock = false;
        last = j + 1;
        blank = 0;
        continue;
      }
      if (indentOf(m.line.text) <= n.indent) break;
      if (m.type === 'block-begin') inBlock = true;
      last = j + 1;
      blank = 0;
    }
    while (stack.length && (stack[stack.length - 1].end <= i || stack[stack.length - 1].indent >= n.indent)) stack.pop();
    const parent = stack.length ? stack[stack.length - 1] : null;
    const item = { line: i, indent: n.indent, level: n.indent, parent, children: [], end: last, bodyEnd: last, isItem: true };
    parent?.children.push(item);
    items.push(item);
    stack.push(item);
  });
  for (const it of items) if (it.children.length) it.bodyEnd = it.children[0].line;
  return items;
}

const range = (a, b) => Array.from({ length: Math.max(0, b - a) }, (_, i) => a + i);

/** The lines hidden by the folds. */
export function hiddenLines(heads, folds) {
  const hidden = new Set();
  for (const h of heads) {
    const how = folds[h.line];
    if (how === 'all') for (const i of range(h.line + 1, h.end)) hidden.add(i);
    else if (how === 'body') for (const i of range(h.line + 1, h.bodyEnd)) hidden.add(i);
  }
  for (const [k, how] of Object.entries(folds)) if (how === 'show') hidden.delete(Number(k));
  return hidden;
}

/** The headings that show an ellipsis because something under them is hidden. */
export function ellipsisLines(heads, folds) {
  const out = new Set();
  const hidden = hiddenLines(heads, folds);
  for (const h of heads) {
    if (folds[h.line] === 'show' && hidden.has(h.line + 1)) out.add(h.line);
    if ((folds[h.line] === 'all' && h.end > h.line + 1) || (folds[h.line] === 'body' && h.bodyEnd > h.line + 1)) out.add(h.line);
  }
  return out;
}

const hasContent = (h) => h.end > h.line + 1;
const descendants = (h) => { const out = []; const go = (x) => { for (const c of x.children) { out.push(c); go(c); } }; go(h); return out; };

/** The cycle state of one heading: 'folded', 'children' or 'subtree'. */
export function stateOf(h, folds) {
  if (folds[h.line]) return 'folded';
  if (h.children.length > 0 && h.children.filter(hasContent).every((c) => folds[c.line] === 'all') && h.children.some(hasContent)) return 'children';
  return 'subtree';
}

/**
 * Cycles one heading: folded, then children, then the whole subtree, then folded again, as Emacs does.
 * `last` is the state the previous press of TAB on this heading left it in; without it the state is read from the folds.
 * With no sub-headings there is no children state.
 * @returns {{ folds: object, state: 'folded'|'children'|'subtree' } | null} null when nothing is under the heading
 */
export function cycle(heads, folds, line, last = null) {
  const h = heads.find((x) => x.line === line);
  if (!h || !hasContent(h)) return null;
  // After a sparse tree the first TAB folds the heading and drops what the tree was holding open, as Emacs does.
  if (Object.values(folds).includes('show')) {
    const f = Object.fromEntries(Object.entries(folds).filter(([, how]) => how !== 'show'));
    for (const d of descendants(h)) delete f[d.line];
    f[h.line] = 'all';
    return { folds: f, state: 'folded' };
  }
  const apply = (state) => {
    const f = { ...folds };
    for (const d of descendants(h)) delete f[d.line];
    for (const d of heads) if (d.isDrawer && d.line > h.line && d.line < h.end) delete f[d.line];
    delete f[h.line];
    if (state === 'folded') f[h.line] = 'all';
    else if (state === 'children') for (const c of h.children) if (hasContent(c)) f[c.line] = 'all';
    return f;
  };
  const order = ['folded', 'children', 'subtree'];
  let at = order.indexOf(last ?? stateOf(h, folds));
  at = (at + 1) % 3;
  if (order[at] === 'children' && h.children.length === 0) at = (at + 1) % 3;
  return { folds: apply(order[at]), state: order[at] };
}

/** Headings only (everything folded to the top level). The text before the first heading stays visible. */
export const overview = (heads) => Object.fromEntries(heads.filter((h) => h.level === Math.min(...heads.map((x) => x.level)) && !h.parent && hasContent(h)).map((h) => [h.line, 'all']));

/** Every heading shown, with its own text hidden. With `depth`, headings deeper than that are hidden too. */
export function contents(heads, depth = Infinity) {
  const f = {};
  for (const h of heads) {
    if (h.level > depth) continue;
    if (h.level === depth) { if (hasContent(h)) f[h.line] = 'all'; } else if (h.bodyEnd > h.line + 1) f[h.line] = 'body';
  }
  return f;
}

/** Buffer-wide cycle: overview, then contents, then everything shown. */
export function cycleGlobal(heads, folds) {
  const own = new Set(heads.map((h) => h.line));
  const key = (f) => JSON.stringify(Object.entries(f).filter(([k]) => own.has(Number(k))).sort((a, b) => a[0] - b[0]));
  const here = key(folds);
  if (here === key(overview(heads))) return { folds: contents(heads), state: 'contents' };
  if (here === key(contents(heads))) return { folds: {}, state: 'show all' };
  return { folds: overview(heads), state: 'overview' };
}

/** The folds a file asks for with #+STARTUP. Without one, everything is shown. */
export function startupFolds(text) {
  const { heads, drawers } = analyze(text);
  const closed = Object.fromEntries(drawers.map((d) => [d.line, 'all']));
  for (const m of text.matchAll(/^[ \t]*#\+STARTUP:[ \t]*(.*)$/gim)) {
    for (const w of m[1].toLowerCase().split(/\s+/)) {
      if (w === 'overview') return { ...closed, ...overview(heads) };
      if (w === 'content') return { ...closed, ...contents(heads) };
      if (w === 'showall' || w === 'showeverything') return closed;
      const n = /^show([2-5])levels$/.exec(w);
      if (n) return { ...closed, ...contents(heads, Number(n[1])) };
    }
  }
  return closed;
}

const count = (s) => (s.match(/\n/g) ?? []).length;

/** Moves fold line numbers along with a text edit, dropping folds in removed lines. */
export function remapFolds(folds, oldText, from, to, insert) {
  const startLine = count(oldText.slice(0, from));
  const removed = count(oldText.slice(from, to));
  const added = count(insert);
  const out = {};
  for (const [k, how] of Object.entries(folds)) {
    const line = Number(k);
    if (line <= startLine) out[line] = how;
    else if (line > startLine + removed) out[line + added - removed] = how;
  }
  return out;
}

/** Keeps only the folds that sit on a heading with something to hide. */
export function validFolds(heads, folds) {
  const by = new Map(heads.map((h) => [h.line, h]));
  return Object.fromEntries(Object.entries(folds).filter(([k, how]) => {
    const h = by.get(Number(k));
    return how === 'show' || (h && (how === 'all' ? hasContent(h) : h.bodyEnd > h.line + 1));
  }));
}

/** The smallest change that turns `a` into `b`, as one replacement of `a`. */
export function diff(a, b) {
  const max = Math.min(a.length, b.length);
  let from = 0;
  while (from < max && a[from] === b[from]) from++;
  let tail = 0;
  while (tail < max - from && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++;
  return { from, to: a.length - tail, insert: b.slice(from, b.length - tail) };
}

/** Opens every fold that hides the given line. */
export function reveal(heads, folds, line) {
  const f = { ...folds };
  for (const h of heads) {
    if (f[h.line] === 'all' && line > h.line && line < h.end) delete f[h.line];
    else if (f[h.line] === 'body' && line > h.line && line < h.bodyEnd) delete f[h.line];
  }
  return f;
}

/**
 * A sparse tree: everything folded to the top level, except the given lines and the headings above them, which stay visible.
 * Replaces the folds. Lines before the first heading are left alone.
 * @param {Head[]} heads headings only
 * @param {number[]} lines the lines that matched
 */
export function sparseFolds(heads, lines) {
  const folds = {};
  for (const h of heads) if (!h.parent && hasContent(h)) folds[h.line] = 'all';
  for (const line of lines) {
    let h = null;
    for (const x of heads) if (x.line <= line && line < x.end) h = x;
    if (!h) continue;
    if (h.line !== line) folds[line] = 'show';
    for (let a = h; a; a = a.parent) if (a.parent) folds[a.line] = 'show';
  }
  return folds;
}
