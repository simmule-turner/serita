// The month grid and time steps behind the date picker. Written from the author's design; weeks start on Sunday as Emacs's calendar does.

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Six weeks of days for a month (1 to 12), Sunday first; days of the months either side are marked `other`. */
export function monthGrid(year, month) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const start = Date.UTC(year, month - 1, 1 - first.getUTCDay());
  const out = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start + i * 86400000);
    out.push({ y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), other: d.getUTCMonth() + 1 !== month });
  }
  return out;
}

/** The month before or after (dir -1 or 1): { y, m }. */
export function stepMonth(year, month, dir) {
  const d = new Date(Date.UTC(year, month - 1 + dir, 1));
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 };
}

/** One step of the time: hours by one, minutes to the next multiple of five, both wrapping round the clock. */
export function stepTime(hour, minute, part, dir) {
  if (part === 'hour') return { hour: (hour + dir + 24) % 24, minute };
  const m = dir > 0 ? Math.floor(minute / 5) * 5 + 5 : Math.ceil(minute / 5) * 5 - 5;
  return { hour, minute: (m + 60) % 60 };
}
