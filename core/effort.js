// Effort values, as Org reads them: H:MM (or H:MM:SS), a bare number, or numbers with units (2h, 30min, 1d 3h; units min, h, d, w, m, y).

const NUM = '\\d+(?:\\.\\d+)?';
const UNIT = '(?:min|h|d|w|m|y)';
const CLOCK = /^\d+:\d{2}(?::\d{2})?$/;
const UNITS = new RegExp(`^${NUM}\\s*${UNIT}(?:\\s+${NUM}\\s*${UNIT})*$`);

/** @param {string} s */
export const isEffort = (s) => CLOCK.test(s) || UNITS.test(s) || new RegExp(`^${NUM}$`).test(s);
