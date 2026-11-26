// The universal argument: C-u, C-u C-u, and digits (C-3, C--, C-12), as Emacs reads them before a command.

/** No argument. */
export const NONE = Object.freeze({ u: 0, digits: '' });

/** C-u pressed once more (C-u C-u is 16). `wrap` makes a fourth press clear it, which a row of buttons needs and a keyboard does not. */
export const pressU = (s, wrap = false) => (wrap && s.u >= 3 ? NONE : { u: s.u + 1, digits: '' });

/** A digit or `-` pressed: after C-u it starts a numeric argument; `toggle` lets a button take its own digit back off. */
export function pressDigit(s, c, toggle = false) {
  if (c === '-') return s.digits === '-' && toggle ? NONE : s.digits === '' ? { u: 0, digits: '-' } : s;
  if (toggle && s.digits === c) return NONE;
  const base = s.digits === '' ? '' : s.digits;
  const next = base === '' || base === '-' ? base + c : base.length < 3 ? base + c : c;
  return { u: 0, digits: next };
}

/** What a command sees: null, { list: n } for n times C-u (4, 16, 64), or { num: n }. */
export function argValue(s) {
  if (s.digits !== '') return { num: s.digits === '-' ? -1 : Number(s.digits) };
  return s.u > 0 ? { list: 4 ** s.u } : null;
}

/** How the argument is written in the echo area and on the button row. */
export function argLabel(s) {
  if (s.digits !== '') return `C-${s.digits}`;
  return s.u > 0 ? Array(s.u).fill('C-u').join(' ') : '';
}
