// Timestamps: shifting a part of one with S-up and S-down, scheduling and deadlines, inserting one, typed dates, and repeating tasks.
// Written from the Org manual's description and from observed Emacs results (recorded as fixtures); no Emacs or Org source was read.
// Dates are plain calendar dates computed in UTC, so no time zone or daylight saving time can move a day.

import { splitLines } from './parse.js';
import { setProperty } from './properties.js';
import { analyze } from './outline.js';

const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
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
export function shiftStamp(text, offset, dir) {
  const s = stampAt(text, offset);
  if (!s) return null;
  const r = s.rel;
  let date = utc(s.y, s.m, s.d, s.h, s.mi);
  let repeater = s.repeater;
  let active = s.active;
  let said = null;
  if (r === s.closeAt) { active = !active; said = `Timestamp is now ${active ? 'active' : 'inactive'}`; }
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
 * Turns what was typed at a Date prompt into a date. Accepts 2026-12-01, with a time (2026-12-01 14:30) or without; a time alone;
 * +3d, -1w, +2m, +1y from the default; and today, tomorrow, yesterday. Empty keeps the default.
 * @param {string} input
 * @param {Date} base the default date (a UTC date)
 * @returns {{ date: Date, time: boolean }}
 */
export function parseDate(input, base) {
  let rest = input.trim().toLowerCase();
  let time = null;
  let until = null;
  // 14:30, 2pm, 9:05pm, and a range 10:00-11:30
  const hm = (h, m, ap) => [ap ? (+h % 12) + (ap === 'pm' ? 12 : 0) : +h, +(m ?? 0)];
  let t = /(?:^|\s)(\d{1,2}):(\d\d)(am|pm)?-(\d{1,2}):(\d\d)(am|pm)?$/.exec(rest);
  if (t) { time = hm(t[1], t[2], t[3]); until = `${two(hm(t[4], t[5], t[6])[0])}:${two(+t[5])}`; rest = rest.slice(0, t.index).trim(); }
  else if ((t = /(?:^|\s)(\d{1,2})(?::(\d\d))?(am|pm)$/.exec(rest)) || (t = /(?:^|\s)(\d{1,2}):(\d\d)()$/.exec(rest))) { time = hm(t[1], t[2], t[3] || undefined); rest = rest.slice(0, t.index).trim(); }
  const b = parts(base);
  let date = utc(b.y, b.m, b.d);
  const month = (w) => MONTH_NAMES.findIndex((x) => w.length >= 3 && x.startsWith(w)) + 1;
  let m;
  if (rest === '' || rest === '.' || rest === 'today') { /* the default */ }
  else if (rest === 'tomorrow') date = utc(b.y, b.m, b.d + 1);
  else if (rest === 'yesterday') date = utc(b.y, b.m, b.d - 1);
  else if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(rest))) date = utc(+m[1], +m[2], +m[3]);
  else if ((m = /^([a-z]{3,})\s+(\d{1,2})(?:\s+(\d{4}))?$/.exec(rest)) && month(m[1])) date = utc(m[3] ? +m[3] : b.y, month(m[1]), +m[2]);
  else if ((m = /^(\d{1,2})\s+([a-z]{3,})(?:\s+(\d{4}))?$/.exec(rest)) && month(m[2])) date = utc(m[3] ? +m[3] : b.y, month(m[2]), +m[1]);
  else if ((m = /^([-+])(\d+)([dwmy])$/.exec(rest))) {
    const n = (m[1] === '-' ? -1 : 1) * +m[2];
    date = m[3] === 'd' ? utc(b.y, b.m, b.d + n) : m[3] === 'w' ? utc(b.y, b.m, b.d + 7 * n) : m[3] === 'm' ? utc(b.y, b.m + n, b.d) : utc(b.y + n, b.m, b.d);
  } else throw new Error(`Not a date: ${input}`);
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
const logLine = (to, from, now) => `- State ${quote(to).padEnd(12)} from ${quote(from).padEnd(12)} ${formatStamp(now, { time: true, active: false })}`;

/**
 * Finishing a repeating task: its SCHEDULED or DEADLINE moves to the next date, the state goes back to `reopen`, :LAST_REPEAT: gets the time,
 * and a "State ... from ..." line is added after the properties drawer. Returns null when the heading has nothing that repeats.
 * @param {{ text: string, line: number, from: string, to: string, reopen: string, now: Date }} o `from` is the state before, `to` the done state
 */
export function completeRepeat({ text, line, from, to, reopen, now }) {
  const lines = splitLines(text);
  const plan = lines[line + 1];
  if (!plan || !/^\s*(?:CLOSED|DEADLINE|SCHEDULED):/.test(plan.text)) return null;
  let any = false;
  const moved = plan.text.replace(/([<[])(\d{4})-(\d\d)-(\d\d)(?: [^\s\d>\]+.-][^\s>\]]*)?(?: (\d{1,2}):(\d\d))?((?: (?:\+\+|\.\+|\+)\d+[hdwmy])+)([>\]])/g, (all, o, y, mo, d, h, mi, rep, c) => {
    any = true;
    const spec = rep.trim().split(/\s+/)[0];
    const next = nextRepeat(utc(+y, +mo, +d, +(h ?? 0), +(mi ?? 0)), spec, now);
    return formatStamp(next, { time: h !== undefined, repeater: rep, active: o === '<' });
  });
  if (!any) return null;
  lines[line + 1] = { ...plan, text: moved };
  const head = lines[line];
  lines[line] = { ...head, text: head.text.replace(new RegExp(`^(\\*+ +)${to}(?=\\s|$)`), `$1${reopen}`) };
  let out = lines.map((l) => l.text + l.eol).join('');
  out = setProperty(out, line, 'LAST_REPEAT', formatStamp(now, { time: true, active: false })).text;
  // The log line goes after the properties drawer, as Emacs puts it with no drawer for logs.
  const after = splitLines(out);
  let at = line + 1;
  if (/^\s*(?:CLOSED|DEADLINE|SCHEDULED):/.test(after[at].text)) at++;
  if (/^\s*:PROPERTIES:/i.test(after[at]?.text ?? '')) while (!/^\s*:END:/i.test(after[at].text)) at++, at;
  const insertAt = /^\s*:END:/i.test(after[at]?.text ?? '') ? at + 1 : at;
  if (after[insertAt - 1] && after[insertAt - 1].eol === '') after[insertAt - 1] = { ...after[insertAt - 1], eol: '\n' };
  after.splice(insertAt, 0, { text: logLine(to, from, now), eol: '\n' });
  return { text: after.map((l) => l.text + l.eol).join(''), line };
}
