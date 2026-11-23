// Effort values, as Org reads them: H:MM (or H:MM:SS), a bare number, or numbers with units (2h, 30min, 1d 3h; units min, h, d, w, m, y).

const NUM = '\\d+(?:\\.\\d+)?';
const UNIT = '(?:min|h|d|w|m|y)';
const CLOCK = /^\d+:\d{2}(?::\d{2})?$/;
const UNITS = new RegExp(`^${NUM}\\s*${UNIT}(?:\\s+${NUM}\\s*${UNIT})*$`);

/** @param {string} s */
export const isEffort = (s) => CLOCK.test(s) || UNITS.test(s) || new RegExp(`^${NUM}$`).test(s);

const PER = { min: 1, h: 60, d: 1440, w: 10080, m: 43200, y: 525960 };

/** The minutes in an effort value (org-duration-to-minutes): H:MM, a bare number of minutes, or numbers with units. Null when it is not one. */
export function effortMinutes(s) {
  const v = String(s ?? '').trim();
  if (!isEffort(v)) return null;
  if (CLOCK.test(v)) { const [h, m, sec] = v.split(':').map(Number); return h * 60 + m + (sec ?? 0) / 60; }
  if (new RegExp(`^${NUM}$`).test(v)) return Number(v);
  let total = 0;
  for (const m of v.matchAll(new RegExp(`(${NUM})\\s*(${UNIT})`, 'g'))) total += Number(m[1]) * PER[m[2]];
  return total;
}
