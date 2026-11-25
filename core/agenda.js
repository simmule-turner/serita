// The agenda: the dated entries of some files laid out by day, the global TODO list, a tags view and a search view.
// The text it makes is what Emacs's agenda buffers hold (the layout is checked against recorded Emacs 30.1 results); the entries behind
// the text carry the file, the line and the parts, so a screen can draw them as rows. No DOM here.
// Written from the Org manual's description and observed Emacs results; no Emacs or Org source was read.

import { analyze } from './outline.js';
import { splitLines } from './parse.js';
import { propertiesOf } from './properties.js';
import { matcher } from './sparse.js';
import { effortMinutes } from './effort.js';
import { keeps } from './agenda-filter.js';
import { agendaLines, diaryEntries, hooks } from './diary.js';
import { anniversaries, parseContacts } from './contacts.js';
import { holidaysOf } from './holidays.js';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DAY = 86400000;
const two = (n) => String(n).padStart(2, '0');
const utc = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
const addDays = (d, n) => new Date(d.getTime() + n * DAY);
const key = (d) => d.getTime();
const diffDays = (a, b) => Math.round((a.getTime() - b.getTime()) / DAY);

/** The ISO week number of a date. */
export function weekOf(d) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  return Math.ceil(((t - Date.UTC(t.getUTCFullYear(), 0, 1)) / DAY + 1) / 7);
}

const STAMP = /([<[])(\d{4})-(\d\d)-(\d\d)(?: [^\s\d>\]+.-][^\s>\]]*)?(?: (\d{1,2}):(\d\d)(?:-(\d{1,2}):(\d\d))?)?(?: ((?:\+\+|\.\+|\+)(\d+)([hdwmy])))?[^>\]]*([>\]])/g;
const PLAN = /(SCHEDULED|DEADLINE|CLOSED):\s*([<[][^>\]]*[>\]])/g;

const parseStamp = (s) => {
  const m = new RegExp(STAMP.source).exec(s);
  if (!m) return null;
  return { active: m[1] === '<', date: utc(+m[2], +m[3], +m[4]), time: m[5] !== undefined ? `${two(+m[5])}:${m[6]}` : null, until: m[7] !== undefined ? `${two(+m[7])}:${m[8]}` : null,
    repeat: m[9] ? { n: +m[10], unit: m[11], kind: m[9].replace(/\d.*/, '') } : null };
};

const step = (d, r, k) => {
  const y = d.getUTCFullYear(), mo = d.getUTCMonth() + 1, da = d.getUTCDate();
  const n = r.n * k;
  return r.unit === 'd' ? addDays(d, n) : r.unit === 'w' ? addDays(d, 7 * n) : r.unit === 'm' ? utc(y, mo + n, da) : r.unit === 'y' ? utc(y + n, mo, da) : d;
};

/** The dates of a stamp that fall in [from, to]: its own, and with a repeater every repeat. */
function occurrences(st, from, to) {
  const out = [];
  if (!st.repeat || st.repeat.unit === 'h') { if (st.date >= from && st.date <= to) out.push(st.date); return out; }
  for (let k = 0; k < 4000; k++) { const d = step(st.date, st.repeat, k); if (d > to) break; if (d >= from) out.push(d); }
  return out;
}

const PRIORITY_VALUE = { A: 3, B: 2, C: 1 };
const prioOf = (e) => PRIORITY_VALUE[e.priority ?? 'B'];

/** Every heading of every file as the pieces the views use. */
function headings(files) {
  const out = [];
  files.forEach((f, fi) => {
    const a = analyze(f.text);
    const lines = splitLines(f.text);
    // A :CATEGORY: property on the heading or an ancestor wins over the file's #+CATEGORY: line, which wins over its name.
    const fileCategory = /^#\+CATEGORY:[ \t]*(\S.*?)[ \t]*$/im.exec(f.text)?.[1] ?? f.category;
    const categoryOf = (h) => { for (let x = h; x; x = x.parent) { const p = propertiesOf(f.text, x.line, lines).find(([n]) => n.toUpperCase() === 'CATEGORY'); if (p) return p[1]; } return fileCategory; };
    for (const h of a.heads) {
      const own = [];
      for (let i = h.line + 1; i < h.bodyEnd; i++) own.push(lines[i].text);
      out.push({ file: fi, category: categoryOf(h), line: h.line, h, a, own, text: f.text, lines, order: out.length });
    }
  });
  return out;
}

const done = (hd) => hd.h.todo && hd.a.todo.done.includes(hd.h.todo);

const label = (s) => s.padEnd(12);
const clockText = (t) => t.replace(/^0/, ' ');
const timeLabel = (st) => (st.until ? `${clockText(st.time)}-${st.until}` : `${clockText(st.time)}......`);
const GRID = ['08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00'];
/** The lines of a day: its timed entries with the time grid among them, then the untimed ones. */
const gridLines = (entries, now) => {
  const timed = entries.filter((e) => e.time);
  const marks = [...GRID.map((time) => ({ grid: true, time, text: `${' '.repeat(14)}${clockText(time).padStart(5)}...... ${'-'.repeat(16)}` })),
    ...(now ? [{ grid: true, time: now, text: `${' '.repeat(14)}${clockText(now).padStart(5)}...... now${' -'.repeat(25)}` }] : [])];
  const rows = [...timed.map((e) => ({ entry: e, time: e.time, rank: 0 })), ...marks.map((m) => ({ ...m, rank: 1 }))]
    .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : a.rank - b.rank));
  return [...rows, ...entries.filter((e) => !e.time).map((e) => ({ entry: e }))];
};

/** One line of an agenda buffer: two spaces, the category and a colon padded to 12 (a longer category is not cut), the label (agenda only) padded to 12, the headline, the tags at the right. */
export function entryText(e, withLabel) {
  const head = [e.todo, e.priority ? `[#${e.priority}]` : null, e.title].filter(Boolean).join(' ');
  const left = `  ${`${e.category}:`.padEnd(12)}${withLabel ? `${e.clock ? label(e.clock) : ''}${e.label ? label(e.label) : ''}` : ''}${head}`;
  if (!e.tags.length) return left;
  const tags = `:${e.tags.join(':')}:`;
  return left.length + tags.length + 1 > 79 ? `${left} ${tags}` : `${left}${' '.repeat(79 - left.length - tags.length)}${tags}`;
}

const inheritedTags = (h) => { const out = []; for (let x = h; x; x = x.parent) out.unshift(...x.tags); return [...new Set(out)]; };
const base = (hd) => ({ file: hd.file, line: hd.line, category: hd.category, todo: hd.h.todo, priority: hd.h.priority, title: hd.h.title, tags: hd.h.tags, done: done(hd),
  itags: inheritedTags(hd.h), effort: effortMinutes(propertiesOf(hd.text, hd.line, hd.lines).find(([n]) => n.toUpperCase() === 'EFFORT')?.[1]),
  text: [hd.h.todo, hd.h.priority ? `[#${hd.h.priority}]` : null, hd.h.title].filter(Boolean).join(' ') });

/**
 * The agenda for a span of days.
 * @param {{ category: string, text: string }[]} files
 * @param {{ start: Date, span: 'day'|'week'|'fortnight'|'month'|'year'|number, today: Date, warn?: number, now?: string }} o dates are UTC dates
 */
export function agenda(files, { start, span, today, warn = 14, now = null, timeGrid = true, filter = null, diary = null, holidays = null, contacts = null }) {
  let from = start;
  let days = typeof span === 'number' ? span : { day: 1, week: 7, fortnight: 14 }[span];
  if (span === 'month') { from = utc(start.getUTCFullYear(), start.getUTCMonth() + 1, 1); days = Math.round((utc(start.getUTCFullYear(), start.getUTCMonth() + 2, 1) - from) / DAY); }
  if (span === 'year') { from = utc(start.getUTCFullYear(), 1, 1); days = Math.round((utc(start.getUTCFullYear() + 1, 1, 1) - from) / DAY); }
  const to = addDays(from, days - 1);
  const todayIn = today >= from && today <= to;
  const byDay = new Map();
  for (let i = 0; i < days; i++) byDay.set(key(addDays(from, i)), []);
  const put = (d, e) => byDay.get(key(d))?.push(e);
  for (const hd of headings(files)) {
    const plan = hd.own.length && /^\s*(?:CLOSED|DEADLINE|SCHEDULED):/.test(hd.own[0]) ? hd.own[0] : '';
    for (const m of plan.matchAll(PLAN)) {
      const st = parseStamp(m[2]);
      if (!st || !st.active) continue;
      if (m[1] === 'SCHEDULED') {
        // A task that was due before today shows again on today, counted in days late; each repeat also shows on its own day.
        const overdue = todayIn && st.date < today && !done(hd);
        if (overdue) put(today, { ...base(hd), kind: 'scheduled', label: `Sched. ${diffDays(today, st.date)}x:`, late: diffDays(today, st.date) });
        for (const d of occurrences(st, from, to)) {
          if (overdue && st.repeat && d.getTime() === today.getTime()) continue;
          const own = d.getTime() === st.date.getTime();
          put(d, { ...base(hd), kind: 'scheduled', label: 'Scheduled:', clock: own && st.time ? timeLabel(st) : '', late: Math.max(0, diffDays(today, d)), time: own ? st.time : null });
        }
      } else if (m[1] === 'DEADLINE') {
        for (const d of occurrences({ ...st, repeat: null }, from, to)) put(d, { ...base(hd), kind: 'deadline', label: 'Deadline:', clock: st.time ? timeLabel({ ...st, until: null }) : '', late: diffDays(today, d), time: st.time });
        if (todayIn && !done(hd)) {
          const ahead = diffDays(st.date, today);
          if (ahead > 0 && ahead <= warn) put(today, { ...base(hd), kind: 'deadline', label: `In ${String(ahead).padStart(3)} d.:`, late: -ahead });
          else if (ahead < 0) put(today, { ...base(hd), kind: 'deadline', label: `${String(-ahead).padStart(2)} d. ago:`, late: -ahead, sortLate: -0.5 });
        }
      }
    }
    for (const text of hd.own.slice(plan ? 1 : 0)) {
      if (/^\s*:[A-Za-z_]+:/.test(text)) continue;
      for (const m of text.matchAll(STAMP)) {
        const st = parseStamp(m[0]);
        if (!st || !st.active) continue;
        for (const d of occurrences(st, from, to)) put(d, { ...base(hd), kind: 'stamp', label: '', clock: st.time ? timeLabel(st) : '', late: 0, time: st.time });
      }
    }
  }
  // Contacts: org-contacts-anniversaries in a diary or in an agenda file (an option: { texts, property, format })
  const book = contacts ? parseContacts(contacts.texts) : [];
  const born = new Set(); // the texts the contacts hook produced: those entries are birthdays
  const isBirthday = (t) => [...born].some((b) => t.includes(b));
  hooks['org-contacts-anniversaries'] = (args, date) => {
    const lines = anniversaries(book, date, { field: args[0] ?? contacts?.property ?? 'BIRTHDAY', ...(contacts?.format ? { format: contacts.format } : {}) });
    lines.forEach((l) => born.add(l));
    return { lines };
  };
  // Sexp lines (%%(...)) in the agenda files show on their day with the file's category, with no time or label
  files.forEach((f, i) => {
    if (!f.text.includes('%%(')) return;
    for (const e of diaryEntries(f.text, { y: from.getUTCFullYear(), m: from.getUTCMonth() + 1, d: from.getUTCDate() }, days, { sexpOnly: true })) {
      for (const l of agendaLines(e.text)) put(utc(e.y, e.m, e.d), { file: i, line: e.line, category: f.category, todo: null, priority: null, title: l.text, tags: [], itags: [], effort: null, text: l.text, done: false, kind: 'sexp', label: '', clock: l.time ? timeLabel(l) : '', late: 0, time: l.time, quiet: e.quiet, birthday: isBirthday(l.text) });
    }
  });
  // Holidays (options like holidaysOf takes) show as Diary lines, as Emacs shows them; a solar time becomes the line's time
  if (holidays) {
    const last = new Date(from.getTime() + (days - 1) * 86400000);
    for (let y = from.getUTCFullYear(); y <= last.getUTCFullYear(); y++) {
      for (const x of holidaysOf(y, holidays)) {
        const at = utc(x.y, x.m, x.d);
        if (at < from || at > last) continue;
        const text = x.said ?? x.name;
        put(at, { file: -1, line: 0, diary: true, category: 'Diary', todo: null, priority: null, title: text, tags: [], itags: [], effort: null, text, done: false, kind: 'diary', label: '', clock: x.time ? timeLabel({ time: x.time }) : '', late: 0, time: x.time ?? null, holiday: true });
      }
    }
  }
  // The diary: its entries for each day show with the category Diary (org-agenda-include-diary)
  if (diary) {
    for (const e of diaryEntries(diary.text, { y: from.getUTCFullYear(), m: from.getUTCMonth() + 1, d: from.getUTCDate() }, days, { style: diary.style })) {
      for (const l of agendaLines(e.text)) put(utc(e.y, e.m, e.d), { file: -1, line: e.line, diary: true, category: 'Diary', todo: null, priority: null, title: l.text, tags: [], itags: [], effort: null, text: l.text, done: false, kind: 'diary', label: '', clock: l.time ? timeLabel(l) : '', late: 0, time: l.time, quiet: e.quiet, birthday: isBirthday(l.text) });
    }
  }
  const lines = [];
  const weeks = (a, b) => `W${two(weekOf(a))}-W${two(weekOf(b))}`;
  const name = typeof span === 'number' ? ({ 1: 'Day', 7: 'Week', 14: 'Fortnight' }[span] ?? `${span}-day`) : span[0].toUpperCase() + span.slice(1);
  const w1 = two(weekOf(from)), w2 = two(weekOf(to));
  lines.push(`${name}-agenda${span === 'year' ? '' : ` (${w1 === w2 ? `W${w1}` : weeks(from, to)})`}:`);
  const outDays = [];
  for (let i = 0; i < days; i++) {
    const d = addDays(from, i);
    const entries = byDay.get(key(d)).filter((e) => keeps(e, filter)).map((e, i2) => ({ ...e, order: i2 })).sort((a, b) =>
      (a.time && !b.time ? -1 : !a.time && b.time ? 1 : a.time && b.time && a.time !== b.time ? (a.time < b.time ? -1 : 1) : 0)
      || prioOf(b) - prioOf(a) || (b.sortLate ?? b.late) - (a.sortLate ?? a.late) || a.order - b.order);
    const head = `${DAYS[d.getUTCDay()].padEnd(10)} ${String(d.getUTCDate()).padStart(2)} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}${d.getUTCDay() === 1 ? ` W${two(weekOf(d))}` : ''}`;
    // The time grid shows on every day of a day agenda, and on today only in longer ones, and only for a day that has an entry with a time.
    const isToday = key(d) === key(today);
    const rows = timeGrid && (days === 1 || isToday) && entries.some((e) => e.time) ? gridLines(entries, isToday ? now : null) : entries.map((entry) => ({ entry }));
    lines.push(head, ...rows.map((r) => (r.entry ? entryText(r.entry, true) : r.text)));
    outDays.push({ date: d, head, today: isToday, entries, rows });
  }
  return { title: lines[0], days: outDays, text: `${lines.join('\n')}\n` };
}

const sortByPriority = (list) => list.map((e, i) => ({ e, i })).sort((a, b) => prioOf(b.e) - prioOf(a.e) || a.i - b.i).map((x) => x.e);

/** The global list of TODO items: every open state, or only `keyword`. */
export function todoList(files, { keyword = null, filter = null } = {}) {
  const words = [...new Set(files.flatMap((f) => { const a = analyze(f.text); return [...a.todo.open, ...a.todo.done]; }))].sort();
  const entries = sortByPriority(headings(files).filter((hd) => hd.h.todo && (keyword ? hd.h.todo === keyword : !done(hd))).map((hd) => base(hd)).filter((e) => keeps(e, filter)));
  const head = [`Global list of TODO items of type: ${keyword ?? 'ALL'}`, `Press ‘N r’ (e.g. ‘0 r’) to search again: (0)[ALL] ${words.map((w, i) => `(${i + 1})${w}`).join(' ')}`];
  return { title: head[0], entries, text: `${[...head, ...entries.map((e) => entryText(e, false))].join('\n')}\n` };
}

/** The headings whose tags (inherited from above), TODO state, level or properties fit a match such as work+urgent/TODO. */
export function tagsView(files, { match, todoOnly = false, filter = null }) {
  const entries = [];
  for (const hd of headings(files)) {
    if (todoOnly && (!hd.h.todo || done(hd))) continue;
    if (matcher(match, hd.a)(hd.h, files[hd.file].text)) { const e = base(hd); if (keeps(e, filter)) entries.push(e); }
  }
  const head = [`Headlines with TAGS match: ${match}`, 'Press ‘C-u r’ to search again'];
  return { title: head[0], entries, text: `${[...head, ...entries.map((e) => entryText(e, false))].join('\n')}\n` };
}

/** The headings whose own text has every word (case ignored). */
export function searchView(files, { words, filter = null }) {
  const wanted = words.toLowerCase().split(/\s+/).filter(Boolean);
  const entries = [];
  for (const hd of headings(files)) {
    const text = [`${'*'.repeat(hd.h.level)} ${hd.h.todo ?? ''} ${hd.h.title}`, ...hd.own].join('\n').toLowerCase();
    if (wanted.length && wanted.every((w) => text.includes(w))) { const e = base(hd); if (keeps(e, filter)) entries.push(e); }
  }
  const head = [`Search words: ${words}`, 'Press ‘[’, ‘]’ to add/sub word, ‘{’, ‘}’ to add/sub regexp, ‘C-u r’ for a fresh search'];
  return { title: head[0], entries: sortByPriority(entries), text: `${[...head, ...sortByPriority(entries).map((e) => entryText(e, false))].join('\n')}\n` };
}
