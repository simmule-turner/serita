// Org links: finding them in a line, what each one points to, how a link is written, how a click or C-c C-o resolves it inside a buffer,
// and the link a command stores. Written from the Org manual and observed Emacs 30.1 results (conformance v0.1.70-72, ob-*, lo-*, lp-*,
// o2-*, en-*, sl-*, ij-*, ls-*); no Emacs or Org source was read.

import { analyze } from './outline.js';
import { propertiesOf, setProperty } from './properties.js';

/** The link types Emacs 30.1 knows with no extra packages (org-link-types). */
export const LINK_TYPES = ['id', 'eww', 'rmail', 'mhe', 'irc', 'info', 'gnus', 'docview', 'bibtex', 'bbdb', 'w3m', 'doi', 'file+sys', 'file+emacs', 'shell', 'news', 'mailto', 'https', 'http', 'ftp', 'help', 'file', 'elisp'];

export const unescapeLink = (s) => s.replace(/\\(\\*)([[\]])/g, '$1$2');
const unescape = unescapeLink;
const ZWSP = '​';

/** `[[path][description]]` as Emacs writes it: brackets in the path are escaped, a description ending in ] gets a zero-width space. */
export function makeString(link, desc) {
  const path = link.replace(/(\\*)([[\]])/g, '$1$1\\$2').replace(/(\\+)$/, '$1$1');
  const d = desc == null ? '' : desc.replace(/^\s+|\s+$/g, '');
  if (link === '') return d;
  if (d === '') return `[[${path}]]`;
  return `[[${path}][${d.replace(/\]+$/, (r) => r.replace(/\]/g, `]${ZWSP}`))}]]`;
}

/** What a string with links shows: a link with a description shows the description, one without shows its path. */
export function displayFormat(s) {
  return s.replace(/\[\[((?:[^[\]\\]|\\.)+)\](?:\[((?:.|\n)+?)\])?\]/g, (_, path, desc) => (desc !== undefined ? desc : unescape(path)));
}

/** The text a link type and path expand to when the link starts with an abbreviation from org-link-abbrev-alist. */
export function expandAbbrev(link, alist = []) {
  const m = /^([^:]+):(.*)$/s.exec(link);
  if (!m) return link;
  const hit = alist.find(([k]) => k === m[1]);
  if (!hit) return link;
  const tail = m[2];
  const v = hit[1];
  if (typeof v !== 'string') return link;
  if (!/%[sh]|%\(/.test(v)) return v + tail;
  return v.replace(/%(s|h)/g, (_, k) => (k === 'h' ? encodeURIComponent(tail).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`) : tail));
}

/** What a bracket path points to: { type, path, search }. */
export function classify(raw) {
  const p = unescape(raw);
  if (p.startsWith('*')) return { type: 'fuzzy', path: p };
  if (p.startsWith('#')) return { type: 'custom-id', path: p.slice(1) };
  const t = /^([A-Za-z0-9+.-]+):(.*)$/s.exec(p);
  if (t && LINK_TYPES.includes(t[1])) {
    if (t[1].startsWith('file')) return fileParts(t[1], t[2]);
    return { type: t[1], path: t[2] };
  }
  if (/^(?:\.{1,2}\/|\/|~\/)/.test(p)) return fileParts('file', p);
  return { type: 'fuzzy', path: p };
}

function fileParts(type, rest) {
  const i = rest.indexOf('::');
  return i < 0 ? { type, path: rest } : { type, path: rest.slice(0, i), search: rest.slice(i + 2) };
}

const PLAIN_TYPES = LINK_TYPES.filter((t) => t !== 'file+sys' && t !== 'file+emacs').map((t) => t.replace(/[+.]/g, '\\$&')).join('|');
const PLAIN = new RegExp(`^(${PLAIN_TYPES}):((?:[^\\s<>()\\[\\]]|\\([^\\s<>()]*\\))+)`);

/** Every link, target and footnote reference in a line: { start, end, kind, ... }; `end` is just after the last character. */
export function scanLine(line) {
  const out = [];
  let i = 0;
  while (i < line.length) {
    const rest = line.slice(i);
    let m;
    if (rest.startsWith('[[') && (m = /^\[\[((?:[^[\]\\]|\\(?:\\\\)*[[\]]|\\+[^[\]])+)\](?:\[((?:.|\n)+?)\])?\]/.exec(rest))) {
      out.push({ start: i, end: i + m[0].length, kind: 'bracket', ...classify(m[1]), raw: m[1], format: 'bracket', desc: m[2] });
      i += m[0].length; continue;
    }
    if (rest.startsWith('<<<') && (m = /^<<<([^<>\n\s](?:[^<>\n]*[^<>\n\s])?)>>>/.exec(rest))) { out.push({ start: i, end: i + m[0].length, kind: 'radio', name: m[1] }); i += m[0].length; continue; }
    if (rest.startsWith('<<') && (m = /^<<([^<>\n\s](?:[^<>\n]*[^<>\n\s])?)>>/.exec(rest))) { out.push({ start: i, end: i + m[0].length, kind: 'target', name: m[1] }); i += m[0].length; continue; }
    if (rest[0] === '<' && (m = new RegExp(`^<(${PLAIN_TYPES}):([^<>\\n]*)>`).exec(rest))) { out.push({ start: i, end: i + m[0].length, kind: 'angle', type: m[1], path: m[2], format: 'angle' }); i += m[0].length; continue; }
    if (rest.startsWith('[fn:') && (m = /^\[fn:([-\w]*)(?::((?:[^[\]]|\[[^[\]]*\]|\[\[[^\]]*\](?:\[[^\]]*\])?\])*))?\]/.exec(rest)) && (m[1] !== '' || m[2] !== undefined)) {
      out.push({ start: i, end: i + m[0].length, kind: 'footnote', label: m[1] || null, inline: m[2] !== undefined, def: m[2] });
      if (m[2]) { const off = i + m[0].length - 1 - m[2].length; for (const o of scanLine(m[2])) out.push({ ...o, start: o.start + off, end: o.end + off }); }
      i += m[0].length; continue;
    }
    if (/[a-z]/.test(rest[0]) && (i === 0 || !/[A-Za-z0-9]/.test(line[i - 1])) && (m = PLAIN.exec(rest))) {
      const path = m[2].replace(/[.,;:!?'"]+$/, '');
      const end = i + m[1].length + 1 + path.length;
      out.push({ start: i, end, kind: 'plain', type: m[1], path, format: 'plain' });
      i = end; continue;
    }
    i++;
  }
  return out;
}

/** The link, target or reference whose characters include `col`, or null. */
export const objectAt = (line, col) => scanLine(line).find((o) => col >= o.start && col < o.end) ?? null;

/** The heading entry text range [from, to) of the lines around `line`: from its heading to the next heading of any level. */
export function entryRange(lines, line) {
  let from = line;
  while (from >= 0 && !/^\*+ /.test(lines[from])) from--;
  let to = line + 1;
  while (to < lines.length && !/^\*+ /.test(lines[to])) to++;
  return [Math.max(from, 0), to];
}

/** The links (not targets) in the lines [from, to): { line, ...link }. */
export function linksIn(lines, from, to) {
  const out = [];
  for (let l = from; l < to; l++) for (const o of scanLine(lines[l] ?? '')) if (['bracket', 'angle', 'plain'].includes(o.kind)) out.push({ line: l, ...o });
  return out;
}

const norm = (s) => s.replace(/\s+/g, ' ').trim().toLowerCase();
const HEAD_COOKIE = /\s+\[[0-9%/]*\]$/;
const titleMatches = (h, s) => norm(h.title) === norm(s) || norm(h.title.replace(HEAD_COOKIE, '')) === norm(s);

/**
 * Where a search option leads inside a buffer. Returns { line, col } to go there, { sparse } for a regexp, { create } to offer a new heading,
 * or { error }.
 * `mustMatch` is org-link-search-must-match-exact-headline: 'query-to-create', true or false.
 */
export function search(text, option, { mustMatch = 'query-to-create' } = {}) {
  const lines = text.split('\n');
  if (option === undefined || option === '') return { line: null };
  if (/^\d+$/.test(option)) return { line: Math.min(Number(option) - 1, lines.length - 1), col: 0 };
  const rx = /^\/(.*)\/$/s.exec(option);
  if (rx) return { sparse: rx[1] };
  const heads = analyze(text).heads;
  if (option.startsWith('#')) {
    const id = option.slice(1);
    const h = heads.find((x) => propertiesOf(text, x.line).some(([k, v]) => k.toUpperCase() === 'CUSTOM_ID' && v === id));
    return h ? { line: h.line, col: 0 } : { error: `No match for custom ID: ${id}` };
  }
  if (option.startsWith('*')) {
    const s = option.slice(1);
    const h = heads.find((x) => titleMatches(x, s));
    if (h) return { line: h.line, col: 0 };
    return mustMatch === 'query-to-create' ? { create: s } : { error: `No match for fuzzy expression: ${option}` };
  }
  const s = option;
  const ns = norm(s);
  for (let l = 0; l < lines.length; l++) {
    for (const o of scanLine(lines[l])) if ((o.kind === 'target' || o.kind === 'radio') && norm(o.name) === ns && o.kind === 'target') return { line: l, col: o.start };
  }
  for (let l = 0; l < lines.length; l++) { const m = /^\s*#\+NAME:\s*(.*?)\s*$/i.exec(lines[l]); if (m && norm(m[1]) === ns) return { line: l, col: 0 }; }
  const h = heads.find((x) => titleMatches(x, s));
  if (h) return { line: h.line, col: 0 };
  if (mustMatch === false) {
    const words = s.trim().split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
    const m = new RegExp(words, 'i').exec(text);
    if (m) { const before = text.slice(0, m.index).split('\n'); return { line: before.length - 1, col: before[before.length - 1].length }; }
    return { error: `No match for fuzzy expression: ${s}` };
  }
  return mustMatch === 'query-to-create' ? { create: s } : { error: `No match for fuzzy expression: ${s}` };
}

/** The text with a new heading appended for a link that found nothing, and its line. */
export function createHeading(text, title) {
  const base = text.endsWith('\n') || text === '' ? text : `${text}\n`;
  const out = `${base}* ${title}\n`;
  return { text: out, line: base.split('\n').length - 1, col: title.length + 2 };
}

/** The line of the heading with `:ID:` equal to `id`, or null. */
export function findId(text, id) {
  const h = analyze(text).heads.find((x) => propertiesOf(text, x.line).some(([k, v]) => k.toUpperCase() === 'ID' && v === id));
  return h ? h.line : null;
}

/**
 * What a link at (line, col) leads to, as an action for the app:
 *  { open: link } for the link under the cursor (col inside it), { choose: [links] } or { open } for the entry's links when the cursor
 *  is elsewhere, { none: 'No links' } or { error }.
 */
export function atPoint(text, line, col) {
  const lines = text.split('\n');
  const here = scanLine(lines[line] ?? '');
  const hit = here.find((o) => col >= o.start && col < o.end);
  if (hit) return { object: { line, ...hit } };
  if (here.some((o) => o.end === col && ['bracket', 'angle', 'plain', 'footnote'].includes(o.kind))) return { error: 'No link found' };
  const [from, to] = entryRange(lines, line);
  const found = linksIn(lines, from, to);
  if (found.length === 0) return { none: 'No links' };
  return found.length === 1 ? { object: found[0] } : { choose: found };
}

/** The link C-c l stores for the place at `line`: { link, title }. */
/** `useId` is org-id-link-to-org-use-id: 'nil', 't', 'create-if-interactive' or 'use-existing'; `newId` makes the id a new entry gets. A result with `text` changed the buffer. */
export function store(text, line, file, { useId = 'nil', newId = () => crypto.randomUUID() } = {}) {
  const lines = text.split('\n');
  const heads = analyze(text).heads;
  let h = null;
  for (const x of heads) if (x.line <= line) h = x;
  if (!h) {
    const first = lines.find((l) => l.trim() !== '') ?? '';
    return { link: `file:${file}::${first.trim()}`, title: null, message: `file:${file}::${first.trim()}` };
  }
  const props = propertiesOf(text, h.line);
  if (useId !== 'nil') {
    let id = props.find(([k]) => k.toUpperCase() === 'ID')?.[1];
    let changed = null;
    if (!id && (useId === 't' || useId === 'create-if-interactive')) { id = newId(); changed = setProperty(text, h.line, 'ID', id).text; }
    if (id) return { link: `id:${id}`, title: displayFormat(h.title), ...(changed ? { text: changed } : {}) };
  }
  const cid = props.find(([k]) => k.toUpperCase() === 'CUSTOM_ID')?.[1];
  const raw = lines[h.line].replace(/^\*+\s+/, '');
  if (cid) return { link: `file:${file}::#${cid}`, title: h.title };
  const clean = displayFormat(h.title);
  return { link: `file:${file}::*${stripHeading(raw)}`, title: clean };
}

/** A heading's text as a *search option: without its keyword, priority and tags. */
function stripHeading(raw) {
  return raw.replace(/^(?:[A-Z]{2,}\s+)(?=.)/, (m) => (/^(TODO|DONE|NEXT|WAIT|CANCEL|CANCELED|CANCELLED)\s/.test(m) ? '' : m)).replace(/^\[#[A-Z]\]\s+/, '').replace(/\s+:[^\s:]+(?::[^\s:]+)*:\s*$/, '');
}

const offsetOf = (lines, line, col) => lines.slice(0, line).reduce((n, l) => n + l.length + 1, 0) + col;

/** File links are relative to the directory of the buffer's file when they lie under it, and lose a leading "./". */
export function normalizeFile(link, dir) {
  const m = /^file:(.*)$/s.exec(link);
  if (!m) return link;
  let path = m[1];
  if (path.startsWith('./')) path = path.slice(2);
  if (dir && path.startsWith(`${dir}/`)) path = path.slice(dir.length + 1);
  return `file:${path}`;
}

/**
 * C-c C-l: what the command asks about. `region` is { from, to } offsets or null; `dir` the buffer file's directory.
 * Returns { mode: 'edit', link, desc, from, to } on an existing link, else { mode: 'insert', from, to, desc } where desc is the region's text.
 */
export function insertPlan(text, line, col, region = null) {
  const lines = text.split('\n');
  const hit = scanLine(lines[line] ?? '').find((o) => ['bracket', 'angle', 'plain'].includes(o.kind) && col >= o.start && col < o.end);
  if (hit && !region) {
    const base = offsetOf(lines, line, 0);
    const raw = hit.raw ?? `${hit.type}:${hit.path}`;
    return { mode: 'edit', link: raw, desc: hit.desc ?? null, from: base + hit.start, to: base + hit.end };
  }
  const at = offsetOf(lines, line, col);
  if (region && region.from !== region.to) {
    const a = Math.min(region.from, region.to);
    const b = Math.max(region.from, region.to);
    return { mode: 'insert', from: a, to: b, desc: text.slice(a, b) };
  }
  return { mode: 'insert', from: at, to: at, desc: null };
}

/** The link typed for C-u C-c C-l (a file chosen): `absolute` for C-u C-u. */
export function fileAnswer(path, { absolute = false, dir = '' } = {}) {
  if (absolute) return `file:${path.startsWith('/') ? path : `${dir}/${path}`}`;
  return normalizeFile(`file:${path}`, dir);
}

/** Applies the answers. Returns { text, offset } (offset after the link), or { error, text? } (Emacs removes the link before it complains). */
export function applyInsert(text, plan, { link, desc = '', dir = '', keepAbsolute = false }) {
  const out = (t, end) => ({ text: t, offset: end });
  if (!link) {
    if (plan.mode === 'edit') return { text: text.slice(0, plan.from) + text.slice(plan.to), error: 'Empty link' };
    return { error: 'No link selected' };
  }
  const s = makeString(keepAbsolute ? link : normalizeFile(link, dir), desc.trim() === '' ? null : desc);
  return out(text.slice(0, plan.from) + s + text.slice(plan.to), plan.from + s.length);
}
