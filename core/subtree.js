// Cutting, copying and pasting subtrees: org-cut-subtree, org-copy-subtree and org-paste-subtree
// (checked against Emacs 30.1 results; no Emacs or Org source was read).

import { splitLines } from './parse.js';
import { analyze } from './outline.js';
import { DEFAULT_TAGS_COLUMN, setTags } from './outline-edit.js';

const join = (lines) => lines.map((l) => l.text + l.eol).join('');
const STARS = /^(\*+)(?: |$)/;

/** `text` (one or more subtrees) with every heading moved by the same number of levels, so the first is at `level`; tags follow when the level changes. */
export function relevel(text, level, column = DEFAULT_TAGS_COLUMN) {
  const first = splitLines(text).map((l) => STARS.exec(l.text)).find(Boolean);
  if (!first) return text;
  const delta = level - first[1].length;
  if (delta === 0) return text;
  const lines = splitLines(text).map((l) => {
    const m = STARS.exec(l.text);
    return m ? { ...l, text: '*'.repeat(Math.max(1, m[1].length + delta)) + l.text.slice(m[1].length) } : l;
  });
  let moved = join(lines);
  for (const x of analyze(moved).heads) if (x.tags.length) moved = setTags(moved, x.line, x.tags, column).text;
  return moved;
}

/** The heading at or above `line` (0-based), or null before the first one. */
const headAt = (a, line) => [...a.heads].reverse().find((x) => x.line <= line) ?? null;

/**
 * The text of `count` subtrees from the one at `line`: the heading, everything under it and the blank lines after it, then the next
 * siblings (as many as there are, up to `count`).
 * @returns {{ text: string, from: number, to: number, count: number }} the subtrees' text and their lines [from, to)
 */
export function subtreeAt(text, line, count = 1) {
  const a = analyze(text);
  const h = headAt(a, line);
  if (!h) throw new Error('Before first headline');
  let last = h;
  for (let i = 1; i < count; i++) {
    const next = a.heads.find((x) => x.line === last.end);
    if (!next || next.level !== h.level) break;
    last = next;
  }
  const lines = splitLines(text);
  return { text: join(lines.slice(h.line, last.end)), from: h.line, to: last.end, count: lines.slice(h.line, last.end).length };
}

/** org-cut-subtree: removes the subtrees and returns what was removed; the cursor goes to the line where they were. */
export function cutSubtree(text, line, count = 1) {
  const s = subtreeAt(text, line, count);
  const lines = splitLines(text);
  return { text: join([...lines.slice(0, s.from), ...lines.slice(s.to)]), killed: s.text, line: s.from };
}

/**
 * org-paste-subtree: inserts `killed` as a heading and its subtree. At the start of a heading it goes before that heading, at that
 * heading's level. Elsewhere it goes at the end of the entry the cursor is in, before its first child, at the level of that child (or of
 * the entry when it has none). Before the first heading it goes before that heading. `after` (C-u) puts it after the whole subtree at the
 * same level. `level` (a numeric prefix) sets the level instead.
 * @param {number} line the cursor's line (0-based) @param {number} col the cursor's column
 * @returns {{ text: string, line: number }} the new text and the line where the pasted text starts
 */
export function pasteSubtree(text, line, col, killed, { level, after = false, column = DEFAULT_TAGS_COLUMN } = {}) {
  if (killed === undefined) throw new Error('Kill ring is empty');
  if (!STARS.test(killed)) throw new Error('The kill is not a (set of) tree(s)');
  const a = analyze(text);
  const lines = splitLines(text);
  const h = headAt(a, line);
  let at; let into;
  if (!h) { const first = a.heads[0]; at = first ? first.line : lines.length; into = first?.level ?? 1; }
  else if (after) { at = h.end; into = h.level; }
  else if (h.line === line && col === 0) { at = line; into = h.level; }
  else { at = h.bodyEnd; into = h.children[0]?.level ?? h.level; }
  let sub = relevel(killed, level ?? into, column);
  if (!sub.endsWith('\n')) sub += '\n';
  if (at > 0 && at <= lines.length && lines[at - 1].eol === '') lines[at - 1] = { ...lines[at - 1], eol: '\n' };
  lines.splice(at, 0, ...splitLines(sub));
  return { text: join(lines), line: at };
}
