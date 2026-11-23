// The diary file: entries that start with a date or a %%(sexp), and the ones that fall on a day. Written from the behavior Emacs 30.1 showed
// (conformance v0.1.25): which forms match, what the text is, the order within a day, and the calendar sexps.
import { readForms, isSym } from './lisp-read.js';

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
    for (let j = i + 1; j < lines.length && /^[ \t]/.test(lines[j]); j++) tail += `\n${lines[j]}`;
    const line = raw.replace(/^&/, '');
    if (line.startsWith('%%(')) {
      let depth = 0; let end = -1; let str = false;
      for (let k = 2; k < line.length; k++) {
        const c = line[k];
        if (str) { if (c === '\\') k++; else if (c === '"') str = false; continue; }
        if (c === '"') str = true; else if (c === '(') depth++; else if (c === ')' && --depth === 0) { end = k; break; }
      }
      if (end < 0) continue;
      out.push({ line: i, sexp: line.slice(2, end + 1), form: -1, text: line.slice(end + 1).replace(/^\s+/, '') + tail });
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
      out.push({ line: i, sexp: null, form, test, text: line.slice(m[0].length + 1).replace(/^\s+/, '') + tail });
    });
  }
  return out;
}

/** Extra sexp functions, set by the caller for the calls it makes: name to (args, date) => result. */
export const hooks = {};

/** The form inside 'x or (quote x). */
const unquote = (f) => (f && typeof f === 'object' && 'quote' in f ? f.quote : Array.isArray(f) && isSym(f[0], 'quote') ? f[1] : f);

const truthy = (v) => v !== null && v !== false && v !== undefined && !(Array.isArray(v) && v.length === 0);

/** Evaluates the calendar sexps a diary entry may use. `date` is [month, day, year]. Returns null/false, true, a number or a string. */
export function ev(form, date) {
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
  const val = (i) => ev(args[i], date);
  const [mo, d, y] = date;
  const wild = (a, v) => a === true || a === null && false || (Array.isArray(a) ? a.includes(v) : a === v);
  switch (name) {
    case 'and': { let r = true; for (const a of args) { r = ev(a, date); if (!truthy(r)) return null; } return r; }
    case 'or': { for (const a of args) { const r = ev(a, date); if (truthy(r)) return r; } return null; }
    case 'list': return args.map((_, i) => val(i));
    case 'not': return truthy(val(0)) ? null : true;
    case 'if': return truthy(val(0)) ? val(1) : args.length > 2 ? ev(args[2], date) : null;
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
    case 'diary-remind': {
      const inner = unquote(args[0]); const days = val(1);
      const list = [...(Array.isArray(days) ? days : [days]), 0]; // the day itself always shows
      const target = absDay(y, mo, d);
      for (const n of list) {
        const there = fromAbs(target + n);
        const r = ev(inner, [there.m, there.d, there.y]);
        if (truthy(r)) return { remind: n, inner: r };
      }
      return null;
    }
    default:
      if (hooks[name]) return hooks[name](args.map((_, i) => val(i)), date);
      throw new Error(`Unsupported diary expression ${name}`);
  }
}

/** The "%d", "%s" and "%t" of an anniversary's text: the years, a plural s, and an ordinal ending. */
function anniversaryText(text, years) {
  const ord = years % 100 >= 11 && years % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[years % 10] ?? 'th');
  return text.replace(/%d/g, String(years)).replace(/%s/g, years === 1 ? '' : 's').replace(/%t/g, ord);
}

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
      let r;
      try { r = ev(readForms(e.sexp)[0], date); } catch { continue; }
      if (!truthy(r)) continue;
      if (r && typeof r === 'object' && Array.isArray(r.lines)) { for (const l of r.lines) here.push({ ...dt, text: l, line: e.line }); continue; }
      let said = e.text;
      if (typeof r === 'string') said = r;
      else if (r && typeof r === 'object' && 'anniversary' in r) said = anniversaryText(e.text, r.anniversary);
      else if (r && typeof r === 'object' && 'remind' in r) {
        const inner = r.inner && typeof r.inner === 'object' && 'anniversary' in r.inner ? anniversaryText(e.text, r.inner.anniversary) : e.text;
        said = r.remind === 0 ? inner : `Reminder: Only ${r.remind} days until ${inner}`;
      }
      here.push({ ...dt, text: said, line: e.line });
    }
    const forms = entries.filter((x) => x.sexp === null && x.test(dt)).sort((a, b) => a.form - b.form || a.line - b.line);
    for (const e of forms) here.push({ ...dt, text: e.text, line: e.line });
    out.push(...here);
  }
  return out;
}
