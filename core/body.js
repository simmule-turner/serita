// A heading's body: the text under it, after its planning line and properties drawer, up to its first sub-heading.

import { splitLines } from './parse.js';
import { headOf, drawerOf } from './properties.js';

const join = (lines) => lines.map((l) => l.text + l.eol).join('');

/** Where the body is: line numbers `start` up to (not including) `end`. */
function span(text, line) {
  const { h } = headOf(text, line);
  const lines = splitLines(text);
  const d = drawerOf(lines, h);
  return { lines, h, start: d.begin === null ? d.at : d.end + 1, end: h.bodyEnd };
}

/** The body of the heading at `line`, without the final newline. */
export function bodyOf(text, line) {
  const { lines, start, end } = span(text, line);
  return lines.slice(start, Math.max(start, end)).map((l) => l.text + l.eol).join('').replace(/\n$/, '');
}

/** Replaces the body of the heading at `line`. An empty body removes it. Returns { text, line, remap }. */
export function setBody(text, line, body) {
  const { lines, start, end } = span(text, line);
  const stop = Math.max(start, end);
  const last = lines.length - 1;
  const keepNoEol = stop > last && lines[last].eol === '' && stop > start;
  const fresh = body === '' ? [] : splitLines(body.replace(/\n?$/, '\n')).map((l) => ({ ...l }));
  if (fresh.length && keepNoEol) fresh[fresh.length - 1].eol = '';
  if (start > 0 && start - 1 <= last && lines[start - 1].eol === '' && fresh.length) lines[start - 1] = { ...lines[start - 1], eol: '\n' };
  const delta = fresh.length - (stop - start);
  lines.splice(start, stop - start, ...fresh);
  return { text: join(lines), line, remap: (n) => (n >= stop ? n + delta : n) };
}
