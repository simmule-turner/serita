// Filters for the agenda, as Emacs's / commands make them (conformance v0.1.23 and v0.1.24): by tag, category, effort and regexp.
import { emacsRegexp } from './regexp.js';
import { effortMinutes } from './effort.js';

/** "+work -home" -> [{ sign: '+', value: 'work' }, { sign: '-', value: 'home' }]; a missing sign is +. */
export function parseSigned(typed) {
  return typed.trim().split(/\s+/).filter(Boolean).map((w) => (/^[+-]/.test(w) ? { sign: w[0], value: w.slice(1) } : { sign: '+', value: w })).filter((x) => x.value !== '');
}

/**
 * Parses an effort filter such as <1:00, >0:30 or =2:00 (a leading + or - is allowed and does not change it, as Emacs does).
 * @returns {{ op: string, minutes: number }}
 */
export function parseEffort(typed) {
  const m = /^[+-]?([<>=])\s*(\S+)$/.exec(typed.trim());
  const minutes = m ? effortMinutes(m[2]) : null;
  if (!m || minutes === null) throw new Error(`Invalid duration format: "${typed.trim()}"`);
  return { op: m[1], minutes };
}

/** No filter at all. */
export const noFilter = () => ({ tags: [], category: [], regexp: [], effort: null });

export const filterActive = (f) => !!f && (f.tags.length > 0 || f.category.length > 0 || f.regexp.length > 0 || f.effort !== null);

/** What the filter says, for the agenda's title bar: [+work -home] [+calls] [<1:00] [+rent]. */
export function filterLabel(f) {
  const one = (list) => list.map((x) => `${x.sign}${x.value}`).join(' ');
  return [f.tags.length ? `[${one(f.tags)}]` : '', f.category.length ? `[${one(f.category)}]` : '', f.effort ? `[${f.effort.op}${f.effort.minutes}]` : '', f.regexp.length ? `[${one(f.regexp)}]` : ''].filter(Boolean).join(' ');
}

/**
 * Whether an agenda entry stays. Tags must all be present (+) or absent (-); the category is the one named or not;
 * an effort filter keeps entries by their Effort, and an entry without one only for >; a regexp must (+) or must not (-) match the line.
 * @param {{ itags: string[], category: string, effort: number|null, text: string }} e
 */
export function keeps(e, f) {
  if (!f) return true;
  const tags = e.itags.map((t) => t.toLowerCase());
  for (const t of f.tags) if (tags.includes(t.value.toLowerCase()) !== (t.sign === '+')) return false;
  for (const c of f.category) if ((e.category.toLowerCase() === c.value.toLowerCase()) !== (c.sign === '+')) return false;
  if (f.effort) {
    const { op, minutes } = f.effort;
    if (e.effort === null) return op === '>';
    if (!(op === '<' ? e.effort < minutes : op === '>' ? e.effort > minutes : e.effort === minutes)) return false;
  }
  for (const r of f.regexp) { const re = emacsRegexp(r.value, true); re.lastIndex = 0; if (re.test(e.text) !== (r.sign === '+')) return false; }
  return true;
}
