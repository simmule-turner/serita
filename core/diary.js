// The diary file: entries that start with a date or a %%(sexp), and the ones that fall on a day. Written from the behavior Emacs 30.1 showed
// (conformance v0.1.25): which forms match, what the text is, the order within a day, and the calendar sexps.
import { readForms, isSym } from './lisp-read.js';
import { sunriseSunset, sunTimes, timeString, localZone, where } from './solar.js';

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHNAME = `(?:${MONTHS.map((m) => `${m}|${m.slice(0, 3)}`).join('|')})`;
const DAYNAME = `(?:${DAYS.map((d) => `${d}|${d.slice(0, 3)}`).join('|')})`;
const NUM = (n) => `(\\*|\\d{1,${n}})`;
const monthOf = (s) => (s === '*' ? '*' : /^\d/.test(s) ? Number(s) : MONTHS.findIndex((m) => m.startsWith(s.toLowerCase().replace(/\.$/, '').slice(0, 3))) + 1);
const yearOf = (s) => (s === '*' ? '*' : s.length <= 2 ? 2000 + Number(s) : Number(s));
const dayNo = (s) => (s === '*' ? '*' : Number(s));
const dowOf = (s) => DAYS.findIndex((d) => d.startsWith(s.toLowerCase().slice(0, 3)));

// The date forms of diary-american-date-forms, diary-european-date-forms and diary-iso-date-forms: [regexp, which fields the groups are].
const FORMS = {
  american: [
    [new RegExp(`^${NUM(2)}/${NUM(2)}(?=[^/\\d]|$)`), ['m', 'd']],
    [new RegExp(`^${NUM(2)}/${NUM(2)}/(\\*|\\d{4}|\\d{2})(?=\\D|$)`), ['m', 'd', 'y']],
    [new RegExp(`^(\\*|${MONTHNAME})\\.? *${NUM(2)}(?=[^,\\d]|$)`, 'i'), ['M', 'd']],
    [new RegExp(`^(\\*|${MONTHNAME})\\.? *${NUM(2)}, *(\\*|\\d{4}|\\d{2})(?=\\D|$)`, 'i'), ['M', 'd', 'y']],
    [new RegExp(`^(${DAYNAME})\\.?(?=\\W|$)`, 'i'), ['w']],
  ],
  european: [
    [new RegExp(`^${NUM(2)}/${NUM(2)}(?=[^/\\d]|$)`), ['d', 'm']],
    [new RegExp(`^${NUM(2)}/${NUM(2)}/(\\*|\\d{4}|\\d{2})(?=\\D|$)`), ['d', 'm', 'y']],
    [new RegExp(`^${NUM(2)} *(\\*|${MONTHNAME})\\.?(?=\\W+[^\\d]|\\W*$)`, 'i'), ['d', 'M']],
    [new RegExp(`^${NUM(2)} *(\\*|${MONTHNAME})\\.? *(\\*|\\d{4}|\\d{2})(?=\\D|$)`, 'i'), ['d', 'M', 'y']],
    [new RegExp(`^(${DAYNAME})\\.?(?=\\W|$)`, 'i'), ['w']],
  ],
  iso: [
    [new RegExp(`^(\\*|\\d{4}|\\d{2})-${NUM(2)}-${NUM(2)}(?=\\D|$)`), ['y', 'm', 'd']],
    [new RegExp(`^(\\*|\\d{4}|\\d{2})/${NUM(2)}/${NUM(2)}(?=\\D|$)`), ['y', 'm', 'd']],
    [new RegExp(`^(${DAYNAME})\\.?(?=\\W|$)`, 'i'), ['w']],
  ],
};

const absDay = (y, m, d) => Date.UTC(y, m - 1, d) / 86400000;
const fromAbs = (n) => { const x = new Date(n * 86400000); return { y: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate() }; };
const dowOfDate = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** The entries of a diary file, in file order: { line, sexp: string|null, form: number, test(date)|null, text }. */
export function parseDiary(text, style = 'american') {
  const forms = FORMS[style] ?? FORMS.american;
  const lines = text.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw === '' || /^\s/.test(raw)) continue;
    let tail = '';
    let last = i;
    for (let j = i + 1; j < lines.length && /^[ \t]/.test(lines[j]); j++) { tail += `\n${lines[j]}`; last = j; }
    const quiet = raw.startsWith('&');
    const line = raw.replace(/^&/, '');
    if (line.startsWith('%%(')) {
      // The sexp may run over the indented lines that follow; what comes after its closing parenthesis is the entry's text.
      const src = `${line}${tail}`;
      let depth = 0; let end = -1; let str = false;
      for (let k = 2; k < src.length; k++) {
        const c = src[k];
        if (str) { if (c === '\\') k++; else if (c === '"') str = false; continue; }
        if (c === '"') str = true; else if (c === '(') depth++; else if (c === ')' && --depth === 0) { end = k; break; }
      }
      if (end < 0) continue;
      const after = src.slice(end + 1);
      out.push({ line: i, quiet, sexp: src.slice(2, end + 1), form: -1, text: after.replace(/^[ \t]+/, '') });
      i = last;
      continue;
    }
    forms.forEach(([re, fields], form) => {
      const m = re.exec(line);
      if (!m) return;
      const spec = {};
      fields.forEach((f, k) => { spec[f] = m[k + 1]; });
      const mm = 'M' in spec ? monthOf(spec.M) : 'm' in spec ? monthOf(spec.m) : '*';
      const dd = 'd' in spec ? dayNo(spec.d) : '*';
      const yy = 'y' in spec ? yearOf(spec.y) : '*';
      const ww = 'w' in spec ? dowOf(spec.w) : null;
      const test = ({ y, m: mo, d }) => (ww !== null ? dowOfDate(y, mo, d) === ww : (mm === '*' || mm === mo) && (dd === '*' || dd === d) && (yy === '*' || yy === y));
      out.push({ line: i, quiet, sexp: null, form, test, text: line.slice(m[0].length + 1).replace(/^[ \t]+/, '') + tail });
    });
  }
  return out;
}

/** Extra sexp functions, set by the caller for the calls it makes: name to (args, date) => result. */
export const hooks = {};

/** The clock calendar-current-date reads; tests replace `date`. */
export const now = { date: () => new Date() };

const princ = (v) => (v === null || v === false || v === undefined ? 'nil' : v === true ? 't' : Array.isArray(v) ? `(${v.map(princ).join(' ')})` : isSym(v) ? v.sym : String(v));

/** format: %s, %d and %f with flags, width and precision, and %%; any other directive is an error, as in Emacs. */
function formatString(fmt, vals) {
  let i = 0;
  return fmt.replace(/%([-0 +#]*)(\d+)?(?:\.(\d+))?(.?)/g, (_, flags, width, prec, c) => {
    if (c === '%') return '%';
    if (!'sdf'.includes(c) || c === '') throw new Error('Invalid format operation');
    if (i >= vals.length) throw new Error('Not enough arguments for format string');
    const v = vals[i++];
    let out;
    if (c === 's') out = prec === undefined ? princ(v) : princ(v).slice(0, Number(prec));
    else if (typeof v !== 'number') throw new Error('Format specifier doesn’t match argument type');
    else out = c === 'd' ? String(Math.trunc(v)) : v.toFixed(prec === undefined ? 6 : Number(prec));
    if (c !== 's' && flags.includes('+') && v >= 0) out = `+${out}`;
    const w = Number(width ?? 0);
    if (out.length >= w) return out;
    return flags.includes('-') ? out.padEnd(w) : flags.includes('0') && c !== 's' ? out.padStart(w, '0') : out.padStart(w);
  });
}

/** The form inside 'x or (quote x). */
const unquote = (f) => (f && typeof f === 'object' && 'quote' in f ? f.quote : Array.isArray(f) && isSym(f[0], 'quote') ? f[1] : f);

const truthy = (v) => v !== null && v !== false && v !== undefined && !(Array.isArray(v) && v.length === 0);

/** Evaluates the calendar sexps a diary entry may use. `date` is [month, day, year]. Returns null/false, true, a number or a string. */
export function ev(form, date, env = new Map()) {
  if (isSym(form) && env.has(form.sym)) return env.get(form.sym);
  if (form === null || form === true || typeof form === 'number' || typeof form === 'string') return form;
  if (isSym(form, 't')) return true;
  if (isSym(form, 'nil')) return null;
  if (isSym(form, 'date')) return date;
  if (isSym(form, 'year')) return date[2];
  if (isSym(form, 'month')) return date[0];
  if (isSym(form, 'day')) return date[1];
  if (form && typeof form === 'object' && 'quote' in form) return form.quote;
  if (!Array.isArray(form) || !form.length) return null;
  const name = form[0].sym;
  const args = form.slice(1);
  const val = (i) => ev(args[i], date, env);
  const progn = (forms, scope = env) => { let r = null; for (const f of forms) r = ev(f, date, scope); return r; };
  const [mo, d, y] = date;
  const wild = (a, v) => a === true || a === null && false || (Array.isArray(a) ? a.includes(v) : a === v);
  switch (name) {
    case 'and': { let r = true; for (const a of args) { r = ev(a, date, env); if (!truthy(r)) return null; } return r; }
    case 'or': { for (const a of args) { const r = ev(a, date, env); if (truthy(r)) return r; } return null; }
    case 'list': return args.map((_, i) => val(i));
    case 'not': return truthy(val(0)) ? null : true;
    case 'if': return truthy(val(0)) ? val(1) : args.length > 2 ? progn(args.slice(2)) : null;
    case '=': return val(0) === val(1) ? true : null;
    case '<': return val(0) < val(1) ? true : null;
    case '>': return val(0) > val(1) ? true : null;
    case '<=': return val(0) <= val(1) ? true : null;
    case '>=': return val(0) >= val(1) ? true : null;
    case '+': return args.reduce((s, _, i) => s + val(i), 0);
    case '-': return args.length === 1 ? -val(0) : args.slice(1).reduce((s, _, i) => s - val(i + 1), val(0));
    case 'mod': return ((val(0) % val(1)) + val(1)) % val(1);
    case 'calendar-extract-month': return val(0)[0];
    case 'calendar-extract-day': return val(0)[1];
    case 'calendar-extract-year': return val(0)[2];
    case 'calendar-day-of-week': { const [m, dd, yy] = val(0); return dowOfDate(yy, m, dd); }
    case 'diary-date': return wild(val(0), mo) && wild(val(1), d) && wild(val(2), y) ? true : null;
    case 'diary-block': { const t = absDay(y, mo, d); return t >= absDay(val(2), val(0), val(1)) && t <= absDay(val(5), val(3), val(4)) ? true : null; }
    case 'diary-cyclic': { const n = val(0); const diff = absDay(y, mo, d) - absDay(val(3), val(1), val(2)); return diff >= 0 && diff % n === 0 ? true : null; }
    case 'diary-anniversary': {
      if (val(0) !== mo || val(1) !== d) return null;
      const years = y - val(2);
      return years < 0 ? null : { anniversary: years };
    }
    case 'diary-float': {
      const m = val(0); const dow = val(1); const n = val(2);
      if (m !== true && !wild(m, mo)) return null;
      if (dowOfDate(y, mo, d) !== dow) return null;
      if (args.length > 3) { // counted from a given day of the month
        const from = val(3); const start = new Date(Date.UTC(y, mo - 1, from));
        const first = from + ((dow - start.getUTCDay() + 7) % 7);
        const k = n > 0 ? first + (n - 1) * 7 : null;
        return k === d ? true : null;
      }
      const nth = Math.floor((d - 1) / 7) + 1; const fromEnd = -Math.floor((lastDay(y, mo) - d) / 7) - 1;
      return (n > 0 ? nth === n : fromEnd === n) ? true : null;
    }
    case 'diary-day-of-year': {
      const day = absDay(y, mo, d) - absDay(y, 1, 1) + 1; const total = absDay(y + 1, 1, 1) - absDay(y, 1, 1);
      return `Day ${day} of ${y}; ${total - day} days remaining in the year`;
    }
    case 'when': return truthy(val(0)) ? progn(args.slice(1)) : null;
    case 'let': case 'let*': {
      const scope = new Map(env);
      for (const b of Array.isArray(args[0]) ? args[0] : []) {
        const [v, init] = Array.isArray(b) ? b : [b];
        scope.set(v.sym, init === undefined ? null : ev(init, date, name === 'let*' ? scope : env));
      }
      return progn(args.slice(1), scope);
    }
    case 'cons': return [val(0), val(1)];
    case 'equal': return JSON.stringify(val(0)) === JSON.stringify(val(1)) ? true : null;
    case 'car': return val(0)?.[0] ?? null;
    case 'cdr': { const l = val(0); return Array.isArray(l) && l.length > 1 ? l.slice(1) : null; }
    case 'cadr': return val(0)?.[1] ?? null;
    case 'nth': return val(1)?.[val(0)] ?? null;
    case 'apply': { // (apply 'f a b '(c d)): the last argument is a list of more arguments
      const f = val(0); const vals = args.slice(1).map((_, i) => val(i + 1)); const last = vals.pop();
      return ev([f, ...[...vals, ...(last ?? [])].map((v) => ({ quote: v }))], date, env);
    }
    case 'format': return formatString(val(0), args.slice(1).map((_, i) => val(i + 1)));
    case 'calendar-current-date': { const t = now.date(); return [t.getMonth() + 1, t.getDate(), t.getFullYear()]; }
    case 'solar-sunrise-sunset': { const [m, dd, yy] = val(0); return where.lat === null || where.lon === null ? null : sunTimes({ y: yy, m, d: dd }, { lat: where.lat, lon: where.lon, zone: localZone }); }
    case 'solar-sunrise-sunset-string': { const [m, dd, yy] = val(0); return where.lat === null || where.lon === null ? null : sunriseSunset({ y: yy, m, d: dd }, { lat: where.lat, lon: where.lon, zone: localZone, place: where.name }); }
    case 'solar-time-string': return timeString(val(0), val(1));
    case 'diary-sunrise-sunset': return where.lat === null || where.lon === null ? null : sunriseSunset({ y, m: mo, d }, { lat: where.lat, lon: where.lon, zone: localZone, place: where.name });
    case 'diary-remind': {
      const inner = unquote(args[0]); const days = val(1);
      const list = [...(Array.isArray(days) ? days : [days]), 0]; // the day itself always shows
      const target = absDay(y, mo, d);
      for (const n of list) {
        const there = fromAbs(target + n);
        const r = ev(inner, [there.m, there.d, there.y], env);
        if (truthy(r)) return { remind: n, inner: r };
      }
      return null;
    }
    default:
      if (hooks[name]) return hooks[name](args.map((_, i) => val(i)), date);
      throw new Error(`Unsupported diary expression ${name}`);
  }
}

/** The "%d" and "%s" of an anniversary's text: the years and a plural s. Any other % escape is an error, as in Emacs (the entry is not shown). */
function anniversaryText(text, years) {
  if (/%[^ds%]/.test(text)) throw new Error('Invalid format operation');
  return text.replace(/%d/g, String(years)).replace(/%s/g, years === 1 ? '' : 's');
}

/**
 * The agenda lines of one diary entry's text, as Org makes them. When the entry's first line is blank (a date alone with its events indented
 * beneath it) every indented line is an entry of its own; otherwise the lines are joined with "; ". A time in the text (10:00am, 14:30, 2pm-3:30pm)
 * becomes the line's time and leaves the text.
 * @returns {{ text: string, time: string|null, until: string|null }[]}
 */
export function agendaLines(text) {
  const lines = text.split('\n').map((l) => l.trim());
  const parts = lines[0] === '' ? lines.filter(Boolean) : [lines.filter(Boolean).join('; ')];
  return parts.map(timeOf);
}

const hm = (h, m, ap) => { let hh = Number(h); if (ap === 'pm' && hh < 12) hh += 12; if (ap === 'am' && hh === 12) hh = 0; return `${String(hh).padStart(2, '0')}:${m ?? '00'}`; };
function timeOf(text) {
  let m = /\b(\d{1,2})(?::(\d\d))?\s*(am|pm)?\s*-\s*(\d{1,2})(?::(\d\d))?\s*(am|pm)\b/i.exec(text);
  if (m && (m[2] || m[3] || m[1])) return { text: tidy(text, m), time: hm(m[1], m[2], (m[3] ?? m[6]).toLowerCase()), until: hm(m[4], m[5], m[6].toLowerCase()) };
  m = /\b(\d{1,2}):(\d\d)\s*(am|pm)?\b/i.exec(text) ?? /\b(\d{1,2})()\s*(am|pm)\b/i.exec(text);
  if (m) return { text: tidy(text, m), time: hm(m[1], m[2] || '00', m[3]?.toLowerCase()), until: null };
  return { text, time: null, until: null };
}
const tidy = (text, m) => `${text.slice(0, m.index)}${text.slice(m.index + m[0].length)}`.replace(/\s+/g, ' ').trim();

/**
 * The entries that fall on the `days` days from `start` ({ y, m, d }). On a day the sexps come first, then the date entries in the order of the
 * forms and then the file; text is what the entry says.
 * @returns {{ y: number, m: number, d: number, text: string, line: number }[]}
 */
export function diaryEntries(text, start, days, { style = 'american', sexpOnly = false } = {}) {
  const entries = parseDiary(text, style).filter((e) => !sexpOnly || e.sexp !== null);
  const out = [];
  const t0 = absDay(start.y, start.m, start.d);
  for (let i = 0; i < days; i++) {
    const dt = fromAbs(t0 + i);
    const date = [dt.m, dt.d, dt.y];
    const here = [];
    for (const e of entries.filter((x) => x.sexp !== null)) {
      try {
        const r = ev(readForms(e.sexp)[0], date);
        if (!truthy(r)) continue;
        if (r && typeof r === 'object' && Array.isArray(r.lines)) { for (const l of r.lines) here.push({ ...dt, text: l, line: e.line, quiet: e.quiet }); continue; }
        let said = e.text;
        if (typeof r === 'string') said = r;
        else if (r && typeof r === 'object' && 'anniversary' in r) said = anniversaryText(e.text, r.anniversary);
        else if (r && typeof r === 'object' && 'remind' in r) {
          const inner = r.inner && typeof r.inner === 'object' && 'anniversary' in r.inner ? anniversaryText(e.text, r.inner.anniversary) : e.text;
          said = r.remind === 0 ? inner : `Reminder: Only ${r.remind} days until ${inner}`;
        }
        here.push({ ...dt, text: said, line: e.line, quiet: e.quiet });

      } catch { continue; }
    }
    const forms = entries.filter((x) => x.sexp === null && x.test(dt)).sort((a, b) => a.form - b.form || a.line - b.line);
    for (const e of forms) here.push({ ...dt, text: e.text, line: e.line, quiet: e.quiet });
    out.push(...here);
  }
  return out;
}
