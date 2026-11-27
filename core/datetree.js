// Date trees, as Emacs's capture builds them: a year heading, then a month heading ("2026-11 November") or an ISO week heading
// ("2026-W48"), then a day heading ("2026-11-26 Thursday"), each created in order when missing. Written from the Org manual and observed
// Emacs 30.1 results (conformance v0.1.63, dt-*); no Emacs or Org source was read.

import { splitLines } from './parse.js';
import { analyze } from './outline.js';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const two = (n) => String(n).padStart(2, '0');
const join = (lines) => lines.map((l) => l.text + l.eol).join('');

/** The ISO 8601 week of a date given as UTC fields: [year, week]. */
export function isoWeek(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const first = Date.UTC(t.getUTCFullYear(), 0, 1);
  return [t.getUTCFullYear(), Math.ceil(((t - first) / 86400000 + 1) / 7)];
}

/** The three headings (key and title) for a date: the key is what an existing heading starts with. */
function levels(date, week, month = false) {
  const y = date.getUTCFullYear(); const m = date.getUTCMonth() + 1; const d = date.getUTCDate();
  const [iy, iw] = isoWeek(date);
  const mid = week ? `${iy}-W${two(iw)}` : `${y}-${two(m)}`;
  const day = `${y}-${two(m)}-${two(d)}`;
  const list = [
    { key: String(week ? iy : y), title: String(week ? iy : y), pattern: /^\d{4}/ },
    { key: mid, title: week ? mid : `${mid} ${MONTHS[m - 1]}`, pattern: week ? /^\d{4}-W\d\d/ : /^\d{4}-\d\d/ },
    { key: day, title: `${day} ${DAYS[date.getUTCDay()]}`, pattern: /^\d{4}-\d\d-\d\d/ },
  ];
  return month ? list.slice(0, 2) : list;
}

/**
 * Finds or creates the day's heading below the heading at `parentLine` (or at the top of the file when null).
 * @returns {{ text: string, line: number }} the new text and the line of the day heading
 */
export function ensureDay(text, date, { week = false, month = false, parentLine = null } = {}) {
  let out = text;
  let parent = parentLine;
  let line = -1;
  for (const [depth, lv] of levels(date, week, month).entries()) {
    const a = analyze(out);
    const p = parent === null ? null : a.heads.find((h) => h.line === parent);
    const level = p ? p.level + 1 : 1;
    const siblings = (p ? a.heads.filter((h) => h.line > p.line && h.line < p.end) : a.heads).filter((h) => h.level === level && lv.pattern.test(h.title));
    const found = siblings.find((h) => h.title === lv.key || h.title.startsWith(`${lv.key} `));
    if (found) { line = found.line; parent = found.line; continue; }
    const lines = splitLines(out);
    const later = siblings.find((h) => h.title.match(lv.pattern)[0] > lv.key);
    let at;
    if (later) at = later.line;
    else if (p) { at = p.end; while (at > p.line + 1 && lines[at - 1].text.trim() === '') at--; }
    else at = lines.length;
    if (at > 0 && lines[at - 1] && lines[at - 1].eol === '') lines[at - 1] = { ...lines[at - 1], eol: '\n' };
    const add = [{ text: `${'*'.repeat(level)} ${lv.title}`, eol: '\n' }];
    // A year put at the very top of the file leaves a blank line above it, as Emacs does
    if (at === 0 && depth === 0 && !p) add.unshift({ text: '', eol: '\n' });
    lines.splice(at, 0, ...add);
    out = join(lines);
    line = at + add.length - 1; parent = line;
  }
  // The last heading's blank lines at its end go: the new entry follows the last line of text
  const a = analyze(out);
  const day = a.heads.find((h) => h.line === line);
  const lines = splitLines(out);
  let end = day.end;
  while (end > day.line + 1 && lines[end - 1].text.trim() === '' && end < lines.length) end--;
  if (end < day.end) { lines.splice(end, day.end - end); out = join(lines); }
  return { text: out, line };
}
