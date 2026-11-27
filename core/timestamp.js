// Timestamps: shifting a part of one with S-up and S-down, scheduling and deadlines, inserting one, typed dates, and repeating tasks.
// Written from the Org manual's description and from observed Emacs results (recorded as fixtures); no Emacs or Org source was read.
// Dates are plain calendar dates computed in UTC, so no time zone or daylight saving time can move a day.

import { splitLines } from './parse.js';
import { setProperty } from './properties.js';
import { analyze } from './outline.js';

const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const REPEAT_UNITS = ['d', 'w', 'm', 'y'];
const two = (n) => String(n).padStart(2, '0');
const STAMP = /([<[])(\d{4})-(\d\d)-(\d\d)(?: ([^\s\d>\]+.-][^\s>\]]*))?(?: (\d{1,2}):(\d\d))?((?: (?:\+\+|\.\+|\+)\d+[hdwmy])*)([>\]])/g;

/** @returns {Date} a UTC date for the parts, normalized as a calendar does (month 12 is January of the next year). */
const utc = (y, m, d, h = 0, mi = 0) => new Date(Date.UTC(y, m - 1, d, h, mi));
const parts = (d) => ({ y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes() });

/** The text of a timestamp for a date, with an optional time and repeater. */
export function formatStamp(date, { time = false, until = null, repeater = '', active = true } = {}) {
  const p = parts(date);
  return `${active ? '<' : '['}${p.y}-${two(p.m)}-${two(p.d)} ${DAYS[date.getUTCDay()]}${time ? ` ${two(p.h)}:${two(p.mi)}${until ? `-${until}` : ''}` : ''}${repeater}${active ? '>' : ']'}`;
}

/** The timestamp on the line that the offset is in or at the end of: { start, end, ... } with the parsed parts, or null. */
export function stampAt(text, offset) {
  const ls = text.lastIndexOf('\n', offset - 1) + 1;
  const le = text.indexOf('\n', offset) < 0 ? text.length : text.indexOf('\n', offset);
  const line = text.slice(ls, le);
  for (const m of line.matchAll(STAMP)) {
    const start = ls + m.index;
    const end = start + m[0].length;
    if (offset < start || offset >= end) continue;
    return { start, end, active: m[1] === '<', y: +m[2], m: +m[3], d: +m[4], hasTime: m[6] !== undefined, h: +(m[6] ?? 0), mi: +(m[7] ?? 0), repeater: m[8], raw: m[0], rel: offset - start,
      timeAt: m[6] !== undefined ? m[0].indexOf(`${m[6]}:${m[7]}`) : -1, closeAt: m[0].length - 1, repeaterAt: m[8] ? m[0].length - 1 - m[8].length : -1 };
  }
  return null;
}

/**
 * S-up (dir 1) and S-down (dir -1) with the cursor on a timestamp: the year, month, day (or the weekday name), hour or minute under it
 * goes up or down by one; on the closing bracket the stamp becomes inactive or active; on the repeater the number changes.
 * @returns {{ text: string, pos: number, said: string | null } | null} null when the cursor is not on a timestamp
 */
export function shiftStamp(text, offset, dir, { sideways = false } = {}) {
  const s = stampAt(text, offset);
  if (!s) return null;
  const r = s.rel;
  let date = utc(s.y, s.m, s.d, s.h, s.mi);
  let repeater = s.repeater;
  let active = s.active;
  let said = null;
  if (sideways) date = utc(s.y, s.m, s.d + dir, s.h, s.mi);
  else if (r === s.closeAt || r === 0) { active = !active; said = `Timestamp is now ${active ? 'active' : 'inactive'}`; }
  else if (s.repeaterAt >= 0 && r === s.closeAt - 1) repeater = repeater.replace(/[hdwmy]$/, (u) => (REPEAT_UNITS.includes(u) ? REPEAT_UNITS[Math.min(REPEAT_UNITS.length - 1, Math.max(0, REPEAT_UNITS.indexOf(u) + dir))] : u));
  else if (s.repeaterAt >= 0 && r >= s.repeaterAt) repeater = repeater.replace(/(\d+)(?=[hdwmy]$)/, (n) => String(Math.max(1, +n + dir)));
  else if (s.hasTime && r >= s.timeAt + 3) { const m = s.mi; date = utc(s.y, s.m, s.d, s.h, (dir > 0 ? Math.floor(m / 5) * 5 + 5 : Math.ceil(m / 5) * 5 - 5)); }
  else if (s.hasTime && r >= s.timeAt) date = utc(s.y, s.m, s.d, s.h + dir, s.mi);
  else if (r < 6) date = utc(s.y + dir, s.m, s.d, s.h, s.mi);
  else if (r < 9) date = utc(s.y, s.m + dir, s.d, s.h, s.mi);
  else date = utc(s.y, s.m, s.d + dir, s.h, s.mi);
  const next = formatStamp(date, { time: s.hasTime, repeater, active });
  return { text: text.slice(0, s.start) + next + text.slice(s.end), pos: offset, said };
}

/**
 * Turns what was typed at a Date prompt into a date, as Org reads it (Emacs 30.1 results): 2026-12-01, 27-1-3, 12-5, 12/5, 3.1.2027, dec 5,
 * 5 dec, dec, a day number, a weekday (the next one), +3d, -1w, +2m, +1y, +fri, -fri, and a time (14:30, 2pm, 10:00-11:30). A date that has gone
 * by this year means next year; words Org does not know are skipped. Empty keeps the default.
 * @param {string} input
 * @param {Date} base the default date (a UTC date); `+3d` counts from `today`, `++3d` from the default (observed, dq-*)
 * @param {Date} [today] the current date, a UTC date
 * @returns {{ date: Date, time: boolean }}
 */
export function parseDate(input, base, today = base) {
  let rest = input.trim().toLowerCase();
  let time = null;
  let until = null;
  // 14:30, 2pm, 9:05pm, and a range 10:00-11:30
  const hm = (h, m, ap) => [ap ? (+h % 12) + (ap === 'pm' ? 12 : 0) : +h, +(m ?? 0)];
  let t = /(?:^|\s)(\d{1,2}):(\d\d)(am|pm)?-(\d{1,2}):(\d\d)(am|pm)?$/.exec(rest);
  if (t) { time = hm(t[1], t[2], t[3]); until = `${two(hm(t[4], t[5], t[6])[0])}:${two(+t[5])}`; rest = rest.slice(0, t.index).trim(); }
  else if ((t = /(?:^|\s)(\d{1,2})(?::(\d\d))?(am|pm)$/.exec(rest)) || (t = /(?:^|\s)(\d{1,2}):(\d\d)()$/.exec(rest))) { time = hm(t[1], t[2], t[3] || undefined); rest = rest.slice(0, t.index).trim(); }
  const b = parts(base);
  const month = (w) => (w.length >= 3 ? MONTH_NAMES.findIndex((x) => x.startsWith(w)) + 1 : 0);
  const weekday = (w) => (w.length >= 3 ? WEEKDAYS.findIndex((x) => x.startsWith(w)) : -1);
  const year2 = (y) => (y.length <= 2 ? 2000 + +y : +y);
  let date = null;
  let y = null;
  let mo = null;
  let d = null;
  let wd = -1;
  let week = null;
  let iso = false;
  let m;
  // Words Org does not know (tomorrow, next, now) are skipped, so a prompt with only those keeps the default date.
  for (const w of rest.split(/\s+/).filter(Boolean)) {
    if (w === '.' || w === 'today') continue;
    if ((m = /^\+{1,2}(\d*)([dwmy]|[a-z]{3,})?$/.exec(w)) || (m = /^(-)(\d*)([dwmy]|[a-z]{3,})?$/.exec(w))) {
      const minus = w[0] === '-';
      const from = !minus && w.startsWith('++') ? base : today;
      const [num, unit] = m.length === 3 ? [m[1], m[2]] : [m[2], m[3]];
      const n = (num === '' ? 1 : +num) * (minus ? -1 : 1);
      const u = unit && unit.length === 1 ? unit : unit ? null : 'd';
      const f = parts(from);
      if (u === 'd') date = utc(f.y, f.m, f.d + n);
      else if (u === 'w') date = utc(f.y, f.m, f.d + 7 * n);
      else if (u === 'm') date = utc(f.y, f.m + n, f.d);
      else if (u === 'y') date = utc(f.y + n, f.m, f.d);
      else if (weekday(unit) >= 0) {
        // +fri is the next Friday after the default date, -fri the last one before it; a number counts them.
        const step = minus ? -1 : 1;
        let left = Math.abs(n);
        date = utc(b.y, b.m, b.d);
        while (left > 0) { date = utc(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate() + step); if (date.getUTCDay() === weekday(unit)) left--; }
      }
    } else if ((m = /^w(\d{1,2})$/.exec(w))) week = +m[1];
    else if ((m = /^(\d{2,4})-(\d{1,2})-(\d{1,2})$/.exec(w))) { y = year2(m[1]); mo = +m[2]; d = +m[3]; iso = true; }
    else if ((m = /^(\d{1,2})[-/](\d{1,2})$/.exec(w))) { mo = +m[1]; d = +m[2]; }
    else if ((m = /^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/.exec(w))) { d = +m[1]; mo = +m[2]; y = year2(m[3]); }
    else if ((m = /^(\d{1,2})\.(\d{1,2})$/.exec(w))) { d = +m[1]; mo = +m[2]; }
    else if (/^\d{4}$/.test(w)) y = +w;
    else if (/^\d{1,2}$/.test(w)) { if (!iso) d = +w; }
    else if (month(w)) mo = month(w);
    else if (weekday(w) >= 0) wd = weekday(w);
  }
  if (date === null && week !== null) {
    // ISO week: the Monday of week n of the year (the default year when none is typed)
    const year = y ?? b.y;
    const jan4 = utc(year, 1, 4);
    date = utc(year, 1, 4 - ((jan4.getUTCDay() + 6) % 7) + 7 * (week - 1));
  }
  if (date === null) {
    const today = utc(b.y, b.m, b.d);
    if (wd >= 0) { const ahead = ((wd - today.getUTCDay() + 6) % 7) + 1; date = utc(b.y, b.m, b.d + ahead); }
    else if (y === null && mo === null && d !== null) date = utc(b.y, b.m + (d < b.d ? 1 : 0), d);
    else if (y !== null || mo !== null || d !== null) {
      // Without a year, a date that has gone by this year means the next one.
      date = utc(y ?? b.y, mo ?? b.m, d ?? b.d);
      if (y === null && date < today) date = utc(b.y + 1, mo ?? b.m, d ?? b.d);
    } else date = today;
  }
  if (time) date = utc(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), time[0], time[1]);
  return { date, time: time !== null, until };
}

const PLAN_ORDER = ['CLOSED', 'DEADLINE', 'SCHEDULED'];
const planningOf = (line) => [...line.matchAll(/(CLOSED|DEADLINE|SCHEDULED):\s*([<[][^>\]]*[>\]])/g)].map((m) => [m[1], m[2]]);

/** Sets SCHEDULED or DEADLINE on the heading at `line`, on the planning line under it (made if it is missing). */
export function setPlanning(text, line, keyword, stamp) {
  const lines = splitLines(text);
  const own = lines[line + 1] && /^\s*(?:CLOSED|DEADLINE|SCHEDULED):/.test(lines[line + 1].text);
  const have = own ? planningOf(lines[line + 1].text) : [];
  const kept = have.filter(([k]) => k !== keyword);
  const all = [...kept, [keyword, stamp]].sort((a, b) => PLAN_ORDER.indexOf(a[0]) - PLAN_ORDER.indexOf(b[0]));
  const out = all.map(([k, v]) => `${k}: ${v}`).join(' ');
  if (own) lines[line + 1] = { ...lines[line + 1], text: out };
  else {
    if (lines[line].eol === '') lines[line] = { ...lines[line], eol: '\n' };
    lines.splice(line + 1, 0, { text: out, eol: '\n' });
  }
  return { text: lines.map((l) => l.text + l.eol).join(''), line };
}

/** Inserts a timestamp at the offset. */
export function insertStamp(text, offset, stamp) {
  return { text: text.slice(0, offset) + stamp + text.slice(offset), pos: offset + stamp.length };
}

const REPEAT = /^(\+\+|\.\+|\+)(\d+)([hdwmy])$/;

const addUnit = (d, n, unit) => {
  const p = parts(d);
  return unit === 'h' ? utc(p.y, p.m, p.d, p.h + n, p.mi) : unit === 'd' ? utc(p.y, p.m, p.d + n, p.h, p.mi) : unit === 'w' ? utc(p.y, p.m, p.d + 7 * n, p.h, p.mi)
    : unit === 'm' ? utc(p.y, p.m + n, p.d, p.h, p.mi) : utc(p.y + n, p.m, p.d, p.h, p.mi);
};

/** The next date of a repeating stamp: + adds one interval, ++ adds until it is after now, .+ adds one interval to now (the time of day is kept). */
export function nextRepeat(date, spec, now) {
  const m = REPEAT.exec(spec.trim());
  if (!m) return date;
  const [, kind, n, unit] = m;
  const p = parts(date);
  if (kind === '+') return addUnit(date, +n, unit);
  const n0 = parts(now);
  if (kind === '.+') return unit === 'h' ? addUnit(now, +n, unit) : utc(...Object.values(parts(addUnit(utc(n0.y, n0.m, n0.d), +n, unit))).slice(0, 3), p.h, p.mi);
  let d = addUnit(date, +n, unit);
  const today = utc(n0.y, n0.m, n0.d, 23, 59);
  while (d <= (unit === 'h' ? now : today)) d = addUnit(d, +n, unit);
  return d;
}

const quote = (s) => `"${s}"`;
export const logLine = (to, from, now) => `- State ${quote(to).padEnd(12)} from ${quote(from).padEnd(12)} ${formatStamp(now, { time: true, active: false })}`;

/**
 * Finishing a repeating task: every active timestamp with a repeater in the entry (up to the next heading) moves to its next date, the state
 * goes back to `reopen`, :LAST_REPEAT: gets the time, and a "State ... from ..." line is added after the properties drawer.
 * A CLOSED stamp is dropped. Returns null when the entry has nothing that repeats.
 * @param {{ text: string, line: number, from: string, to: string, reopen: string, now: Date }} o `from` is the state before, `to` the done state
 */
export function completeRepeat({ text, line, from, to, reopen, now, drawer = null, log = true, note }) {
  const lines = splitLines(text);
  let any = false;
  const REPEATING = /<(\d{4})-(\d\d)-(\d\d)(?: [^\s\d>\]+.-][^\s>\]]*)?(?: (\d{1,2}):(\d\d))?((?: (?:\+\+|\.\+|\+)\d+[hdwmy])+)>/g;
  const end = lines.findIndex((l, i) => i > line && /^\*+ /.test(l.text));
  const last = end < 0 ? lines.length : end;
  for (let i = line + 1; i < last; i++) {
    lines[i] = { ...lines[i], text: lines[i].text.replace(REPEATING, (all, y, mo, d, h, mi, rep) => {
      any = true;
      const next = nextRepeat(utc(+y, +mo, +d, +(h ?? 0), +(mi ?? 0)), rep.trim().split(/\s+/)[0], now);
      return formatStamp(next, { time: h !== undefined, repeater: rep });
    }) };
  }
  if (!any) return null;
  const closed = /^\s*CLOSED:/.test(lines[line + 1]?.text ?? '');
  if (closed) {
    const rest = lines[line + 1].text.replace(/CLOSED: *\[[^\]]*\] */, '').trimEnd();
    if (rest.trim() === '') lines.splice(line + 1, 1); else lines[line + 1] = { ...lines[line + 1], text: rest };
  }
  const head = lines[line];
  lines[line] = { ...head, text: head.text.replace(new RegExp(`^(\\*+ +)${to}(?=\\s|$)`), `$1${reopen}`) };
  let out = lines.map((l) => l.text + l.eol).join('');
  // With org-log-repeat nil nothing is recorded: no :LAST_REPEAT: and no log line.
  if (!log) return { text: out, line };
  out = setProperty(out, line, 'LAST_REPEAT', formatStamp(now, { time: true, active: false })).text;
  // The log line goes after the properties drawer, or inside the log drawer (org-log-into-drawer) that follows it.
  if (note === null) return { text: out, line };
  return { text: addLogEntry(out, line, { heading: logLine(to, from, now).slice(2), note, drawer, bare: note !== undefined }), line };
}

/**
 * Adds a log entry `- heading` (with the note under it) to the entry at `line`: after the planning line and the properties drawer, or in the
 * drawer `drawer` (made when it is missing; the newest entry first). An empty note adds the heading alone. `bare` leaves the end of the
 * text without a line end when the entry is its last line.
 */
export function addLogEntry(text, line, { heading, note, drawer = null, bare = false }) {
  const after = splitLines(text);
  let at = line + 1;
  if (/^\s*(?:CLOSED|DEADLINE|SCHEDULED):/.test(after[at]?.text ?? '')) at++;
  if (/^\s*:PROPERTIES:/i.test(after[at]?.text ?? '')) while (!/^\s*:END:/i.test(after[at].text)) at++;
  const insertAt = /^\s*:END:/i.test(after[at]?.text ?? '') ? at + 1 : at;
  if (after[insertAt - 1] && after[insertAt - 1].eol === '') after[insertAt - 1] = { ...after[insertAt - 1], eol: '\n' };
  const noteLines = typeof note === 'string' && note.trim() !== '' ? ` \\\\\n${note.replace(/\n+$/, '').split('\n').map((l) => (l === '' ? '' : `  ${l}`)).join('\n')}` : '';
  const entry = { text: `- ${heading}${noteLines}`, eol: bare && drawer === null && insertAt >= after.length ? '' : '\n' };
  const open = drawer === null ? -1 : after.findIndex((l, i) => i >= insertAt && l.text.trim().toUpperCase() === `:${drawer.toUpperCase()}:`);
  if (drawer === null) after.splice(insertAt, 0, entry);
  else if (open >= 0 && open === insertAt) after.splice(open + 1, 0, entry);
  else after.splice(insertAt, 0, { text: `:${drawer}:`, eol: '\n' }, entry, { text: ':END:', eol: '\n' });
  return after.map((l) => l.text + l.eol).join('');
}

/** The entry's CLOSED stamp removed (and the planning line with it when nothing else is on it). */
export function dropClosed(text, line) {
  const lines = splitLines(text);
  if (!/^\s*CLOSED:/.test(lines[line + 1]?.text ?? '')) return text;
  const rest = lines[line + 1].text.replace(/CLOSED: *\[[^\]]*\] */, '').trimEnd();
  if (rest.trim() === '') lines.splice(line + 1, 1); else lines[line + 1] = { ...lines[line + 1], text: rest };
  return lines.map((l) => l.text + l.eol).join('');
}

/** The entry's CLOSED stamp set to `now`. */
export const setClosed = (text, line, now) => setPlanning(text, line, 'CLOSED', formatStamp(now, { time: true, active: false })).text;

/** The date an entry's planning stamp has (its text, as an inactive stamp with its weekday and time), or null. */
export function planningStamp(text, line, keyword) {
  const l = splitLines(text)[line + 1]?.text ?? '';
  const m = new RegExp(`${keyword}:\\s*[<[]([^>\\]]*)[>\\]]`).exec(/^\s*(?:CLOSED|DEADLINE|SCHEDULED):/.test(l) ? l : '');
  return m ? `[${m[1]}]` : null;
}
