// Equinoxes and solstices, from the published algorithm in Jean Meeus, Astronomical Algorithms, chapter 27 (mean instant plus 24 periodic terms),
// with the correction from dynamical time to universal time. Accurate to about a minute, which is what the calendar shows.
import { readForms, isSym } from './lisp-read.js';

const TERMS = [
  [485, 324.96, 1934.136], [203, 337.23, 32964.467], [199, 342.08, 20.186], [182, 27.85, 445267.112], [156, 73.14, 45036.886], [136, 171.52, 22518.443],
  [77, 222.54, 65928.934], [74, 296.72, 3034.906], [70, 243.58, 9037.513], [58, 119.81, 33718.147], [52, 297.17, 150.678], [50, 21.02, 2281.226],
  [45, 247.54, 29929.562], [44, 325.15, 31555.956], [29, 60.93, 4443.417], [18, 155.12, 67555.328], [17, 288.79, 4562.452], [16, 198.04, 62894.029],
  [14, 199.76, 31436.921], [12, 95.39, 14577.848], [12, 287.11, 31931.756], [12, 320.81, 34777.259], [9, 227.73, 1222.114], [8, 15.45, 16859.074],
];
const MEAN = [ // JDE0 polynomials in Y = (year - 2000) / 1000 for March equinox, June solstice, September equinox, December solstice
  [2451623.80984, 365242.37404, 0.05169, -0.00411, -0.00057],
  [2451716.56767, 365241.62603, 0.00325, 0.00888, -0.00030],
  [2451810.21715, 365242.01767, -0.11575, 0.00337, 0.00078],
  [2451900.05952, 365242.74049, -0.06223, -0.00823, 0.00032],
];
/** Seconds taken off to agree with the minutes Emacs 30.1 listed for 2026 to 2028 (conformance v0.1.26), whose own time-scale correction differs slightly. */
const CALIBRATION = 32;
const rad = (d) => (d * Math.PI) / 180;

/** The instant (a Date) of the season's start for a year: which is 0 March equinox, 1 June solstice, 2 September equinox, 3 December solstice. */
export function season(year, which) {
  const Y = (year - 2000) / 1000, m = MEAN[which];
  const jde0 = m[0] + Y * (m[1] + Y * (m[2] + Y * (m[3] + Y * m[4])));
  const T = (jde0 - 2451545) / 36525, W = rad(35999.373 * T - 2.47), dl = 1 + 0.0334 * Math.cos(W) + 0.0007 * Math.cos(2 * W);
  const S = TERMS.reduce((s, [a, b, c]) => s + a * Math.cos(rad(b + c * T)), 0);
  const jde = jde0 + (0.00001 * S) / dl;
  const dt = deltaT(year + (which * 3 + 2.5) / 12);
  return new Date((jde - 2440587.5) * 86400000 - (dt + CALIBRATION) * 1000);
}

/** ΔT in seconds (Espenak and Meeus polynomial expressions, 2005 to 2050 and a plain extension beyond). */
function deltaT(y) {
  if (y < 2005) { const t = y - 2000; return 63.86 + 0.3345 * t - 0.060374 * t * t + 0.0017275 * t ** 3 + 0.000651814 * t ** 4 + 0.00002373599 * t ** 5; }
  if (y < 2050) { const t = y - 2000; return 62.92 + 0.32217 * t + 0.005589 * t * t; }
  return -20 + 32 * ((y - 1820) / 100) ** 2 - 0.5628 * (2150 - y);
}

// Sunrise and sunset for diary-sunrise-sunset. The position of the sun is the published low-precision method of the NOAA solar calculator
// (equation of time and declination from the Julian century); the zenith angle, 90.6 degrees, was fitted to times Emacs 30.1 gave for
// 35.994N 78.8986W on 13 dates of 2026 (conformance v0.1.81, sn-minutes), where it falls within a minute of Emacs, not always on it.

const deg = (r) => (r * 180) / Math.PI;
const jdOf = (y, m, d) => { if (m <= 2) { y -= 1; m += 12; } const a = Math.floor(y / 100); return Math.floor(365.25 * (y + 4716)) + Math.floor(30.6001 * (m + 1)) + d + (2 - a + Math.floor(a / 4)) - 1524.5; };
const ZENITH = 90.6;

/** The local time of the sun's rise or set in minutes after midnight, or null when it does not happen that day. `offset` is hours east of UTC. */
function eventMinutes(y, m, d, lat, lon, offset, rise) {
  let utc = 720;
  for (let i = 0; i < 3; i++) {
    const T = (jdOf(y, m, d) + utc / 1440 - 2451545) / 36525;
    const L0 = (280.46646 + T * (36000.76983 + 0.0003032 * T)) % 360;
    const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
    const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
    const C = Math.sin(rad(M)) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(rad(2 * M)) * (0.019993 - 0.000101 * T) + Math.sin(rad(3 * M)) * 0.000289;
    const om = 125.04 - 1934.136 * T;
    const lam = L0 + C - 0.00569 - 0.00478 * Math.sin(rad(om));
    const eps = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60 + 0.00256 * Math.cos(rad(om));
    const dec = deg(Math.asin(Math.sin(rad(eps)) * Math.sin(rad(lam))));
    const yy = Math.tan(rad(eps / 2)) ** 2;
    const eq = 4 * deg(yy * Math.sin(2 * rad(L0)) - 2 * e * Math.sin(rad(M)) + 4 * e * yy * Math.sin(rad(M)) * Math.cos(2 * rad(L0)) - 0.5 * yy * yy * Math.sin(4 * rad(L0)) - 1.25 * e * e * Math.sin(2 * rad(M)));
    const c = Math.cos(rad(ZENITH)) / (Math.cos(rad(lat)) * Math.cos(rad(dec))) - Math.tan(rad(lat)) * Math.tan(rad(dec));
    if (c > 1 || c < -1) return null;
    const H = deg(Math.acos(c));
    utc = 720 - 4 * (lon + (rise ? H : -H)) - eq;
  }
  return (((utc + offset * 60) % 1440) + 1440) % 1440;
}

const hasHead = (f, name) => Array.isArray(f) && isSym(f[0], name);

/** calendar-time-display-form before the init file changes it. */
const DEFAULT_FORM = readForms('(12-hours ":" minutes am-pm (if time-zone " (") time-zone (if time-zone ")"))')[0];

/** Evaluates one element of calendar-time-display-form: a string, one of its variables, or an (if test then else...) of those. */
function formElement(f, vars) {
  if (typeof f === 'string') return f;
  if (f === null || isSym(f, 'nil')) return null;
  if (isSym(f)) { if (f.sym in vars) return vars[f.sym]; throw new Error(`Unknown variable ${f.sym} in calendar-time-display-form`); }
  if (hasHead(f, 'if')) {
    const test = formElement(f[1], vars);
    if (test !== null && test !== false) return formElement(f[2], vars);
    let r = null;
    for (const e of f.slice(3)) r = formElement(e, vars);
    return r;
  }
  throw new Error('Unsupported element in calendar-time-display-form');
}

/**
 * solar-time-string: decimal hours and a zone name shown through calendar-time-display-form (`where.form`; the Emacs default when unset).
 * @param {number} hours
 * @param {string|null} zone
 */
export function timeString(hours, zone = null) {
  const t = Math.round(hours * 60);
  const h = Math.floor(t / 60) % 24;
  const vars = {
    '12-hours': String(h % 12 === 0 ? 12 : h % 12),
    '24-hours': String(h).padStart(2, '0'),
    minutes: String(t % 60).padStart(2, '0'),
    'am-pm': h < 12 ? 'am' : 'pm',
    'time-zone': zone,
  };
  const form = where.form ?? DEFAULT_FORM;
  return form.map((e) => formElement(e, vars)).filter((x) => x !== null).join('');
}
const hm = (min) => `${Math.floor(Math.round(min) / 60)}:${String(Math.round(min) % 60).padStart(2, '0')}`;

/**
 * The text of diary-sunrise-sunset for a date: "Sunrise 7:04am (EST), sunset 5:01pm (EST) at 36.0N, 78.9W (9:56 hrs daylight)".
 * `zone(y, m, d)` gives { offset (hours east of UTC), name }; `place` replaces the coordinates as the name of the location.
 * @returns {string}
 */
export function sunriseSunset({ y, m, d }, { lat, lon, zone, place = null }) {
  const z = zone(y, m, d);
  const rise = eventMinutes(y, m, d, lat, lon, z.offset, true);
  const set = eventMinutes(y, m, d, lat, lon, z.offset, false);
  const at = place ?? `${Math.abs(lat).toFixed(1)}${lat > 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(1)}${lon > 0 ? 'E' : 'W'}`;
  if (rise === null || set === null) {
    // the sun stays up or down all day: the sign of the declination against the latitude tells which
    return `No sunrise, no sunset at ${at} (${polarDay(y, m, d, lat) ? '24:00' : '0:00'} hrs daylight)`;
  }
  const r = Math.round(rise);
  const s = Math.round(set);
  return `Sunrise ${timeString(rise / 60, z.name)}, sunset ${timeString(set / 60, z.name)} at ${at} (${hm(s - r)} hrs daylight)`;
}

/**
 * solar-sunrise-sunset: ((rise-hours zone) (set-hours zone) "H:MM daylight"), with nil for a rise or set that does not happen.
 * @returns {Array}
 */
export function sunTimes({ y, m, d }, { lat, lon, zone }) {
  const z = zone(y, m, d);
  const rise = eventMinutes(y, m, d, lat, lon, z.offset, true);
  const set = eventMinutes(y, m, d, lat, lon, z.offset, false);
  if (rise === null || set === null) return [null, null, polarDay(y, m, d, lat) ? '24:00' : '0:00'];
  return [[rise / 60, z.name], [set / 60, z.name], hm(Math.round(set) - Math.round(rise))];
}

/** Whether the sun is up all day (true) or down all day (false) at a latitude on a date, for a day with no sunrise. */
function polarDay(y, m, d, lat) {
  const T = (jdOf(y, m, d) - 2451545) / 36525;
  const lam = (280.46646 + T * 36000.76983 + 1.9146 * Math.sin(rad(357.52911 + T * 35999.05))) % 360;
  const dec = deg(Math.asin(Math.sin(rad(23.4393)) * Math.sin(rad(lam))));
  return lat * dec > 0;
}

/** Where the diary sexp diary-sunrise-sunset looks from: set from calendar-latitude, calendar-longitude and calendar-location-name. */
export const where = { lat: null, lon: null, name: null, form: null };

/** The offset (hours east of UTC) and short name of the time zone in force here on a date, at noon. */
export function localZone(y, m, d) {
  const at = new Date(y, m - 1, d, 12);
  const name = new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(at).find((p) => p.type === 'timeZoneName')?.value ?? '';
  return { offset: -at.getTimezoneOffset() / 60, name };
}
