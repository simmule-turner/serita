// The prefix of an agenda line: org-agenda-prefix-format and the category icons (checked against Emacs 30.1 with Org 9.7.11).
// A format is text with fields: %c category, %i icon, %t time, %s scheduling label, %l level, %e effort, %b breadcrumbs, %T last tag.
// After the %, in order: ? (leave the field out when it is empty), flags and a width such as -12 (left aligned) or 12, one
// punctuation or space character that follows a field only when it is not empty, and the letter. %% is a percent sign.
// Written from the Org manual's description and observed Emacs results; no Emacs or Org source was read.

import { readForms, isSym } from './lisp-read.js';
import { emacsRegexp } from './regexp.js';

export const DEFAULT_FORMATS = Object.freeze({ agenda: ' %i %-12:c%?-12t% s', todo: ' %i %-12:c', tags: ' %i %-12:c', search: ' %i %-12:c' });

const FIELD = /^%(\??)([-+0-9.]*)([ .;,:!?=|/<>]?)([ctselibT])/;

/** printf's %s: flags - (left), a width, and .N (cut to N characters). */
function fit(s, modifier) {
  const m = /^([-+0]*)(\d*)(?:\.(\d*))?$/.exec(modifier);
  if (!m) return s;
  const cut = m[3] !== undefined && m[3] !== '' ? s.slice(0, Number(m[3])) : s;
  const width = Number(m[2] || 0);
  return m[1].includes('-') ? cut.padEnd(width) : cut.padStart(width);
}

/**
 * Expands a prefix format for one entry.
 * @param {string} format
 * @param {{ category?: string, icon?: string, time?: string, label?: string, level?: number, effort?: string, crumbs?: string, tag?: string }} f
 */
export function formatPrefix(format, f) {
  const value = {
    c: f.category ?? '', i: f.icon ?? '', t: f.time ?? '', s: f.label ? f.label.padEnd(11) : '', l: ' '.repeat(f.level ?? 0),
    e: f.effort ?? '', b: f.crumbs ?? '', T: f.tag ?? '',
  };
  let out = '';
  for (let i = 0; i < format.length;) {
    if (format[i] !== '%') { out += format[i++]; continue; }
    if (format[i + 1] === '%') { out += '%'; i += 2; continue; }
    const m = FIELD.exec(format.slice(i));
    if (!m) { out += format[i++]; continue; }
    i += m[0].length;
    const raw = value[m[4]];
    if (m[1] === '?' && raw === '') continue;
    out += fit(raw !== '' ? raw + m[3] : raw, m[2]);
  }
  return out;
}

/** The fields of an agenda format, in order, for drawing rows: [{ spec, width, left, optional, after }]. */
export function prefixColumns(format) {
  const cols = [];
  for (let i = 0; i < format.length;) {
    if (format[i] !== '%') { i++; continue; }
    if (format[i + 1] === '%') { i += 2; continue; }
    const m = FIELD.exec(format.slice(i));
    if (!m) { i++; continue; }
    i += m[0].length;
    const w = /^([-+0]*)(\d*)/.exec(m[2]);
    cols.push({ spec: m[4], width: Number(w[2] || 0), left: w[1].includes('-'), optional: m[1] === '?', after: m[3] });
  }
  return cols;
}

const name = (x) => (isSym(x) ? x.sym : null);
const unquote = (x) => (x && x.quote !== undefined ? x.quote : x);

/**
 * The agenda display settings in the text of an init file: setq of org-agenda-prefix-format (an alist from agenda, todo, tags
 * and search to a format) and org-agenda-category-icon-alist (a category regexp and an icon: a list holding a string for text, or a file name).
 * @returns {{ formats: Record<string,string>, icons: { re: RegExp, text: string|null }[] }}
 */
export function parseAgendaSettings(text) {
  const out = { formats: { ...DEFAULT_FORMATS }, icons: [] };
  for (const form of readForms(text)) {
    if (name(form[0]) !== 'setq') throw new Error('Expected setq');
    for (let i = 1; i < form.length; i += 2) {
      const v = name(form[i]);
      const val = unquote(form[i + 1]);
      if (v === 'org-agenda-prefix-format') {
        for (const pair of val ?? []) {
          const kind = name(pair[0]);
          const f = pair.tail ?? pair[1];
          if (!(kind in DEFAULT_FORMATS)) throw new Error(`${kind ?? 'That'} is not a view with a prefix format`);
          if (typeof f !== 'string') throw new Error('A prefix format is a string');
          out.formats[kind] = f;
        }
      } else if (v === 'org-agenda-category-icon-alist') {
        out.icons = (val ?? []).map((rule) => {
          if (typeof rule[0] !== 'string') throw new Error('An icon rule starts with a category regexp');
          const data = rule[1];
          return { re: emacsRegexp(rule[0], false), text: Array.isArray(data) && typeof data[0] === 'string' ? data[0] : null };
        });
      } else throw new Error(`${v ?? 'That'} is not an agenda display setting`);
    }
  }
  return out;
}

/** The icon of a category: { text } for a text icon (a file name gives text null) or null when no rule matches. The first rule wins. */
export function iconFor(icons, category) {
  for (const r of icons) { r.re.lastIndex = 0; if (r.re.test(category)) return { text: r.text }; }
  return null;
}

/**
 * The columns of the phone rows for the entries on screen: the format's fields, each as wide as its longest value (a category no wider than the format asks), and left out when every value is empty.
 * @returns {{ spec: string, width: number }[] & { cells?: never }} columns; use `phoneCells` for one entry's texts.
 */
export function phoneColumns(format, entries, icons) {
  const cols = [];
  for (const c of prefixColumns(format)) {
    const longest = entries.reduce((n, e) => Math.max(n, [...phoneValue(c.spec, e, icons)].length), 0);
    if (!longest) continue;
    cols.push({ spec: c.spec, width: c.spec === 'c' && c.width ? Math.min(c.width, longest) : longest });
  }
  return cols;
}

/** One entry's texts for those columns, a category cut to its column. */
export const phoneCells = (cols, e, icons) => cols.map((c) => [...phoneValue(c.spec, e, icons)].slice(0, c.width).join(''));

function phoneValue(spec, e, icons) {
  switch (spec) {
    case 'c': return e.category ?? '';
    case 'i': return iconFor(icons, e.category ?? '')?.text ?? '';
    case 't': return e.clock ?? '';
    case 's': return e.label ?? '';
    case 'l': return ' '.repeat(e.level ?? 0);
    case 'e': return e.effortText ?? '';
    case 'b': return e.crumbs ?? '';
    case 'T': return e.itags?.at(-1) ?? '';
    default: return '';
  }
}
