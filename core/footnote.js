// Org footnotes: a reference `[fn:1]`, `[fn:name]`, `[fn:1:inline text]` or `[fn::anonymous text]` in the text and a definition `[fn:1] text`
// at the start of a line, usually under a "Footnotes" heading at the end. Written from the Org manual and observed Emacs 30.1 results
// (conformance v0.1.70-72, fa-*, fb-*, fm-*); no Emacs or Org source was read.
// Every function takes the buffer text and returns { text, line, col, message? } (0-based line), or { error }.

import { scanLine } from './links.js';

const DEF = /^\[fn:([-\w]+)\]/;
export const EDIT_HINT = 'Edit definition and go back with ‘C-c &’ or, if unique, with ‘C-c C-c’.';
export const MARK_SAVED = 'Position saved to mark ring, go back with ‘C-c &’.';

const isHead = (l) => /^\*+ /.test(l);
const isBlank = (l) => /^\s*$/.test(l);

/** Where each definition starts and ends (lines, end exclusive): a definition runs to the next definition or heading, or to two blank lines. */
export function definitions(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = DEF.exec(lines[i]);
    if (!m || inBlock(lines, i)) continue;
    let end = i + 1;
    let blanks = 0;
    while (end < lines.length) {
      const l = lines[end];
      if (isHead(l) || DEF.test(l)) break;
      if (isBlank(l)) { if (++blanks >= 2) { end++; break; } } else blanks = 0;
      end++;
    }
    let last = end;
    while (last > i + 1 && isBlank(lines[last - 1])) last--;
    out.push({ label: m[1], start: i, end, textEnd: last });
    i = end - 1;
  }
  return out;
}

function inBlock(lines, at) {
  let open = false;
  for (let i = 0; i < at; i++) {
    if (/^\s*#\+begin_/i.test(lines[i])) open = true;
    else if (/^\s*#\+end_/i.test(lines[i])) open = false;
  }
  return open;
}

/** Every reference in the text: { line, start, end, label, inline, def }. Footnote-looking text inside a definition's label is not one. */
export function references(lines) {
  const out = [];
  for (let l = 0; l < lines.length; l++) {
    if (inBlock(lines, l)) continue;
    for (const o of scanLine(lines[l])) if (o.kind === 'footnote') { if (l >= 0 && DEF.test(lines[l]) && o.start === 0) continue; out.push({ line: l, ...o }); }
  }
  return out;
}

const numberFor = (labels) => { let n = 1; while (labels.has(String(n))) n++; return String(n); };

/** Whether a new footnote can start at this line: not in a source or example block, a comment, a keyword, a drawer or a property line. */
export function allowedAt(lines, line) {
  const l = lines[line] ?? '';
  if (inBlock(lines, line) || /^\s*#(?:\s|$)/.test(l) || /^\s*#\+/.test(l) || /^\s*:[\w-]+:\s*$/.test(l) || /^\s*:[\w-]+:\s/.test(l)) return false;
  for (let i = line; i >= 0; i--) { if (/^\s*:(?:PROPERTIES|LOGBOOK|[A-Z_]+):\s*$/i.test(lines[i]) && !/^\s*:END:\s*$/i.test(lines[i])) return !(i < line && !lines.slice(i, line).some((x) => /^\s*:END:\s*$/i.test(x))); if (isHead(lines[i])) break; }
  return true;
}

/** The label a new footnote gets automatically: the first number not in use. */
export const nextLabel = (text) => {
  const lines = text.split('\n');
  return numberFor(new Set([...definitions(lines).map((d) => d.label), ...references(lines).filter((r) => r.label).map((r) => r.label)]));
};

/**
 * C-c C-x f away from any footnote: puts a reference at (line, col) and a definition for it.
 * `label` is '' for an anonymous footnote, null for the next free number, or a name. Options: section (the heading's title or null),
 * defineInline.
 */
export function create(text, line, col, { label = null, section = 'Footnotes', inline = false } = {}) {
  const lines = text.split('\n');
  const used = new Set([...definitions(lines).map((d) => d.label), ...references(lines).filter((r) => r.label).map((r) => r.label)]);
  const name = label === null ? numberFor(used) : label;
  if (name === '') {
    lines[line] = `${lines[line].slice(0, col)}[fn::]${lines[line].slice(col)}`;
    return { text: lines.join('\n'), line, col: col + 5 };
  }
  if (inline) {
    lines[line] = `${lines[line].slice(0, col)}[fn:${name}:]${lines[line].slice(col)}`;
    return { text: lines.join('\n'), line, col: col + name.length + 5 };
  }
  const exists = used.has(name);
  lines[line] = `${lines[line].slice(0, col)}[fn:${name}]${lines[line].slice(col)}`;
  if (exists && definitions(lines).some((d) => d.label === name)) return { text: lines.join('\n'), line, col: col + name.length + 5, message: 'New reference to existing note' };
  const def = `[fn:${name}] `;
  const sec = section ? lines.findIndex((l) => l === `* ${section}`) : -1;
  let at;
  if (section === null) {
    let end = line + 1;
    while (end < lines.length && !isBlank(lines[end]) && !isHead(lines[end])) end++;
    lines.splice(end, 0, '', def);
    at = end + 1;
  } else if (sec >= 0) {
    lines.splice(sec + 1, 0, '', def);
    at = sec + 2;
  } else {
    while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
    lines.push('', `* ${section}`, '', def, '');
    at = lines.length - 2;
  }
  return { text: lines.join('\n'), line: at, col: name.length + 5, message: EDIT_HINT, marked: true };
}

/** C-c C-x f on a reference or definition: where it leads, or null when nothing is there. */
export function jump(text, line, col) {
  const lines = text.split('\n');
  const dm = DEF.exec(lines[line] ?? '');
  if (dm && col <= dm[0].length && !inBlock(lines, line)) {
    const refs = references(lines).filter((r) => r.label === dm[1]);
    if (refs.length === 0) return { line, col };
    const before = refs.filter((r) => r.line < line || (r.line === line && r.start < col));
    const r = (before.length ? before : refs)[before.length ? before.length - 1 : 0];
    return { line: r.line, col: r.start, message: MARK_SAVED, marked: true };
  }
  const here = scanLine(lines[line] ?? '').find((o) => o.kind === 'footnote' && col >= o.start && col < o.end);
  if (!here) return undefined;
  if (here.label === null) return { line, col: here.start + 5 };
  if (here.inline) return { line, col: here.start + here.label.length + 5, message: EDIT_HINT, marked: true };
  const d = definitions(lines).find((x) => x.label === here.label);
  if (!d) return { line, col };
  return { line: d.start, col: here.label.length + 5, message: EDIT_HINT, marked: true };
}

const defText = (lines, d) => lines.slice(d.start, d.textEnd);

/** The labels in the order their first reference appears. */
const order = (lines) => { const seen = []; for (const r of references(lines)) if (r.label && !seen.includes(r.label)) seen.push(r.label); return seen; };

/** Gathers every definition under the section, in the order of the references (C-u s). */
export function sort(text, { section = 'Footnotes' } = {}) {
  const lines = text.split('\n');
  const defs = definitions(lines);
  const labels = order(lines);
  const ordered = [...labels.map((l) => defs.find((d) => d.label === l)).filter(Boolean), ...defs.filter((d) => !labels.includes(d.label))];
  const blocks = ordered.map((d) => defText(lines, d));
  const rest = [];
  const keep = new Array(lines.length).fill(true);
  for (const d of defs) for (let i = d.start; i < d.end; i++) keep[i] = false;
  for (let i = 0; i < lines.length; i++) if (keep[i]) rest.push(lines[i]);
  const out = placeSection(rest, blocks, section);
  return { text: out.join('\n') };
}

function placeSection(lines, blocks, section) {
  const L = [...lines];
  const out = placeInto(L, blocks, section);
  if (out[out.length - 1] !== '') out.push('');
  return out;
}

function placeInto(L, blocks, section) {
  const sec = section ? L.findIndex((l) => l === `* ${section}`) : -1;
  const body = blocks.flatMap((b) => ['', ...b]);
  if (blocks.length === 0) return L;
  if (sec >= 0) {
    let end = sec + 1;
    while (end < L.length && !isHead(L[end])) end++;
    let tail = end;
    while (tail > sec + 1 && isBlank(L[tail - 1])) tail--;
    L.splice(sec + 1, tail - (sec + 1), ...body);
    if (L[L.length - 1] !== '' && end >= L.length) L.push('');
    return L;
  }
  while (L.length > 1 && L[L.length - 1] === '') L.pop();
  L.push('', `* ${section ?? 'Footnotes'}`, ...body, '');
  return L;
}

/** Renumbers the labels 1, 2, 3 in the order of their references, in references and definitions (C-u r). */
export function renumber(text) {
  const lines = text.split('\n');
  const labels = order(lines);
  const map = new Map(labels.map((l, i) => [l, String(i + 1)]));
  const defs = definitions(lines);
  for (const d of defs) if (!map.has(d.label)) map.set(d.label, String(map.size + 1));
  const out = lines.map((l) => l);
  for (let i = 0; i < out.length; i++) {
    let s = out[i];
    const defStart = DEF.exec(s) && !inBlock(lines, i);
    const objs = scanLine(s).filter((o) => o.kind === 'footnote' && o.label !== null).sort((a, b) => b.start - a.start);
    for (const o of objs) if (map.has(o.label)) s = `${s.slice(0, o.start + 4)}${map.get(o.label)}${s.slice(o.start + 4 + o.label.length)}`;
    if (defStart && !objs.some((o) => o.start === 0)) { const m = DEF.exec(s); if (m && map.has(m[1])) s = `[fn:${map.get(m[1])}]${s.slice(m[0].length)}`; }
    out[i] = s;
  }
  return { text: out.join('\n') };
}

/** Makes every footnote numbered and standard: anonymous and inline ones get definitions, all collected under the section (C-u n). */
export function normalize(text, { section = 'Footnotes' } = {}) {
  let lines = text.split('\n');
  const defs = definitions(lines);
  const map = new Map();
  const bodies = new Map(defs.map((d) => [d.label, defText(lines, d)]));
  const extra = [];
  let n = 0;
  const label = (k) => { if (!map.has(k)) map.set(k, String(++n)); return map.get(k); };
  const out = [];
  const skip = new Set();
  for (const d of defs) for (let i = d.start; i < d.end; i++) skip.add(i);
  for (let i = 0; i < lines.length; i++) {
    if (skip.has(i)) continue;
    let s = lines[i];
    const objs = scanLine(s).filter((o) => o.kind === 'footnote' && !(o.start > 0 && false)).sort((a, b) => b.start - a.start);
    const top = objs.filter((o) => !objs.some((p) => p !== o && p.start < o.start && o.end <= p.end));
    const nums = new Map();
    for (const o of [...top].sort((a, b) => a.start - b.start)) {
      let key; let content;
      if (o.label === null) { key = `anon${extra.length}`; content = o.def ?? ''; } else if (o.inline) { key = o.label; content = o.def ?? ''; } else key = o.label;
      const num = label(key);
      if (o.label === null || o.inline) extra.push({ num, content });
      nums.set(o, num);
    }
    for (const o of top) s = `${s.slice(0, o.start)}[fn:${nums.get(o)}]${s.slice(o.end)}`;
    out.push(s);
  }
  const blocks = [];
  for (const [k, num] of [...map.entries()].sort((a, b) => Number(a[1]) - Number(b[1]))) {
    const e = extra.find((x) => x.num === num);
    if (e) blocks.push([`[fn:${num}] ${e.content}`]);
    else if (bodies.has(k)) { const b = bodies.get(k); blocks.push([`[fn:${num}]${b[0].slice(k.length + 5)}`, ...b.slice(1)]); }
  }
  lines = placeSection(out, blocks, section);
  return { text: lines.join('\n') };
}

/** C-u d: removes the footnote at the cursor with all its references and its definition. */
export function remove(text, line, col, { adjust = false, section = 'Footnotes' } = {}) {
  const lines = text.split('\n');
  const at = jumpLabel(lines, line, col);
  if (!at) return { error: 'Not at a footnote' };
  if (at.anonymous) {
    const l = lines[line];
    lines[line] = `${l.slice(0, at.start)}${l.slice(at.end)}`;
    return { text: lines.join('\n'), line, col: at.start, message: 'Anonymous footnote removed' };
  }
  const refs = references(lines).filter((r) => r.label === at.label);
  const defs = definitions(lines).filter((d) => d.label === at.label);
  let cursor = null;
  for (const r of [...refs].sort((a, b) => b.line - a.line || b.start - a.start)) {
    const l = lines[r.line];
    lines[r.line] = `${l.slice(0, r.start)}${l.slice(r.end)}`;
  }
  const first = [...refs].sort((a, b) => a.line - b.line || a.start - b.start)[0];
  for (const d of [...defs].sort((a, b) => b.start - a.start)) lines.splice(d.start, d.end - d.start);
  if (lines[lines.length - 1] !== '') lines.push('');
  const onDef = DEF.test(text.split('\n')[line] ?? '') && text.split('\n')[line].startsWith(`[fn:${at.label}]`);
  cursor = onDef ? { line: Math.min(line, lines.length - 1), col: 0 } : { line: first.line, col: first.start };
  let out = lines.join('\n');
  if (adjust) out = sort(renumber(out).text, { section }).text;
  return { text: out, ...cursor, message: `${defs.length} definition(s) of and ${refs.length} reference(s) of footnote ${at.label} removed` };
}

function jumpLabel(lines, line, col) {
  const dm = DEF.exec(lines[line] ?? '');
  if (dm && col <= dm[0].length) return { label: dm[1] };
  const here = scanLine(lines[line] ?? '').find((o) => o.kind === 'footnote' && col >= o.start && col < o.end);
  if (!here) return null;
  return here.label === null ? { anonymous: true, start: here.start, end: here.end } : { label: here.label };
}

export const MENU = 'Footnotes: [s]ort | [r]enumber fn:N | [S]=r+s | [n]ormalize | [d]elete';

/**
 * C-c C-x f. `prefix` is null or any prefix argument. Returns { need: 'choice' } or { need: 'label' } when an answer is missing, or the
 * result of the command. `opts`: autoLabel ('t' | 'confirm' | 'nil'), section, defineInline, autoAdjust.
 */
export function action(text, line, col, { prefix = null, choice, label, opts = {} } = {}) {
  const lines = text.split('\n');
  const { autoLabel = 't', section = 'Footnotes', defineInline = false, autoAdjust = false } = opts;
  if (prefix === null || prefix === undefined) {
    const j = jump(text, line, col);
    if (j !== undefined) return { ...j, text };
    if (allowedAt(lines, line)) {
      if (autoLabel === 't') return create(text, line, col, { section, inline: defineInline });
      if (label === undefined) return { need: 'label' };
      return create(text, line, col, { label, section, inline: defineInline });
    }
  }
  if (choice === undefined) return { need: 'choice', menu: MENU };
  switch (choice) {
    case 's': return { ...sort(text, { section }), line, col };
    case 'r': return { ...renumber(text), line, col };
    case 'S': return { ...sort(renumber(text).text, { section }), line, col };
    case 'n': return { ...normalize(text, { section }), line, col };
    case 'd': return remove(text, line, col, { adjust: autoAdjust, section });
    default: return { error: `No such footnote command ${choice}` };
  }
}
