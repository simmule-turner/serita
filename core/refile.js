// Refile and archive: where a subtree can go, moving it there, and archiving it (checked against Emacs 30.1 results).
// Written from the Org manual's description and observed Emacs results; no Emacs or Org source was read.

import { splitLines } from './parse.js';
import { analyze } from './outline.js';
import { readForms, isSym } from './lisp-read.js';
import { emacsRegexp } from './regexp.js';
import { propertiesOf, setProperty } from './properties.js';
import { DEFAULT_TAGS_COLUMN, setTags } from './outline-edit.js';
import { formatStamp } from './timestamp.js';

const join = (lines) => lines.map((l) => l.text + l.eol).join('');
const name = (x) => (isSym(x) ? x.sym : null);
const unquote = (x) => (x && x.quote !== undefined ? x.quote : x);

// ---- Settings ---------------------------------------------------------------------------------------------------------------

/** The plist of a target spec, which Emacs writes as a dotted list: (nil :maxlevel . 2). */
function plist(list) {
  const out = {};
  const items = [...list];
  if (list.tail !== undefined) { if (Array.isArray(list.tail)) { const t = plist(list.tail); Object.assign(out, t); } else items.push(list.tail); }
  for (let i = 0; i < items.length; i += 2) out[name(items[i])] = items[i + 1];
  return out;
}

/**
 * The refile settings in the text of an init file: setq of org-refile-targets, org-refile-use-outline-path and org-reverse-note-order.
 * A target is { files: null (the current file) | 'agenda' | string[], maxlevel, level, tag, todo, regexp }.
 */
export function parseRefileSettings(text) {
  const out = { targets: [{ files: null, level: 1 }], outline: false, reverse: false };
  for (const form of readForms(text)) {
    if (name(form[0]) !== 'setq') throw new Error('Expected setq');
    for (let i = 1; i < form.length; i += 2) {
      const v = name(form[i]); const val = unquote(form[i + 1]);
      if (v === 'org-refile-targets') {
        out.targets = (val ?? []).map((t) => {
          const head = Array.isArray(t) ? t[0] : t;
          const rest = Array.isArray(t) ? Object.assign([...t.slice(1)], { tail: t.tail }) : [];
          const files = head === null ? null : typeof head === 'string' ? [head] : Array.isArray(head) ? head : name(head) === 'org-agenda-files' ? 'agenda' : (() => { throw new Error(`Unsupported file list ${name(head)}`); })();
          const p = plist(rest);
          return { files, maxlevel: p[':maxlevel'], level: p[':level'], tag: p[':tag'], todo: p[':todo'], regexp: p[':regexp'] };
        });
      } else if (v === 'org-refile-use-outline-path') out.outline = val === null ? false : val === true ? true : name(val) === 'file' ? 'file' : (() => { throw new Error('org-refile-use-outline-path is nil, t or file'); })();
      else if (v === 'org-reverse-note-order') out.reverse = val === true;
      else throw new Error(`${v ?? 'That'} is not a refile setting`);
    }
  }
  return out;
}

/**
 * The places a subtree can be refiled to, in Emacs's order.
 * @param {{ name: string, text: string }[]} files every file that may be a target (the current one first)
 * @returns {{ label: string, file: string, line: number, level: number }[]} line is -1 for the top of a file
 */
export function listTargets(files, settings, { current, agenda = [] }) {
  const out = [];
  for (const t of settings.targets) {
    const names = t.files === null ? [current] : t.files === 'agenda' ? agenda : t.files;
    for (const fname of names) {
      const f = files.find((x) => x.name === fname);
      if (!f) continue;
      if (settings.outline === 'file') out.push({ label: f.name, file: f.name, line: -1, level: 0 });
      const a = analyze(f.text);
      const lines = splitLines(f.text);
      const re = t.regexp ? emacsRegexp(t.regexp, false) : null;
      const inherited = (h) => { const tags = []; for (let x = h; x; x = x.parent) tags.push(...x.tags); return tags; };
      for (const h of a.heads) {
        if (t.maxlevel !== undefined && h.level > t.maxlevel) continue;
        if (t.level !== undefined && h.level !== t.level) continue;
        if (t.tag !== undefined && !inherited(h).includes(t.tag)) continue;
        if (t.todo !== undefined && h.todo !== t.todo) continue;
        if (re && !(re.lastIndex = 0, re.test(lines[h.line].text))) continue;
        const path = []; for (let x = h; x; x = x.parent) path.unshift(x.title);
        const label = settings.outline ? path.join('/') : h.title;
        out.push({ label: settings.outline === 'file' ? `${f.name}/${label}` : label, file: f.name, line: h.line, level: h.level });
      }
    }
  }
  return out;
}

// ---- Moving subtrees --------------------------------------------------------------------------------------------------------

/** The subtree at `line`: its lines with the headings' levels set so the first is at `level`, and the text without it. */
function cut(text, line, level, column = DEFAULT_TAGS_COLUMN) {
  const a = analyze(text);
  const h = a.heads.find((x) => x.line === line);
  if (!h) throw new Error('Not at a heading');
  const lines = splitLines(text);
  const sub = lines.slice(h.line, h.end).map((l) => ({ ...l }));
  if (sub.length && sub[sub.length - 1].eol === '') sub[sub.length - 1].eol = '\n';
  const delta = level - h.level;
  for (const l of sub) if (/^\*+(?: |$)/.test(l.text)) { const stars = /^\*+/.exec(l.text)[0].length; l.text = '*'.repeat(Math.max(1, stars + delta)) + l.text.slice(stars); }
  let moved = join(sub);
  if (delta !== 0) for (const x of analyze(moved).heads) if (x.tags.length) moved = setTags(moved, x.line, x.tags, column).text;
  return { sub: splitLines(moved), rest: join([...lines.slice(0, h.line), ...lines.slice(h.end)]), head: h, a };
}

function insert(text, target, sub, reverse) {
  const lines = splitLines(text);
  const a = analyze(text);
  let at;
  if (target.line < 0) at = reverse ? (a.heads[0]?.line ?? lines.length) : lines.length;
  else {
    const h = a.heads.find((x) => x.line === target.line);
    if (!h) throw new Error('The target heading is gone');
    at = reverse ? h.bodyEnd : h.end;
  }
  if (at > 0 && at <= lines.length && lines[at - 1].eol === '') lines[at - 1] = { ...lines[at - 1], eol: '\n' };
  lines.splice(at, 0, ...sub);
  return join(lines);
}

/**
 * Moves (or copies) the subtree at `line` of `text` under `target`. For another file give its text as `otherText`.
 * @returns {{ text: string, otherText: string|null }} the new texts
 */
export function refile(text, line, target, { otherText = null, reverse = false, copy = false, column = DEFAULT_TAGS_COLUMN } = {}) {
  const { head, a } = (() => { const aa = analyze(text); return { a: aa, head: aa.heads.find((x) => x.line === line) }; })();
  if (!head) throw new Error('Not at a heading');
  const level = target.line < 0 ? 1 : (otherText === null ? a : analyze(otherText)).heads.find((x) => x.line === target.line)?.level + 1;
  if (otherText === null && target.line >= head.line && target.line < head.end) throw new Error('Cannot refile to position inside the tree or region');
  const { sub, rest } = cut(text, line, level, column);
  if (otherText !== null) return { text: copy ? text : rest, otherText: insert(otherText, target, sub, reverse) };
  if (copy) return { text: insert(text, target, sub, reverse), otherText: null };
  const gone = head.end - head.line;
  return { text: insert(rest, target.line > head.line ? { ...target, line: target.line - gone } : target, sub, reverse), otherText: null };
}

/** What Emacs says when a refile is done. */
export const refileMessage = (target, file, copy) => `Refile${copy ? ' (and keep)' : ''} to "${target.label}" in file ${file}: done`;

// ---- Archive ----------------------------------------------------------------------------------------------------------------

const ARCHIVE_HEADER = (file) => `#    -*- mode: org -*-\n\n\nArchived entries from file ${file}\n\n\n`;

/** The archive location split as org-archive-location is: { file, heading }. "%s" is the file's name; no file means the same file. */
export function parseArchiveLocation(loc, fileName) {
  const i = loc.indexOf('::');
  if (i < 0) throw new Error('The archive location needs ::');
  const file = loc.slice(0, i).replace('%s', fileName);
  const heading = loc.slice(i + 2).trim();
  return { file: file === '' ? null : file, heading: heading === '' ? null : heading };
}

const ensureBlankBefore = (lines, at) => { if (at > 0 && lines[at - 1].text.trim() !== '') { if (lines[at - 1].eol === '') lines[at - 1] = { ...lines[at - 1], eol: '\n' }; lines.splice(at, 0, { text: '', eol: '\n' }); return at + 1; } return at; };

/**
 * Archives the subtree at `line`: the entry goes to the archive location with where it came from recorded in properties.
 * @param {{ fileName: string, category: string, location: string, now: Date, archiveText: string|null }} o archiveText is the text of the archive file, null when it does not exist yet
 * @returns {{ text: string, archive: { file: string, text: string }|null, message: string }}
 */
export function archiveSubtree(text, line, { fileName, category, location, now, archiveText, column = DEFAULT_TAGS_COLUMN }) {
  const loc = parseArchiveLocation(location, fileName);
  const a = analyze(text);
  const head = a.heads.find((x) => x.line === line);
  if (!head) throw new Error('Not at a heading');
  const path = []; for (let x = head.parent; x; x = x.parent) path.unshift(x.title);
  const sameFile = loc.file === null;
  const dest = sameFile ? text : archiveText ?? ARCHIVE_HEADER(fileName);
  const da = analyze(dest);
  const dlines = splitLines(dest);
  // where the entry goes, and its level
  let level = 1;
  let at = dlines.length;
  if (loc.heading) {
    const hm = /^(\*+)\s+(.*)$/.exec(loc.heading);
    const title = hm ? hm[2] : loc.heading;
    let h = da.heads.find((x) => x.title === title);
    if (!h) {
      at = ensureBlankBefore(dlines, dlines.length);
      if (dlines.length && dlines[dlines.length - 1].eol === '' && at === dlines.length) dlines[dlines.length - 1] = { ...dlines[dlines.length - 1], eol: '\n' };
      dlines.splice(at, 0, { text: `${hm ? hm[1] : '*'} ${title}`, eol: '\n' });
      level = (hm ? hm[1].length : 1) + 1;
      at = dlines.length;
    } else { level = h.level + 1; at = h.end; }
  }
  const sameHeadEnd = sameFile ? head : null;
  const { sub, rest } = cut(text, line, level, column);
  const entry = join(sub);
  let own = category;
  for (let x = head; x; x = x.parent) { const p = propertiesOf(text, x.line).find(([n]) => n.toUpperCase() === 'CATEGORY'); if (p) { own = p[1]; break; } }
  const itags = []; for (let x = head.parent; x; x = x.parent) itags.unshift(...x.tags);
  const withProps = (() => {
    let t = entry;
    const stamp = formatStamp(now, { time: true, active: false }).slice(1, -1);
    t = setProperty(t, 0, 'ARCHIVE_TIME', stamp).text;
    t = setProperty(t, 0, 'ARCHIVE_FILE', fileName).text;
    if (path.length) t = setProperty(t, 0, 'ARCHIVE_OLPATH', path.join('/')).text;
    t = setProperty(t, 0, 'ARCHIVE_CATEGORY', own).text;
    if (head.todo) t = setProperty(t, 0, 'ARCHIVE_TODO', head.todo).text;
    if (itags.length) t = setProperty(t, 0, 'ARCHIVE_ITAGS', itags.join(' ')).text;
    return t;
  })();
  if (sameFile) {
    // the entry is cut from the file first, so the places in it have moved up
    const base = splitLines(rest);
    const ra = analyze(rest);
    let pos = base.length; let lv = level;
    if (loc.heading) {
      const hm = /^(\*+)\s+(.*)$/.exec(loc.heading); const title = hm ? hm[2] : loc.heading;
      const h = ra.heads.find((x) => x.title === title);
      if (!h) { pos = ensureBlankBefore(base, base.length); if (pos === base.length && base.length && base[base.length - 1].eol === '') base[base.length - 1] = { ...base[base.length - 1], eol: '\n' }; base.splice(pos, 0, { text: `${hm ? hm[1] : '*'} ${title}`, eol: '\n' }); pos = base.length; lv = (hm ? hm[1].length : 1) + 1; }
      else { pos = h.end; lv = h.level + 1; }
    }
    const e2 = splitLines(withProps.replace(/^\*+/, '*'.repeat(lv)));
    pos = ensureBlankBefore(base, pos);
    base.splice(pos, 0, ...e2);
    return { text: join(base), archive: null, message: `Subtree archived under heading: ${loc.heading ?? ''}`.trim() };
  }
  const adj = splitLines(withProps);
  at = ensureBlankBefore(dlines, at);
  if (at > 0 && dlines[at - 1].eol === '') dlines[at - 1] = { ...dlines[at - 1], eol: '\n' };
  dlines.splice(at, 0, ...adj);
  void sameHeadEnd;
  return { text: rest, archive: { file: loc.file, text: join(dlines) }, message: `Subtree archived in file: ${loc.file}` };
}

/** C-c C-x a: adds or removes the ARCHIVE tag. Returns { text, message }. */
export function toggleArchiveTag(text, line, column) {
  const h = analyze(text).heads.find((x) => x.line === line);
  if (!h) throw new Error('Not at a heading');
  const has = h.tags.includes('ARCHIVE');
  return { text: setTags(text, line, has ? h.tags.filter((t) => t !== 'ARCHIVE') : [...h.tags, 'ARCHIVE'], column).text, message: has ? 'Subtree unarchived' : 'Subtree archived' };
}

/** C-c C-x A: moves the subtree under an "Archive" heading, tagged ARCHIVE, among its parent's children. */
export function archiveToSibling(text, line, { now, column = DEFAULT_TAGS_COLUMN }) {
  const a = analyze(text);
  const head = a.heads.find((x) => x.line === line);
  if (!head) throw new Error('Not at a heading');
  const parentLine = head.parent ? head.parent.line : -1;
  const { sub, rest } = cut(text, line, 1, column);
  let t = rest;
  let ra = analyze(t);
  const kids = parentLine < 0 ? ra.heads.filter((x) => x.level === 1) : ra.heads.find((x) => x.line === parentLine).children;
  let arch = kids.find((c) => c.title === 'Archive' && c.tags.includes('ARCHIVE'));
  if (!arch) {
    const lines = splitLines(t);
    const at = parentLine < 0 ? lines.length : ra.heads.find((x) => x.line === parentLine).end;
    const level = parentLine < 0 ? 1 : ra.heads.find((x) => x.line === parentLine).level + 1;
    if (at > 0 && lines[at - 1].eol === '') lines[at - 1] = { ...lines[at - 1], eol: '\n' };
    lines.splice(at, 0, { text: `${'*'.repeat(level)} Archive`, eol: '\n' });
    t = setTags(join(lines), at, ['ARCHIVE'], column).text;
    ra = analyze(t); arch = ra.heads.find((x) => x.line === at);
  }
  const lines = splitLines(t);
  const lv = arch.level + 1;
  let moved = sub.map((l) => l.text + l.eol).join('').replace(/^\*+/gm, (m) => '*'.repeat(m.length - 1 + lv));
  for (const x of analyze(moved).heads) if (x.tags.length) moved = setTags(moved, x.line, x.tags, column).text;
  const stamp = formatStamp(now, { time: true, active: false }).slice(1, -1);
  const withProp = splitLines(setProperty(moved, 0, 'ARCHIVE_TIME', stamp).text);
  const at = arch.end;
  if (at > 0 && lines[at - 1].eol === '') lines[at - 1] = { ...lines[at - 1], eol: '\n' };
  lines.splice(at, 0, ...withProp);
  return { text: join(lines) };
}
