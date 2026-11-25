// Property drawers: setting and deleting a heading's properties, as Emacs lays them out.
// Each function takes the text and the heading's line number and returns { text, line, remap, drawer }, where `drawer` is the line of
// a :PROPERTIES: line that was just created (null otherwise), so the caller can fold it.

import { splitLines } from './parse.js';
import { analyze } from './outline.js';

const join = (lines) => lines.map((l) => l.text + l.eol).join('');
const PLANNING = /^[ \t]*(?:SCHEDULED|DEADLINE|CLOSED):/;
const PROPERTY = /^[ \t]*:([^\s:]+):(?:[ \t]+(.*?))?[ \t]*$/;

export const headOf = (text, line) => {
  const a = analyze(text);
  const h = a.heads.find((x) => x.line === line);
  if (!h) throw new Error('Not at a heading');
  return { a, h };
};

/** The lines of the heading's own drawer: where :PROPERTIES: and :END: are (null without a drawer), and where one would go. */
export function drawerOf(lines, h) {
  let at = h.line + 1;
  while (at < h.end && PLANNING.test(lines[at].text)) at++;
  if (at < h.end && /^[ \t]*:PROPERTIES:[ \t]*$/i.test(lines[at].text)) {
    let end = at + 1;
    while (end < h.end && !/^[ \t]*:END:[ \t]*$/i.test(lines[end].text)) end++;
    if (end < h.end) return { begin: at, end, at };
  }
  return { begin: null, end: null, at };
}

/** A property line as Emacs writes it: the name, with its colons, padded to ten columns, then a space and the value. */
const format = (name, value) => `${`:${name}:`.padEnd(10)} ${value}`.trimEnd();

/** The properties in the heading's drawer, as [name, value] pairs. */
export function propertiesOf(text, line, lines = splitLines(text)) {
  const { h } = headOf(text, line);
  const d = drawerOf(lines, h);
  if (d.begin === null) return [];
  const out = [];
  for (let i = d.begin + 1; i < d.end; i++) { const m = PROPERTY.exec(lines[i].text); if (m) out.push([m[1], m[2] ?? '']); }
  return out;
}

/** Every property name used in the text, for completion. */
export function propertyNames(text) {
  const names = new Set();
  for (const h of analyze(text).heads) for (const [n] of propertiesOf(text, h.line)) names.add(n);
  return [...names];
}

/** Sets a property: it replaces the value of the one with that name, or is added at the end of the drawer, which is created if need be. */
export function setProperty(text, line, name, value) {
  const { h } = headOf(text, line);
  if (!/^[^\s:]+$/.test(name)) throw new Error('Enter a property name');
  const lines = splitLines(text);
  const d = drawerOf(lines, h);
  if (d.begin !== null) {
    for (let i = d.begin + 1; i < d.end; i++) {
      const m = PROPERTY.exec(lines[i].text);
      if (m && m[1].toLowerCase() === name.toLowerCase()) {
        lines[i] = { ...lines[i], text: format(m[1], value) };
        return { text: join(lines), line, remap: (n) => n, drawer: null };
      }
    }
    lines.splice(d.end, 0, { text: format(name, value), eol: '\n' });
    return { text: join(lines), line, remap: (n) => (n >= d.end ? n + 1 : n), drawer: null };
  }
  const last = d.at - 1;
  const endEol = lines[last].eol;
  if (endEol === '') lines[last] = { ...lines[last], eol: '\n' };
  const tail = d.at < lines.length ? '\n' : endEol;
  lines.splice(d.at, 0, { text: ':PROPERTIES:', eol: '\n' }, { text: format(name, value), eol: '\n' }, { text: ':END:', eol: tail });
  return { text: join(lines), line, remap: (n) => (n >= d.at ? n + 3 : n), drawer: d.at };
}

/** Deletes a property; the drawer goes with its last one. */
export function deleteProperty(text, line, name) {
  const { h } = headOf(text, line);
  const lines = splitLines(text);
  const d = drawerOf(lines, h);
  let at = -1;
  if (d.begin !== null) for (let i = d.begin + 1; i < d.end; i++) { const m = PROPERTY.exec(lines[i].text); if (m && m[1].toLowerCase() === name.toLowerCase()) at = i; }
  if (at < 0) throw new Error(`No such property: ${name}`);
  const only = d.end - d.begin === 2;
  const from = only ? d.begin : at;
  const count = only ? 3 : 1;
  const removedEnd = lines[from + count - 1];
  lines.splice(from, count);
  if (from === lines.length && from > 0 && removedEnd.eol === '') lines[from - 1] = { ...lines[from - 1], eol: '' };
  return { text: join(lines), line, remap: (n) => (n >= from + count ? n - count : n >= from ? null : n), drawer: null };
}
