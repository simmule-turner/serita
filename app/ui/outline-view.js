// The Outline view: headings as a foldable tree, with the text under each heading that is not folded.
// It only draws; the folds and the text come from the document, and taps go to `on`.

import { analyze, ellipsisLines, hiddenLines } from '../../core/outline.js';
import { h } from './dom.js';

const CHECKBOX = /^([ \t]*(?:[-+*]|\d+[.)])[ \t]+(?:\[@\d+\][ \t]+)?)\[([ X-])\](.*)$/s;

/**
 * @param {HTMLElement} root
 * @param {{ text: string, folds: object, hideStars: boolean,
 *   on: { cycle(line: number): void, todo(line: number): void, actions(line: number): void, checkbox(line: number): void } }} o
 */
export function renderOutline(root, { text, folds, hideStars, on }) {
  const { heads, items, drawers, foldables, nodes, todo } = analyze(text);
  const hidden = hiddenLines(foldables, folds);
  const dots = ellipsisLines(foldables, folds);
  const itemAt = new Map([...items, ...drawers].map((x) => [x.line, x]));
  const headAt = new Map(heads.map((x) => [x.line, x]));
  const rows = [];
  nodes.forEach((node, line) => {
    if (hidden.has(line)) return;
    const hd = headAt.get(line);
    if (hd) {
      const hasContent = hd.end > hd.line + 1;
      const isDone = hd.todo !== null && todo.done.includes(hd.todo);
      rows.push(h('div', { class: 'ol-head', 'data-line': String(line) },
        h('button', { class: 'chev', 'aria-label': folds[line] ? 'Show' : 'Hide', onclick: () => on.cycle(line) }, hasContent ? (folds[line] ? '▸' : '▾') : ''),
        h('span', { class: 'stars' }, hideStars ? `${' '.repeat(hd.level - 1)}*` : '*'.repeat(hd.level)),
        hd.todo === null ? null : h('button', { class: `st ${isDone ? 'done' : 'todo'}`, onclick: () => on.todo(line) }, hd.todo),
        h('button', { class: 'title', onclick: () => on.actions(line) }, (hd.priority ? `[#${hd.priority}] ` : '') + hd.title),
        hd.tags.length ? h('span', { class: 'tags' }, `:${hd.tags.join(':')}:`) : null,
        dots.has(line) ? h('span', { class: 'dots' }, '…') : null));
      return;
    }
    const raw = node.line.text;
    const m = CHECKBOX.exec(raw);
    const it = itemAt.get(line);
    const chev = it && it.end > it.line + 1 ? h('button', { class: 'ichev', 'aria-label': folds[line] ? 'Show' : 'Hide', onclick: () => on.cycle(line) }, folds[line] ? '▸' : '▾') : null;
    rows.push(h('div', { class: `ol-line${raw.trim() === '' ? ' blank' : ''}` }, chev, m ? [m[1], h('button', { class: 'box', 'aria-label': m[2] === 'X' ? 'Checked' : 'Unchecked', onclick: () => on.checkbox(line) }, `[${m[2]}]`), m[3]] : raw === '' ? ' ' : raw));
  });
  root.replaceChildren(...rows);
}
