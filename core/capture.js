// Capture: templates as init.el writes them, their escapes, and where the captured text goes (checked against Emacs 30.1 results).
// Written from the Org manual's description and observed Emacs results; no Emacs or Org source was read.

import { ensureDay } from './datetree.js';
import { splitLines } from './parse.js';
import { analyze } from './outline.js';
import { alignLines } from './table.js';
import { readForms, isSym } from './lisp-read.js';
import { formatStamp } from './timestamp.js';
import { makeLisp } from './elisp.js';
import { setTags, DEFAULT_TAGS_COLUMN } from './outline-edit.js';
import { recalc } from './tblfm.js';

const two = (n) => String(n).padStart(2, '0');
const join = (lines) => lines.map((l) => l.text + l.eol).join('');
const name = (x) => (isSym(x) ? x.sym : null);

/**
 * The templates in the text of an init file: the forms that set `org-capture-templates` with setq or add-to-list.
 * @returns {{ key: string, description: string, type: string, target: { kind: string, file?: string, path?: string[] }, template: string, opts: Record<string, any> }[]}
 */
export function parseTemplates(text, { now } = {}) {
  let list = [];
  const forms = readForms(text);
  const lisp = makeLisp(forms, now ? { now } : {});
  for (const form of forms) {
    const head = name(form[0]);
    if (head === 'defun') continue;
    if (head === 'setq') for (let i = 1; i < form.length; i += 2) { if (name(form[i]) === 'org-capture-templates') list = quoted(form[i + 1]); }
    else if (head === 'add-to-list' && name(unquote(form[1])) === 'org-capture-templates') list = form[3] ? [...list, quoted(form[2])] : [quoted(form[2]), ...list]; // as Emacs: the new template goes first unless APPEND
    else if (Array.isArray(form) && typeof form[0] === 'string') list = [...list, form];
    else if (form && form.quote) list = [...list, ...form.quote];
    else throw new Error('Expected setq or add-to-list for org-capture-templates');
  }
  return list.map((t) => ({ ...template(t), lisp }));
}
const unquote = (x) => (x && x.quote !== undefined ? x.quote : x);
const quoted = (x) => { const v = unquote(x); if (!Array.isArray(v)) throw new Error('Expected a list of templates'); return v; };

function template(t) {
  if (!Array.isArray(t) || typeof t[0] !== 'string' || typeof t[1] !== 'string') throw new Error('A template starts with a key and a description');
  if (t.length === 2) return { key: t[0], description: t[1], group: true };
  const [key, description, type, target, text, ...rest] = t;
  const kind = name(type);
  if (!['entry', 'item', 'checkitem', 'table-line', 'plain'].includes(kind)) throw new Error(`Template ${key}: unknown type ${kind ?? type}`);
  const tk = name(target?.[0]);
  const tree = /^file\+(olp\+)?(date|week)tree(\+prompt)?$/.exec(tk ?? '');
  const spec = tree ? { kind: 'datetree', file: target?.[1], path: tree[1] ? target.slice(2) : [], week: tree[2] === 'week', prompt: !!tree[3] } : { file: { kind: 'file', file: target?.[1] }, 'file+headline': { kind: 'headline', file: target?.[1], path: [target?.[2]] }, 'file+olp': { kind: 'olp', file: target?.[1], path: target?.slice(2) }, 'file+function': { kind: 'function', file: target?.[1], fn: name(unquote(target?.[2])) } }[tk];
  if (tk === 'file+function' && !spec.fn) throw new Error(`Template ${key}: file+function needs the name of a function`);
  if (!spec || typeof spec.file !== 'string') throw new Error(`Template ${key}: the target ${tk ?? 'given'} is not supported yet`);
  if (typeof text !== 'string') throw new Error(`Template ${key}: the template text is missing`);
  const opts = {};
  for (let i = 0; i < rest.length; i += 2) {
    const k = name(rest[i]);
    if (k === ':prepend') opts.prepend = rest[i + 1] === true;
    else if (k === ':empty-lines') { opts.before = opts.after = rest[i + 1]; }
    else if (k === ':empty-lines-before') opts.before = rest[i + 1];
    else if (k === ':empty-lines-after') opts.after = rest[i + 1];
    else if (k === ':immediate-finish') opts.immediate = rest[i + 1] === true;
    else if (k === ':clock-in') opts.clockIn = rest[i + 1] === true;
    else if (k === ':clock-keep') opts.clockKeep = rest[i + 1] === true;
    else if (k === ':clock-resume') opts.clockResume = rest[i + 1] === true;
    else if (k === ':tree-type') { const v = name(unquote(rest[i + 1])); if (v !== 'week') throw new Error(`Template ${key}: :tree-type ${v} is not supported yet`); if (spec.kind === 'datetree') spec.week = true; }
    else if (k === ':time-prompt') opts.timePrompt = rest[i + 1] === true;
    else if (k === ':prepare-finalize') { opts.prepare = name(unquote(rest[i + 1])); if (!opts.prepare) throw new Error(`Template ${key}: :prepare-finalize needs the name of a function`); }
    else throw new Error(`Template ${key}: the option ${k} is not supported yet`);
  }
  return { key, description, type: kind, target: spec, template: text, opts };
}

// ---- Escapes ------------------------------------------------------------------------------------------------------------

/**
 * The entries of the capture menu after the keys typed so far (`prefix`), in the order written: a template or group whose key is one
 * character longer than the prefix. A template "wm" without an entry "w" is not shown anywhere.
 * @returns {{ key: string, description: string, group: boolean, template?: object }[]}
 */
export function menuAt(templates, prefix = '') {
  const out = [];
  for (const t of templates) {
    if (!t.key.startsWith(prefix) || t.key.length <= prefix.length) continue;
    const key = t.key.slice(0, prefix.length + 1);
    const direct = t.key.length === prefix.length + 1;
    // Only a key that has its own entry is shown; longer keys without a group entry are not reachable, as in Emacs
    if (direct && !out.some((x) => x.key === key)) out.push({ key, description: t.description, group: !!t.group, ...(t.group ? {} : { template: t }) });
  }
  return out;
}

/** The template with exactly this key, or undefined (a group is not one). */
export const templateByKey = (templates, key) => templates.find((t) => t.key === key && !t.group);

/** The questions a template asks, in order: { prompt, default, choices }. */
export function promptsOf(tpl) {
  return [...tpl.matchAll(/%\^\{([^}]*)\}|%\^([TtUu])/g)].map((m) => {
    if (m[2]) return { prompt: 'Date', default: '', choices: [], date: { active: m[2] === 'T' || m[2] === 't', time: m[2] === 'T' || m[2] === 'U' } };
    const [prompt, def, ...more] = m[1].split('|'); return { prompt, default: more.length ? '' : def ?? '', choices: more.length ? [def, ...more] : [] };
  });
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function strftime(fmt, d) {
  const f = { Y: d.getUTCFullYear(), y: two(d.getUTCFullYear() % 100), m: two(d.getUTCMonth() + 1), d: two(d.getUTCDate()), e: String(d.getUTCDate()).padStart(2), H: two(d.getUTCHours()), M: two(d.getUTCMinutes()), S: two(d.getUTCSeconds()),
    a: DAYS[d.getUTCDay()].slice(0, 3), A: DAYS[d.getUTCDay()], b: MONTHS[d.getUTCMonth()].slice(0, 3), B: MONTHS[d.getUTCMonth()], '%': '%' };
  f.F = `${f.Y}-${f.m}-${f.d}`; f.T = `${f.H}:${f.M}:${f.S}`;
  return fmt.replace(/%(.)/g, (all, c) => (c in f ? String(f[c]) : all));
}

/**
 * The text of a template with its escapes filled in, and where the caret goes (the index of %?, or the end).
 * @param {string} tpl
 * @param {{ answers: string[], now: Date, link?: string, selection?: string }} ctx now is a UTC-field Date
 */
export function expand(tpl, { answers, now, link = '', selection = '' }) {
  const asked = promptsOf(tpl);
  const named = asked.flatMap((p, k) => (p.date ? [] : [k])); // %\\1 counts the %^{} questions only
  let n = 0;
  let caret = -1;
  let out = '';
  for (let i = 0; i < tpl.length; i++) {
    const rest = tpl.slice(i);
    let m;
    if ((m = /^%\^(?:\{([^}]*)\}|([TtUu]))/.exec(rest))) { const a = answers[n] ?? ''; out += a === '' ? asked[n].default : a; n++; i += m[0].length - 1; }
    else if ((m = /^%\\(\d)/.exec(rest))) { const k = named[+m[1] - 1]; const a = answers[k] ?? ''; out += a === '' ? asked[k]?.default ?? '' : a; i += m[0].length - 1; }
    else if ((m = /^%<([^>]*)>/.exec(rest))) { out += strftime(m[1], now); i += m[0].length - 1; }
    else if (/^%[UTtua?i]/.test(rest)) {
      const c = rest[1];
      if (c === 'U') out += formatStamp(now, { time: true, active: false });
      else if (c === 'T') out += formatStamp(now, { time: true });
      else if (c === 't') out += formatStamp(now);
      else if (c === 'u') out += formatStamp(now, { active: false });
      else if (c === 'a') out += link;
      else if (c === 'i') out += selection;
      else caret = out.length;
      i++;
    } else out += tpl[i];
  }
  if (caret >= 0 && caret === out.length) out += '\n'; // a caret at the very end sits on a line of its own
  return { text: out, caret: caret < 0 ? out.length : caret };
}

// ---- Filing ---------------------------------------------------------------------------------------------------------------

const blank = (n) => Array.from({ length: n ?? 0 }, () => ({ text: '', eol: '\n' }));
const asLines = (text) => splitLines(text.replace(/\n*$/, '\n'));

function insertAt(lines, at, add) {
  if (at > 0 && at <= lines.length && lines[at - 1].eol === '') lines[at - 1] = { ...lines[at - 1], eol: '\n' };
  lines.splice(at, 0, ...add);
}

/**
 * Files captured text into a document, as Emacs does.
 * @param {string} text the target document
 * @param {ReturnType<typeof parseTemplates>[number]} tpl
 * @param {string} captured the text of the capture buffer
 * @returns {{ text: string, line: number, clockLine: number | null }} the new document, the line where the new text starts, and the heading a :clock-in clocks (the new entry, or the heading an item went under)
 */
export function place(text, tpl, captured, { tagsColumn = DEFAULT_TAGS_COLUMN, unchanged = false, date = null } = {}) {
  let fnLine = -1;
  let dayLine = -1;
  if (tpl.target.kind === 'datetree') {
    let parentLine = null;
    let among = analyze(text).heads.filter((h) => h.level === 1);
    tpl.target.path.forEach((p, i) => {
      const h = among.find((x) => x.title === p);
      if (!h) throw new Error(`Heading not found on level ${i + 1}: ${p}`);
      parentLine = h.line; among = h.children;
    });
    if (!date) throw new Error('A date tree needs the date');
    const r = ensureDay(text, date, { week: tpl.target.week, parentLine });
    text = r.text; dayLine = r.line;
  }
  if (tpl.target.kind === 'function') {
    const r = tpl.lisp.call(tpl.target.fn, text);
    text = r.text;
    fnLine = text.slice(0, r.point - 1).split('\n').length - 1;
  }
  const lines = splitLines(text);
  const a = analyze(text);
  const prepend = tpl.opts.prepend === true;
  const t = tpl.target;
  // the region the text goes into: lines from `start` to `end`, and the level new headings get
  let start = 0;
  let end = lines.length;
  let level = 1;
  let head = null;
  let pendingHeading = null;
  let realign = false;
  let renumber = false;
  if (t.kind !== 'file') {
    const find = (title, among) => among.find((h) => h.title === title);
    if (t.kind === 'function') {
      const inside = a.heads.filter((h) => h.line <= fnLine && fnLine < h.end).sort((x, y) => y.level - x.level)[0];
      head = inside ?? null;
    } else if (t.kind === 'datetree') head = a.heads.find((h) => h.line === dayLine);
    else if (t.kind === 'headline') { head = find(t.path[0], a.heads); if (!head) pendingHeading = t.path[0]; }
    else {
      let among = a.heads.filter((h) => h.level === 1);
      t.path.forEach((p, i) => { head = find(p, among); if (!head) throw new Error(`Heading not found on level ${i + 1}: ${p}`); among = head.children; });
    }
    if (head) { start = head.line + 1; end = head.end; level = head.level + 1; }
  } else { const first = a.heads[0]; start = 0; end = lines.length; if (first && tpl.type !== 'entry' && tpl.type !== 'plain') end = first.line; }
  if (pendingHeading !== null) {
    insertAt(lines, lines.length, [{ text: `* ${pendingHeading}`, eol: '\n' }]);
    start = end = lines.length; level = 2;
  }
  const ownEnd = head ? head.bodyEnd : t.kind === 'file' ? (a.heads[0]?.line ?? lines.length) : end;
  const body = captured.replace(/\n+$/, '');
  let at;
  let add;
  if (tpl.type === 'entry') {
    const first = /^(\*+)/.exec(body);
    if (!first) throw new Error('An entry template must start with a heading');
    const shift = level - first[1].length;
    realign = shift !== 0;
    const shifted = body.split('\n').map((l) => (/^\*+ /.test(l) || /^\*+$/.test(l) ? '*'.repeat(Math.max(1, /^\*+/.exec(l)[0].length + shift)) + l.replace(/^\*+/, '') : l)).join('\n');
    add = [...blank(tpl.opts.before), ...asLines(shifted), ...blank(unchanged ? Math.max(0, /\n*$/.exec(captured)[0].length - 1) : 0), ...blank(tpl.opts.after)];
    at = prepend ? (head ? ownEnd : (a.heads[0]?.line ?? lines.length)) : end;
    if (prepend && !head && t.kind === 'file') at = a.heads[0]?.line ?? lines.length;
  } else if (tpl.type === 'plain') {
    add = [...blank(tpl.opts.before), ...asLines(body), ...blank(tpl.opts.after)];
    at = prepend ? start : end;
  } else if (tpl.type === 'table-line') {
    const rows = [];
    let s = -1;
    for (let i = start; i < ownEnd; i++) {
      if (/^\s*\|/.test(lines[i].text)) { if (s < 0) s = i; rows.push(i); } else if (s >= 0) break;
    }
    const row = body.trim();
    if (s < 0) {
      const n = row.replace(/^\||\|$/g, '').split('|').length;
      const table = alignLines([`|${' |'.repeat(n)}`, `|${'-+'.repeat(n).slice(0, -1)}|`, row]);
      at = ownEnd;
      add = table.map((x) => ({ text: x, eol: '\n' }));
    } else {
      const last = rows[rows.length - 1];
      const table = alignLines([...rows.map((i) => lines[i].text), row]);
      const eol = lines[last].eol || '\n';
      lines.splice(s, rows.length, ...table.slice(0, -1).map((x) => ({ text: x, eol: '\n' })));
      lines[s + rows.length - 1] = { ...lines[s + rows.length - 1], eol };
      at = s + rows.length; add = [{ text: table[table.length - 1], eol: '\n' }];
    }
  } else {
    const items = a.items.filter((it) => !it.parent && it.line >= start && it.line < ownEnd);
    const ref = items.length ? (prepend ? items[0] : items[items.length - 1]) : null;
    const refBullet = ref ? /^([ \t]*)([-+*]|\d+[.)])[ \t]/.exec(lines[ref.line].text) : null;
    const own = /^(?:[ \t]*(?:[-+]|\d+[.)])|[ \t]+\*)[ \t]/.exec(body); // a star is a bullet only when indented
    const ind = ' '.repeat(refBullet ? refBullet[1].length : 0);
    const bullet = own ? own[0].trim() : refBullet && /\d/.test(refBullet[2]) ? `1${refBullet[2].slice(-1)}` : '-';
    const [first, ...more] = (own ? body.slice(own[0].length) : body).split('\n');
    const pad = ' '.repeat(bullet.length + 1);
    const itemText = [`${ind}${bullet} ${first}`, ...more.map((l) => (l.trim() === '' ? l : `${ind}${pad}${l.replace(/^[ \t]+/, '')}`))].join('\n');
    add = [...blank(tpl.opts.before), ...asLines(itemText), ...blank(tpl.opts.after)];
    renumber = true;
    if (items.length) at = prepend ? items[0].line : items[items.length - 1].end;
    else { at = ownEnd; while (at > start && lines[at - 1].text.trim() === '') at--; }
  }
  insertAt(lines, at, add);
  let out = join(lines);
  if (renumber) { // the numbers of an ordered list run on from the first
    const l = out.split('\n');
    const top = analyze(out).items.filter((it) => !it.parent && it.line >= start && it.line < at + add.length + (ownEnd - start));
    const num = top.map((it) => /^([ \t]*)(\d+)([.)])/.exec(l[it.line]));
    const base = num[0] ? Number(num[0][2]) : 1;
    top.forEach((it, k) => { if (num[k]) l[it.line] = l[it.line].replace(/^([ \t]*)\d+/, `$1${base + k}`); });
    out = l.join('\n');
  }
  if (realign) { // an entry that was moved to another level has its tags set at the tag column
    const from = at + (tpl.opts.before ?? 0);
    const to = from + asLines(captured.replace(/\n+$/, '')).length;
    for (const h of analyze(out).heads.filter((x) => x.line >= from && x.line < to && x.tags.length)) out = setTags(out, h.line, h.tags, tagsColumn).text;
  }
  if (tpl.type === 'table-line') { // the table's formulas run over the new row
    const l = out.split('\n');
    let k = at;
    while (k < l.length && /^\s*\|/.test(l[k])) k++;
    if (/^[ \t]*#\+TBLFM:/i.test(l[k] ?? '')) out = recalc(out, k).text;
  }
  const mark = tpl.type === 'entry' ? at + (tpl.opts.before ?? 0) : at;
  const inside = analyze(out).heads.filter((h) => h.line <= mark && mark < h.end).sort((x, y) => y.level - x.level)[0];
  return { text: out, line: at, clockLine: inside ? inside.line : null };
}
