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
import { agendaLines, diaryEntries, hooks, ev } from './diary.js';
import { readForms } from './lisp-read.js';
import { anniversaries, parseContacts } from './contacts.js';
import { holidaysOf } from './holidays.js';
import { DEFAULT_FORMATS, formatPrefix, iconFor } from './prefix.js';

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

/** The <%%(sexp)> timestamps of a line: the sexp's source, what follows it inside the brackets (a time), and where it sits. */
function sexpStamps(text) {
  const out = [];
  for (let at = text.indexOf('<%%('); at >= 0; at = text.indexOf('<%%(', at + 1)) {
    let depth = 0; let str = false; let end = -1;
    for (let k = at + 3; k < text.length; k++) {
      const c = text[k];
      if (str) { if (c === '\\') k++; else if (c === '"') str = false; continue; }
      if (c === '"') str = true; else if (c === '(') depth++; else if (c === ')' && --depth === 0) { end = k; break; }
    }
    if (end < 0) break;
    const close = text.indexOf('>', end);
    if (close < 0) break;
    out.push({ sexp: text.slice(at + 3, end + 1), rest: text.slice(end + 1, close), start: at, end: close + 1 });
  }
  return out;
}

const PRIORITY_VALUE = { A: 3, B: 2, C: 1 };
const KIND_RANK = { scheduled: 0, deadline: 1, stamp: 2 };
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

const clockText = (t) => t.replace(/^0/, ' ');
const timeLabel = (st) => (st.until ? `${clockText(st.time)}-${st.until}` : `${clockText(st.time)}......`);
const GRID = ['08:00', '10:00', '12:00', '14:00', '16:00', '18:00', '20:00'];
/** The lines of a day: its timed entries with the time grid among them, then the untimed ones. */
const gridLines = (entries, now, prefix) => {
  const row = (time, text) => `${formatPrefix(prefix.formats.agenda, { time: `${clockText(time).padStart(5)}......`, icon: iconFor(prefix.icons, '') ? ' ' : '' })}${text}`;
  const timed = entries.filter((e) => e.time);
  const marks = [...GRID.map((time) => ({ grid: true, time, text: row(time, '-'.repeat(16)) })),
    ...(now ? [{ grid: true, time: now, text: row(now, `now${' -'.repeat(25)}`) }] : [])];
  const rows = [...timed.map((e) => ({ entry: e, time: e.time, rank: 0 })), ...marks.map((m) => ({ ...m, rank: 1 }))]
    .sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : a.rank - b.rank));
  return [...rows, ...entries.filter((e) => !e.time).map((e) => ({ entry: e }))];
};

const NO_PREFIX = { formats: DEFAULT_FORMATS, icons: [] };

/** One line of an agenda buffer: the prefix of the view's format (the default has two spaces, the category and a colon padded to 12, the time, the label), the headline, the tags at the right. */
export function entryText(e, view, prefix = NO_PREFIX) {
  const head = [e.todo, e.priority ? `[#${e.priority}]` : null, e.title].filter(Boolean).join(' ');
  const agenda = view === 'agenda';
  const left = `${formatPrefix(prefix.formats[view], {
    category: e.category, icon: iconFor(prefix.icons, e.category) ? ' ' : '', time: agenda ? e.clock : '', label: agenda ? e.label : '',
    level: e.level, effort: view === 'search' ? '' : e.effortText, crumbs: e.crumbs, tag: e.itags?.at(-1),
  })}${head}`;
  const shown = e.tags.length ? e.tags : (e.itags ?? []);
  if (!shown.length) return left;
  const tags = `:${shown.join(':')}:${e.tags.length ? '' : ':'}`;
  return left.length + tags.length + 1 > 79 ? `${left} ${tags}` : `${left}${' '.repeat(79 - left.length - tags.length)}${tags}`;
}

const crumbsOf = (h) => { const out = []; for (let x = h.parent; x; x = x.parent) out.unshift(`${x.title}->`); return out.join(''); };
const inheritedTags = (h) => { const out = []; for (let x = h; x; x = x.parent) out.unshift(...x.tags); return [...new Set(out)]; };
const base = (hd) => ({ file: hd.file, line: hd.line, category: hd.category, todo: hd.h.todo, priority: hd.h.priority, title: hd.h.title, tags: hd.h.tags, done: done(hd),
  itags: inheritedTags(hd.h), level: hd.h.level, crumbs: crumbsOf(hd.h),
  effortText: propertiesOf(hd.text, hd.line, hd.lines).find(([n]) => n.toUpperCase() === 'EFFORT')?.[1] ?? '', effort: effortMinutes(propertiesOf(hd.text, hd.line, hd.lines).find(([n]) => n.toUpperCase() === 'EFFORT')?.[1]),
  text: [hd.h.todo, hd.h.priority ? `[#${hd.h.priority}]` : null, hd.h.title].filter(Boolean).join(' ') });

const titled = (hd, title) => { const b = base(hd); return { ...b, title, text: [hd.h.todo, hd.h.priority ? `[#${hd.h.priority}]` : null, title].filter(Boolean).join(' ') }; };

/**
 * The agenda for a span of days.
 * @param {{ category: string, text: string }[]} files
 * @param {{ start: Date, span: 'day'|'week'|'fortnight'|'month'|'year'|number, today: Date, warn?: number, now?: string }} o dates are UTC dates
 */
export function agenda(files, { start, span, today, warn = 14, now = null, timeGrid = true, filter = null, diary = null, holidays = null, contacts = null, prefix = NO_PREFIX }) {
  let from = start;
  let days = typeof span === 'number' ? span : { day: 1, week: 7, fortnight: 14 }[span];
  if (span === 'month') { from = utc(start.getUTCFullYear(), start.getUTCMonth() + 1, 1); days = Math.round((utc(start.getUTCFullYear(), start.getUTCMonth() + 2, 1) - from) / DAY); }
  if (span === 'year') { from = utc(start.getUTCFullYear(), 1, 1); days = Math.round((utc(start.getUTCFullYear() + 1, 1, 1) - from) / DAY); }
  const to = addDays(from, days - 1);
  const todayIn = today >= from && today <= to;
  const byDay = new Map();
  for (let i = 0; i < days; i++) byDay.set(key(addDays(from, i)), []);
  const put = (d, e) => byDay.get(key(d))?.push(e);
  const heads = headings(files);
  for (const hd of heads) {
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
    // A timestamp in the headline shows the heading on its day, with the stamp taken out of the text.
    if (hd.h.title.includes('<')) {
      const bare = hd.h.title.replace(new RegExp(STAMP.source, 'g'), (m) => (m[0] === '<' ? '' : m));
      for (const m of hd.h.title.matchAll(STAMP)) {
        const st = parseStamp(m[0]);
        if (!st || !st.active) continue;
        for (const d of occurrences(st, from, to)) put(d, { ...titled(hd, bare), kind: 'stamp', label: '', clock: st.time ? timeLabel(st) : '', late: 0, time: st.time });
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
  // <%%(sexp)> timestamps in a headline, a body line or after SCHEDULED/DEADLINE show the heading on each day the sexp holds.
  const sexpDays = (sexp) => {
    let form;
    try { form = readForms(sexp)[0]; } catch { return []; }
    const hits = [];
    for (let i = 0; i < days; i++) {
      const d = addDays(from, i);
      let r = null;
      try { r = ev(form, [d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCFullYear()]); } catch { r = null; }
      if (r !== null && r !== false && r !== undefined && !(Array.isArray(r) && !r.length)) hits.push(d);
    }
    return hits;
  };
  const clockOf = (rest) => {
    const m = /(\d{1,2}):(\d\d)(?:-(\d{1,2}):(\d\d))?/.exec(rest);
    return m ? { time: `${two(+m[1])}:${m[2]}`, until: m[3] !== undefined ? `${two(+m[3])}:${m[4]}` : null, text: m[0] } : null;
  };
  for (const hd of heads) {
    const plan = hd.own.length && /^\s*(?:CLOSED|DEADLINE|SCHEDULED):/.test(hd.own[0]) ? hd.own[0] : '';
    const head = sexpStamps(hd.h.title);
    let shown = hd.h.title;
    for (const st of [...head].reverse()) { const c = clockOf(st.rest); if (c) shown = shown.slice(0, st.start) + shown.slice(st.start, st.end).replace(c.text, '') + shown.slice(st.end); }
    shown = shown.replace(new RegExp(STAMP.source, 'g'), (m) => (m[0] === '<' ? '' : m));
    for (const st of head) {
      const c = clockOf(st.rest);
      for (const d of sexpDays(st.sexp)) put(d, { ...titled(hd, shown), kind: 'stamp', label: '', clock: c ? timeLabel(c) : '', late: 0, time: c?.time ?? null });
    }
    for (const st of sexpStamps(plan)) {
      const kw = /(SCHEDULED|DEADLINE):\s*$/.exec(plan.slice(0, st.start))?.[1];
      if (!kw) continue;
      const c = clockOf(st.rest);
      for (const d of sexpDays(st.sexp)) put(d, { ...titled(hd, hd.h.title), kind: kw === 'SCHEDULED' ? 'scheduled' : 'deadline', label: kw === 'SCHEDULED' ? 'Scheduled:' : 'Deadline:', clock: c ? timeLabel({ ...c, until: kw === 'DEADLINE' ? null : c.until }) : '', late: 0, time: c?.time ?? null });
    }
    for (const text of hd.own.slice(plan ? 1 : 0)) {
      if (/^\s*:[A-Za-z_]+:/.test(text)) continue;
      for (const st of sexpStamps(text)) {
        const c = clockOf(st.rest);
        for (const d of sexpDays(st.sexp)) put(d, { ...titled(hd, hd.h.title), kind: 'stamp', label: '', clock: c ? timeLabel(c) : '', late: 0, time: c?.time ?? null });
      }
    }
  }
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
      || prioOf(b) - prioOf(a) || (b.sortLate ?? b.late) - (a.sortLate ?? a.late) || (KIND_RANK[a.kind] ?? 3) - (KIND_RANK[b.kind] ?? 3) || a.order - b.order);
    const head = `${DAYS[d.getUTCDay()].padEnd(10)} ${String(d.getUTCDate()).padStart(2)} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}${d.getUTCDay() === 1 ? ` W${two(weekOf(d))}` : ''}`;
    // The time grid shows on every day of a day agenda, and on today only in longer ones, and only for a day that has an entry with a time.
    const isToday = key(d) === key(today);
    const rows = timeGrid && (days === 1 || isToday) && entries.some((e) => e.time) ? gridLines(entries, isToday ? now : null, prefix) : entries.map((entry) => ({ entry }));
    lines.push(head, ...rows.map((r) => (r.entry ? entryText(r.entry, 'agenda', prefix) : r.text)));
    outDays.push({ date: d, head, today: isToday, entries, rows });
  }
  return { title: lines[0], days: outDays, text: `${lines.join('\n')}\n` };
}

const sortByPriority = (list) => list.map((e, i) => ({ e, i })).sort((a, b) => prioOf(b.e) - prioOf(a.e) || a.i - b.i).map((x) => x.e);

/** The global list of TODO items: every open state, or only `keyword`. */
export function todoList(files, { keyword = null, filter = null, prefix = NO_PREFIX } = {}) {
  const words = [...new Set(files.flatMap((f) => { const a = analyze(f.text); return [...a.todo.open, ...a.todo.done]; }))].sort();
  const entries = sortByPriority(headings(files).filter((hd) => hd.h.todo && (keyword ? hd.h.todo === keyword : !done(hd))).map((hd) => base(hd)).filter((e) => keeps(e, filter)));
  const head = [`Global list of TODO items of type: ${keyword ?? 'ALL'}`, `Press ‘N r’ (e.g. ‘0 r’) to search again: (0)[ALL] ${words.map((w, i) => `(${i + 1})${w}`).join(' ')}`];
  return { title: head[0], entries, text: `${[...head, ...entries.map((e) => entryText(e, 'todo', prefix))].join('\n')}\n` };
}

/** The headings whose tags (inherited from above), TODO state, level or properties fit a match such as work+urgent/TODO. */
export function tagsView(files, { match, todoOnly = false, filter = null, prefix = NO_PREFIX }) {
  const entries = [];
  for (const hd of headings(files)) {
    if (todoOnly && (!hd.h.todo || done(hd))) continue;
    if (matcher(match, hd.a)(hd.h, files[hd.file].text)) { const e = base(hd); if (keeps(e, filter)) entries.push(e); }
  }
  const head = [`Headlines with TAGS match: ${match}`, 'Press ‘C-u r’ to search again'];
  return { title: head[0], entries, text: `${[...head, ...entries.map((e) => entryText(e, 'tags', prefix))].join('\n')}\n` };
}

/** The headings whose own text has every word (case ignored). */
export function searchView(files, { words, filter = null, prefix = NO_PREFIX }) {
  const wanted = words.toLowerCase().split(/\s+/).filter(Boolean);
  const entries = [];
  for (const hd of headings(files)) {
    const text = [`${'*'.repeat(hd.h.level)} ${hd.h.todo ?? ''} ${hd.h.title}`, ...hd.own].join('\n').toLowerCase();
    if (wanted.length && wanted.every((w) => text.includes(w))) { const e = base(hd); if (keeps(e, filter)) entries.push(e); }
  }
  const head = [`Search words: ${words}`, 'Press ‘[’, ‘]’ to add/sub word, ‘{’, ‘}’ to add/sub regexp, ‘C-u r’ for a fresh search'];
  return { title: head[0], entries, text: `${[...head, ...entries.map((e) => entryText(e, 'search', prefix))].join('\n')}\n` };
}
