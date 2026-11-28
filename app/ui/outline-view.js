// The Outline view: headings as a foldable tree, with the text under each heading that is not folded.
// It only draws; the folds and the text come from the document, and taps go to `on`.

import { analyze, ellipsisLines, hiddenLines } from '../../core/outline.js';
import { tableView } from '../../core/table.js';
import { h } from './dom.js';
import { inlineNodes, emphasisOf } from './inline.js';
import { radioNames, radioBreaks } from '../../core/links.js';

/** A line's emphasis spans for the part of it that starts at `base` (the text after a checkbox). */
const shift = (list = [], base) => list.map((e) => ({ ...e, start: Math.max(0, e.start - base), end: e.end - base, inner: e.inner.map((x) => Math.max(0, x - base)) })).filter((e) => e.end > 0);

const CHECKBOX = /^([ \t]*(?:[-+*]|\d+[.)])[ \t]+(?:\[@\d+\][ \t]+)?)\[([ X-])\](.*)$/s;

/**
 * @param {HTMLElement} root
 * @param {{ text: string, folds: object, hideStars: boolean, indent?: boolean,
 *   on: { cycle(line: number): void, todo(line: number): void, actions(line: number): void, checkbox(line: number): void, cell(line: number, col: number): void } }} o
 */
export function renderOutline(root, { text, folds, hideStars, indent = false, tables = null, on }) {
  const { heads, items, drawers, foldables, nodes, todo } = analyze(text);
  const hidden = hiddenLines(foldables, folds);
  const dots = ellipsisLines(foldables, folds);
  const itemAt = new Map([...items, ...drawers].map((x) => [x.line, x]));
  const headAt = new Map(heads.map((x) => [x.line, x]));
  const radios = on.link ? radioNames(text) : [];
  const broken = on.link ? radioBreaks(text, radios) : new Map();
  const spans = on.link ? emphasisOf(text) : new Map();
  const rows = [];
  let level = 0;
  let tableEnd = 0;
  nodes.forEach((node, line) => {
    const hd = headAt.get(line);
    if (hd) level = hd.level;
    if (hidden.has(line) || line < tableEnd) return;
    if (node.type === 'table-row' || node.type === 'table-rule') {
      const v = tableView(text, line);
      tableEnd = v.end;
      rows.push(drawTable(v, on, tables, indent ? `calc(32px + ${level * 2}ch)` : null));
      return;
    }
    if (hd) {
      const hasContent = hd.end > hd.line + 1;
      const isDone = hd.todo !== null && todo.done.includes(hd.todo);
      rows.push(h('div', { class: 'ol-head', 'data-line': String(line) },
        h('button', { class: 'chev', 'aria-label': folds[line] ? 'Show' : 'Hide', onclick: () => on.cycle(line) }, hasContent ? (folds[line] ? '▸' : '▾') : ''),
        h('span', { class: 'stars' }, indent ? `${' '.repeat((hd.level - 1) * 2)}*` : hideStars ? `${' '.repeat(hd.level - 1)}*` : '*'.repeat(hd.level)),
        hd.todo === null ? null : h('button', { class: `st ${isDone ? 'done' : 'todo'}`, onclick: () => on.todo(line) }, hd.todo),
        h('button', { class: 'title', onclick: () => on.actions(line) }, (hd.priority ? `[#${hd.priority}] ` : ''), ...(on.link ? inlineNodes(hd.title, (c) => on.link(line, c), Math.max(0, node.line.text.indexOf(hd.title, hd.level)), undefined, radios) : [hd.title])),
        hd.tags.length ? h('span', { class: 'tags' }, `:${hd.tags.join(':')}:`) : null,
        dots.has(line) ? h('span', { class: 'dots' }, '…') : null));
      return;
    }
    const raw = node.line.text;
    const plainLine = node.type === 'text' || node.type === 'list-item';
    const rich = (str, base) => (on.link && plainLine ? inlineNodes(str, (c) => on.link(line, c), base, base === 0 ? (spans.get(line) ?? []) : shift(spans.get(line), base), radios, (broken.get(line) ?? []).map((p) => ({ ...p, start: p.start - base, end: p.end - base })).filter((p) => p.start >= 0)) : [str]);
    const m = CHECKBOX.exec(raw);
    const it = itemAt.get(line);
    const chev = it && it.end > it.line + 1 ? h('button', { class: 'ichev', 'aria-label': folds[line] ? 'Show' : 'Hide', onclick: () => on.cycle(line) }, folds[line] ? '▸' : '▾') : null;
    rows.push(h('div', { class: `ol-line${raw.trim() === '' ? ' blank' : ''}`, 'data-line': String(line), style: indent ? `padding-left: calc(32px + ${level * 2}ch)` : undefined }, chev, m ? [m[1], h('button', { class: 'box', 'aria-label': m[2] === 'X' ? 'Checked' : 'Unchecked', onclick: () => on.checkbox(line) }, `[${m[2]}]`), ...rich(m[3], m[1].length + 3)] : raw === '' ? ' ' : rich(raw, 0)));
  });
  root.replaceChildren(...rows);
}

/** A table as a grid. A tap on a cell goes to `on.cell(line, column)`; a width cookie shortens what the grid shows, not the text. */
function drawTable(v, on, tables, pad) {
  const clip = (c, j) => (!tables?.wrap && v.limit[j] !== null && [...c].length > v.limit[j] ? `${[...c].slice(0, Math.max(0, v.limit[j] - 1)).join('')}…` : c);
  const trs = v.rows.map((r, i) => {
    if (r.rule && tables?.numbers) return h('tr', { class: 'rule nums' }, h('td', { class: 'num' }, `I*${v.rows.slice(0, i + 1).filter((x) => x.rule).length}`), ...Array.from({ length: v.n }, (_, j) => h('td', { class: 'num' }, `$${j + 1}`)));
    if (r.rule) return h('tr', { class: 'rule' }, h('td', { colspan: String(Math.max(1, v.n)) }));
    const no = v.rows.slice(0, i + 1).filter((x) => !x.rule).length;
    return h('tr', { class: r.cookies ? 'cookies' : v.rows.slice(i + 1).some((x) => x.rule) && !v.rows.slice(0, i).some((x) => x.rule) ? 'head' : '' },
      tables?.numbers ? h('td', { class: 'num' }, String(no)) : null,
      ...r.cells.map((c, j) => h('td', { class: v.align[j] === 'r' ? 'r' : v.align[j] === 'c' ? 'c' : '', style: tables?.wrap && v.limit[j] !== null ? `max-width: ${v.limit[j] + 2}ch` : undefined },
        h('button', { class: 'cell', 'aria-label': `Cell ${j + 1}, ${c || 'empty'}`, onclick: () => on.cell(r.line, j) }, clip(c, j) || ' '))));
  });
  return h('div', { class: `ol-table${tables?.wrap ? ' wrap' : ''}${tables?.zebra ? ' zebra' : ''}`, style: [pad ? `padding-left: ${pad}` : '', tables && tables.fraction < 1 ? `max-width: ${Math.round(tables.fraction * 100)}%` : ''].filter(Boolean).join(';') || undefined }, h('table', {}, h('tbody', {}, ...trs)));
}
