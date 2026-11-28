// Inline markup as it is shown: links show their description (or their path), emphasis is styled with its markers kept, as Emacs shows them.
// The Outline view draws nodes; the Text view, whose letters must keep their width, only decorates ranges of the text.

import { scanLine, unescapeLink } from '../../core/links.js';
import { scanEmphasis, emphasisByLine } from '../../core/emphasis.js';
import { analyze } from '../../core/outline.js';
import { h } from './dom.js';

const LINKS = new Set(['bracket', 'angle', 'plain', 'radio-link']);
const MARK = { bold: '*', italic: '/', underline: '_', 'strike-through': '+', verbatim: '=', code: '~' };
const TAG = { bold: 'b', italic: 'i', underline: 'u', 'strike-through': 's', verbatim: 'code', code: 'code' };

/** The links of a line, and the ranges where a link's own text (its path) must not start emphasis. */
function objects(line, spans, radios = []) {
  const links = scanLine(line, radios).filter((o) => LINKS.has(o.kind) && !(o.kind !== 'bracket' && false));
  const skip = links.map((o) => (o.kind === 'bracket' ? [o.start, o.desc !== undefined ? o.end - o.desc.length - 2 : o.end] : [o.start, o.end]));
  return { links, emphasis: spans ?? scanEmphasis(line, skip) };
}

/** Where emphasis may not start or end in a line: a bracket link's path, or a whole plain or angle link. */
const skipOf = (line) => scanLine(line).filter((o) => LINKS.has(o.kind)).map((o) => (o.kind === 'bracket' ? [o.start, o.desc !== undefined ? o.end - o.desc.length - 2 : o.end] : [o.start, o.end]));

/** The emphasis of every line of a text, by line number; a span may run over several lines of one paragraph. */
export const emphasisOf = (text) => emphasisByLine(analyze(text).nodes, skipOf);

/** What a link shows: its description, or its path. */
export const linkLabel = (o, line = '') => (o.kind === 'radio-link' ? line.slice(o.start, o.end) : o.kind === 'bracket' ? (o.desc !== undefined ? o.desc : unescapeLink(o.raw)) : o.kind === 'angle' ? `${o.type}:${o.path}` : `${o.type}:${o.path}`);

/**
 * The nodes for a line (or any text): `at(col)` is called by a tapped link with the column where that link starts.
 * Text with no markup comes back as one string.
 */
export function inlineNodes(line, onLink, base = 0, spans = undefined, radios = []) {
  const { links, emphasis } = objects(line, spans, radios);
  if (links.length === 0 && emphasis.length === 0) return [line];
  const items = [...links.map((o) => ({ ...o, link: true })), ...emphasis].sort((a, b) => a.start - b.start || b.end - a.end);
  const out = [];
  let pos = 0;
  for (const o of items) {
    if (o.start < pos) continue;
    if (o.start > pos) out.push(line.slice(pos, o.start));
    if (o.link) {
      const label = linkLabel(o, line);
      out.push(h('span', { class: 'ol-link', role: 'link', tabindex: '0', title: o.kind === 'bracket' ? unescapeLink(o.raw) : label, onclick: (e) => { e.stopPropagation(); onLink(base + o.start); } }, ...(o.kind === 'bracket' && o.desc !== undefined ? inlineNodes(label, () => onLink(base + o.start)) : [label])));
    } else {
      const m = MARK[o.kind];
      const open = o.open ?? true;
      const close = o.close ?? true;
      out.push(h(TAG[o.kind], { class: `em-${o.kind}` }, open ? m : null, ...(o.kind === 'verbatim' || o.kind === 'code' ? [line.slice(o.inner[0], o.inner[1])] : inlineNodes(line.slice(o.inner[0], o.inner[1]), onLink, base + o.inner[0], undefined, radios)), close ? m : null));
    }
    pos = o.end;
  }
  if (pos < line.length) out.push(line.slice(pos));
  return out;
}

/** Ranges of a line the Text view decorates: { from, to, cls }. Only what keeps the letters where they are. */
export function decorations(line, spans, radios = [], pieces = []) {
  if (!/[[*/_+=~<:]/.test(line) && !(spans && spans.length) && radios.length === 0) return [];
  const { links, emphasis } = objects(line, spans ?? [], radios);
  const out = [...links, ...pieces].map((o) => ({ from: o.start, to: o.end, cls: 'tv-link' }));
  for (const e of emphasis) {
    if (e.kind === 'underline') out.push({ from: e.start, to: e.end, cls: 'tv-u' });
    else if (e.kind === 'strike-through') out.push({ from: e.start, to: e.end, cls: 'tv-s' });
    else if (e.kind === 'verbatim' || e.kind === 'code') out.push({ from: e.start, to: e.end, cls: 'tv-code' });
  }
  return out;
}
