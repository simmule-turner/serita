// Holidays for the calendar: the general (U.S.) and Christian lists of Emacs's calendar-holidays, and the local forms holiday-fixed,
// holiday-float and holiday-sexp. Written from the lists Emacs 30.1 showed (conformance v0.1.26) and the published Gauss/Meeus rule for Easter.
import { readForms, isSym } from './lisp-read.js';
import { ev } from './diary.js';
import { season } from './solar.js';

const dow = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** The nth (1-based) or, when n is negative, the nth from last `wd` (0 = Sunday) of a month; from `from` on when given. Null when there is none. */
export function floatDay(y, m, wd, n, from) {
  let d;
  if (n > 0) { const s = from ?? 1; d = s + ((wd - dow(y, m, s) + 7) % 7) + (n - 1) * 7; }
  else { const last = from ?? daysIn(y, m); d = last - ((dow(y, m, last) - wd + 7) % 7) + (n + 1) * 7; }
  return d >= 1 && d <= daysIn(y, m) ? d : null;
}

/** [month, day] of Gregorian Easter Sunday. */
export function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return [month, day];
}

const GENERAL = (y) => [
  [1, 1, "New Year's Day"], [1, floatDay(y, 1, 1, 3), 'Martin Luther King Day'], [2, 2, 'Groundhog Day'], [2, 14, "Valentine's Day"],
  [2, floatDay(y, 2, 1, 3), "President's Day"], [3, 17, "St. Patrick's Day"], [4, 1, "April Fools' Day"], [5, floatDay(y, 5, 0, 2), "Mother's Day"],
  [5, floatDay(y, 5, 1, -1), 'Memorial Day'], [6, 14, 'Flag Day'], [6, floatDay(y, 6, 0, 3), "Father's Day"], [7, 4, 'Independence Day'],
  [9, floatDay(y, 9, 1, 1), 'Labor Day'], [10, floatDay(y, 10, 1, 2), 'Columbus Day'], [10, 31, 'Halloween'], [11, 11, "Veteran's Day"], [11, floatDay(y, 11, 4, 4), 'Thanksgiving'],
];

const CHRISTIAN = (y) => {
  const [em, ed] = easter(y);
  const at = (back) => { const t = new Date(Date.UTC(y, em - 1, ed - back)); return [t.getUTCMonth() + 1, t.getUTCDate()]; };
  return [[...at(46), 'Ash Wednesday'], [...at(2), 'Good Friday'], [em, ed, 'Easter Sunday'], [12, 25, 'Christmas']];
};

/** The holidays of the year from holiday-local-holidays text: holiday-fixed, holiday-float and holiday-sexp forms. */
function local(y, text) {
  const out = [];
  let forms = [];
  try { forms = readForms(text ?? ''); } catch { return out; }
  const top = forms.length === 1 && Array.isArray(forms[0]) && !isSym(forms[0][0]) ? forms[0] : forms; // a quoted list may be given whole
  for (const f of top) {
    const form = f && typeof f === 'object' && 'quote' in f ? f.quote : f;
    if (!Array.isArray(form)) continue;
    const list = Array.isArray(form[0]) ? form : [form];
    for (const g of list) {
      if (!Array.isArray(g) || !g[0]?.sym) continue;
      const [name, ...a] = g;
      if (name.sym === 'holiday-fixed') out.push([a[0], a[1], a[2]]);
      else if (name.sym === 'holiday-float') { const d = floatDay(y, a[0], a[1], a[2], typeof a[4] === 'number' ? a[4] : undefined); if (d) out.push([a[0], d, a[3]]); }
      else if (name.sym === 'holiday-sexp') { const q = a[0] && typeof a[0] === 'object' && 'quote' in a[0] ? a[0].quote : a[0]; const r = ev(q, [1, 1, y]); if (Array.isArray(r) && r.length === 3 && r[2] === y) out.push([r[0], r[1], typeof a[1] === 'string' ? a[1] : String(ev(a[1], [1, 1, y]))]); }
    }
  }
  return out;
}

// The zone's short name: en-US names only the U.S. zones, so other English locales are tried before falling back to GMT+n.
const formats = new Map();
/** A formatter for the locale, zone and kind of zone name, made once: building one costs far more than using it. */
const formatter = (loc, zone, name) => {
  const k = `${loc}|${zone}|${name}`;
  if (!formats.has(k)) formats.set(k, new Intl.DateTimeFormat(loc, { timeZone: zone, timeZoneName: name, hour: 'numeric' }));
  return formats.get(k);
};
const abbrOf = (date, zone) => {
  let v = '';
  for (const loc of ['en-US', 'en-GB', 'en-AU', 'en-IN', 'en-NZ']) {
    v = formatter(loc, zone, 'short').formatToParts(date).find((x) => x.type === 'timeZoneName').value;
    if (!/^GMT[+-]/.test(v)) return v;
  }
  return v;
};
const zoneParts = (date, zone) => {
  const off = /GMT([+-])(\d\d):(\d\d)/.exec(formatter('en-US', zone, 'longOffset').formatToParts(date).find((x) => x.type === 'timeZoneName').value);
  return { offset: off ? (off[1] === '-' ? -1 : 1) * (Number(off[2]) * 60 + Number(off[3])) : 0, abbr: abbrOf(date, zone) };
};
const clock12 = (h, m) => `${h % 12 || 12}:${String(m).padStart(2, '0')}${h < 12 ? 'am' : 'pm'}`;

/** The daylight saving changes of the year in the zone, from the zone's own rules: when the clock goes forward (Begins) and back (Ends), as local time before the change. */
function daylight(y, zone) {
  const out = [];
  const HOUR = 3600000;
  let prev = zoneParts(new Date(Date.UTC(y, 0, 1)), zone);
  for (let t = Date.UTC(y, 0, 1); t < Date.UTC(y + 1, 0, 1); t += 24 * HOUR) {
    const next = zoneParts(new Date(t + 24 * HOUR), zone);
    if (next.offset !== prev.offset && t + 24 * HOUR < Date.UTC(y + 1, 0, 1)) {
      let h = t; // the first hour whose offset is the new one
      while (zoneParts(new Date(h), zone).offset === prev.offset) h += HOUR;
      const local = new Date(h + prev.offset * 60000);
      out.push([local.getUTCMonth() + 1, local.getUTCDate(), `Daylight Saving Time ${next.offset > prev.offset ? 'Begins' : 'Ends'} ${clock12(local.getUTCHours(), local.getUTCMinutes())} (${prev.abbr})`]);
    }
    prev = next;
  }
  return out;
}

/** The solstices and equinoxes in the zone, with the local time. `clock` is the 24-hour time for the agenda. */
function solar(y, zone) {
  const out = daylight(y, zone);
  ['Vernal Equinox', 'Summer Solstice', 'Autumnal Equinox', 'Winter Solstice'].forEach((name, w) => {
    const at = season(y, w), z = zoneParts(at, zone), loc = new Date(at.getTime() + z.offset * 60000);
    const h = loc.getUTCHours(), mi = loc.getUTCMinutes();
    out.push([loc.getUTCMonth() + 1, loc.getUTCDate(), `${name} ${clock12(h, mi)} (${z.abbr})`, { time: `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`, said: `${name} (${z.abbr})` }]);
  });
  return out;
}

/** What holidays to use: `which` lists 'general', 'christian' and 'solar'; `zone` is the time zone for the solar times; `localText` is the text of holiday-local-holidays. */
const computed = new Map();
export function holidaysOf(y, { which = ['general', 'christian', 'solar'], localText = '', zone = Intl.DateTimeFormat().resolvedOptions().timeZone } = {}) {
  const key = `${y}|${which.join()}|${zone}|${localText}`;
  if (!computed.has(key)) {
    if (computed.size > 60) computed.clear();
    computed.set(key, holidaysFor(y, which, localText, zone));
  }
  return computed.get(key);
}

function holidaysFor(y, which, localText, zone) {
  const all = [];
  if (which.includes('general')) all.push(...GENERAL(y));
  if (which.includes('christian')) all.push(...CHRISTIAN(y));
  if (which.includes('solar')) all.push(...solar(y, zone));
  if (which.length) all.push(...local(y, localText));
  return all.filter((h) => h[1]).map(([m, d, name, extra]) => ({ y, m, d, name, ...extra }));
}

/** The holidays Emacs lists for a displayed month: that month and the one before and after, in date order. */
export function holidayList(y, m, opts) {
  const years = [y - 1, y, y + 1];
  const lo = y * 12 + m - 2, hi = y * 12 + m;
  return years.flatMap((yy) => holidaysOf(yy, opts)).filter((h) => { const k = h.y * 12 + h.m - 1; return k >= lo && k <= hi; })
    .sort((a, b) => a.y - b.y || a.m - b.m || a.d - b.d);
}
