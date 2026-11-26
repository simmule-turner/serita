// The arithmetic of table formulas: exact integers and fractions (BigInt), decimal numbers kept to a working precision, and the
// expression language of Emacs Calc's algebraic entry that Org hands formulas to. Pure: values in, text out.
//
// Values: { k: 'q', n, d }       an integer (d = 1n) or an exact fraction
//         { k: 'f', m, e }       the decimal m x 10^e, m rounded to `prec` digits
//         { k: 'v', items }      a vector
//         { k: 's', text }       an expression Calc leaves as it is (1/0, foo(1))
import { UNITS, sameDim, inexact } from './units.js';

export const DEFAULTS = { prec: 12, mode: 'float', digits: 8 };

const abs = (x) => (x < 0n ? -x : x);
const gcd = (a, b) => { a = abs(a); b = abs(b); while (b) [a, b] = [b, a % b]; return a; };
const pow10 = (n) => 10n ** BigInt(n);
const digitsOf = (m) => abs(m).toString().length;

export const int = (n) => ({ k: 'q', n: BigInt(n), d: 1n });
export const frac = (n, d) => {
  if (d < 0n) { n = -n; d = -d; }
  const g = gcd(n, d) || 1n;
  return { k: 'q', n: n / g, d: d / g };
};
const isInt = (x) => x.k === 'q' && x.d === 1n;

/** The decimal m x 10^e rounded (half away from zero) to `prec` digits, trailing zeros of the mantissa moved to the exponent. */
export function dec(m, e, prec) {
  const extra = digitsOf(m) - prec;
  if (extra > 0) {
    const p = pow10(extra);
    const r = abs(m) % p;
    m = m / p;
    if (r * 2n >= p) m += m < 0n || (m === 0n && false) ? -1n : 1n;
    e += extra;
  }
  while (m !== 0n && m % 10n === 0n) { m /= 10n; e++; }
  if (m === 0n) e = 0;
  return { k: 'f', m, e };
}
const decOfQ = (q, prec) => {
  // n/d to prec + 2 digits, then rounded
  const shift = Math.max(0, prec + 3 - (digitsOf(q.n) - digitsOf(q.d)));
  return dec((q.n * pow10(shift)) / q.d, -shift, prec);
};
export const toFloat = (x, prec) => (x.k === 'f' ? x : decOfQ(x, prec));
export const toNumber = (x) => (x.k === 'q' ? Number(x.n) / Number(x.d) : Number(x.m) * 10 ** x.e);
export function fromNumber(v, prec) {
  if (!Number.isFinite(v)) return { k: 's', text: String(v) };
  if (v === 0) return { k: 'f', m: 0n, e: 0 };
  const [mant, exp] = v.toExponential(Math.min(prec, 17) - 1).split('e');
  return dec(BigInt(mant.replace('.', '')), Number(exp) - (mant.replace(/^-/, '').length - 2), prec);
}

// ---- dates: a date form is a day number (days from 1 January of year 1, with the time of day as a fraction) ----
const EPOCH_DAYS = 719163n; // 1970-01-01
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** A date form for a calendar date and time of day. */
export function dateForm(y, mo, d, h = 0, mi = 0, s = 0) {
  const days = BigInt(Math.round(Date.UTC(y, mo - 1, d) / 86400000)) + EPOCH_DAYS;
  return { k: 'd', v: frac(days * 86400n + BigInt(h) * 3600n + BigInt(mi) * 60n + BigInt(s), 86400n) };
}
const dateText = (x) => {
  const secs = (x.v.n * 86400n) / x.v.d;
  const days = secs / 86400n - (secs % 86400n < 0n ? 1n : 0n);
  const rest = Number(secs - days * 86400n);
  const dt = new Date(Number(days - EPOCH_DAYS) * 86400000);
  const two = (n) => String(n).padStart(2, '0');
  const time = rest ? ` ${two(Math.floor(rest / 3600))}:${two(Math.floor(rest / 60) % 60)}${rest % 60 ? `:${two(rest % 60)}` : ''}` : '';
  return `[${dt.getUTCFullYear()}-${two(dt.getUTCMonth() + 1)}-${two(dt.getUTCDate())} ${DAY_NAMES[dt.getUTCDay()]}${time}]`;
};
/** The date form of the time now. */
/** The time now, to the minute, as a date with a decimal day count (so now()-now() is 0. and date(now()) a decimal). */
export const nowForm = () => { const n = new Date(); return { ...dateForm(n.getFullYear(), n.getMonth() + 1, n.getDate(), n.getHours(), n.getMinutes(), 0), fl: true }; };

const same = (a, b, prec) => {
  if (a.k === 'q' && b.k === 'q') return [a, b, 'q'];
  return [toFloat(a, prec), toFloat(b, prec), 'f'];
};

export const add = (a, b, prec) => {
  const [x, y, t] = same(a, b, prec);
  if (t === 'q') return frac(x.n * y.d + y.n * x.d, x.d * y.d);
  const e = Math.min(x.e, y.e);
  return dec(x.m * pow10(x.e - e) + y.m * pow10(y.e - e), e, prec);
};
export const neg = (a) => (a.k === 'q' ? { ...a, n: -a.n } : { ...a, m: -a.m });
export const sub = (a, b, prec) => add(a, neg(b), prec);
export const mul = (a, b, prec) => {
  const [x, y, t] = same(a, b, prec);
  if (t === 'q') return frac(x.n * y.n, x.d * y.d);
  return dec(x.m * y.m, x.e + y.e, prec);
};
export const isZero = (a) => (a.k === 'q' ? a.n === 0n : a.m === 0n);
export const sign = (a) => { const v = a.k === 'q' ? a.n : a.m; return v < 0n ? -1 : v > 0n ? 1 : 0; };

/** Integers that divide evenly stay integers; otherwise the quotient is a decimal. Fractions stay fractions. */
export const div = (a, b, prec) => {
  if (isZero(b)) return { k: 's', text: `${text(a, DEFAULTS)}/0` };
  if (a.k === 'q' && b.k === 'q') {
    const q = frac(a.n * b.d, a.d * b.n);
    return isInt(a) && isInt(b) && q.d !== 1n ? decOfQ(q, prec) : q;
  }
  const [x, y] = [toFloat(a, prec), toFloat(b, prec)];
  const shift = Math.max(0, prec + 3 - (digitsOf(x.m) - digitsOf(y.m)));
  return dec((x.m * pow10(shift)) / y.m, x.e - y.e - shift, prec);
};

const cmp = (a, b, prec) => sign(sub(a, b, prec));

export function pow(a, b, prec) {
  if (isInt(b) && b.n >= 0n && b.n < 100000n) {
    if (a.k === 'q') return frac(a.n ** b.n, a.d ** b.n);
    let r = int(1); let i = 0n;
    for (; i < b.n; i++) r = mul(r, a, prec);
    return r;
  }
  if (isInt(b) && b.n < 0n) return div(int(1), pow(a, neg(b), prec), prec);
  return fromNumber(toNumber(a) ** toNumber(b), prec);
}

export function sqrt(a, prec) {
  if (isInt(a) && a.n >= 0n) {
    let r = BigInt(Math.floor(Math.sqrt(Number(a.n))));
    while (r * r > a.n) r--;
    while ((r + 1n) * (r + 1n) <= a.n) r++;
    if (r * r === a.n) return int(r);
  }
  return fromNumber(Math.sqrt(toNumber(a)), prec);
}

export const mod = (a, b, prec) => {
  if (isZero(b)) return { k: 's', text: `${text(a, DEFAULTS)} % 0` };
  const q = floor(div(a, b, prec), prec);
  return sub(a, mul(b, q, prec), prec);
};

export function floor(a, prec) {
  if (a.k === 'q') { let q = a.n / a.d; if (a.n % a.d !== 0n && a.n < 0n) q -= 1n; return int(q); }
  if (a.e >= 0) return int(a.m * pow10(a.e));
  const p = pow10(-a.e);
  let q = a.m / p;
  if (a.m % p !== 0n && a.m < 0n) q -= 1n;
  return int(q);
}
export const round = (a, prec) => floor(add(a, frac(1n, 2n), prec), prec);

// ---- reading and printing -------------------------------------------------

/** The value of a cell or number in the text of an expression, or null when it is not a number. */
export function parseNumber(s, prec) {
  s = s.trim();
  const rx = /^([-+]?)(\d+)#([0-9a-zA-Z]+)(?:\.([0-9a-zA-Z]*))?$/.exec(s);
  if (rx) return radixNumber(rx[1], Number(rx[2]), rx[3], rx[4], prec);
  let m = /^([-+]?)(\d+):(\d+)$/.exec(s);
  if (m) return m[3] === '0' ? null : frac(BigInt(m[1] + m[2]), BigInt(m[3]));
  m = /^([-+]?)(\d+)$/.exec(s);
  if (m) return int(BigInt(m[1] + m[2]));
  m = /^([-+]?)(\d*)(?:\.(\d*))?(?:[eE]([-+]?\d+))?$/.exec(s);
  if (m && (m[2] || m[3]) && (m[3] !== undefined || m[4] !== undefined)) {
    const frac = m[3] ?? '';
    return dec(BigInt(`${m[1]}${m[2] || '0'}${frac}`), Number(m[4] ?? 0) - frac.length, prec, true);
  }
  return null;
}

const DIGIT = (ch) => parseInt(ch, 36);
/** A number written in a base from 2 to 36 (`16#ff`, `2#101.1`): an integer, or a decimal when it has a point. */
function radixNumber(sign, base, whole, part, prec) {
  if (base < 2 || base > 36) return null;
  let n = 0n; let d = 1n;
  for (const ch of whole) { const v = DIGIT(ch); if (v >= base) return null; n = n * BigInt(base) + BigInt(v); }
  for (const ch of part ?? '') { const v = DIGIT(ch); if (v >= base) return null; n = n * BigInt(base) + BigInt(v); d *= BigInt(base); }
  const q = frac(sign === '-' ? -n : n, d);
  return part === undefined ? q : decOfQ(q, prec);
}

const radixDigits = (n, base) => (n === 0n ? '0' : (() => { let s = ''; for (; n > 0n; n /= BigInt(base)) s = Number(n % BigInt(base)).toString(36).toUpperCase() + s; return s; })());
/** A value in the base Calc is set to display (calc-number-radix): `16#FF`, `2#0.01`; a decimal keeps `digits` digits. */
export function radixText(x, base, digits, fix = false) {
  const q = x.k === 'q' ? x : null;
  const v = q ?? toFloat(x, 40);
  const neg = sign(x) < 0;
  const a = neg ? { ...v, ...(q ? { n: -q.n } : { m: -v.m }) } : v;
  // as an exact fraction
  let n; let d;
  if (a.k === 'q') { n = a.n; d = a.d; } else if (a.e >= 0) { n = a.m * pow10(a.e); d = 1n; } else { n = a.m; d = pow10(-a.e); }
  const whole = n / d; let rest = n % d;
  const B = BigInt(base);
  if (rest === 0n && a.k === 'q') return `${neg ? '-' : ''}${base}#${radixDigits(whole, base)}`;
  let w = radixDigits(whole, base);
  let fr = '';
  const room = fix ? digits : Math.max(0, digits - (whole === 0n ? 0 : w.length));
  let kept = 0;
  while (kept < room && (rest !== 0n || fix)) { rest *= B; const dg = rest / d; fr += Number(dg).toString(36).toUpperCase(); rest %= d; if (fix || whole !== 0n || dg !== 0n || kept > 0) kept++; }
  if (rest * 2n >= d && rest !== 0n) {
    // round the last digit up
    let digs = [...(w + fr)].map((ch) => DIGIT(ch));
    let i = digs.length - 1;
    for (; i >= 0; i--) { digs[i]++; if (digs[i] < base) break; digs[i] = 0; }
    if (i < 0) digs = [1, ...digs];
    const all = digs.map((v) => v.toString(36).toUpperCase()).join('');
    const extra = all.length - (w.length + fr.length);
    w = all.slice(0, w.length + extra); fr = all.slice(w.length);
  }
  if (fix) return `${neg ? '-' : ''}${base}#${w}.${fr}`;
  fr = fr.replace(/0+$/, '');
  return `${neg ? '-' : ''}${base}#${w}${fr || a.k === 'f' && fr === '' && rest === 0n && whole >= 0n && false ? '' : ''}${fr ? `.${fr}` : '.'}`.replace(/\.$/, a.k === 'f' ? '.' : '');
}

const digitsString = (m, e) => {
  const s = abs(m).toString();
  if (e >= 0) return `${s}${'0'.repeat(e)}.`;
  if (s.length > -e) return `${s.slice(0, s.length + e)}.${s.slice(s.length + e)}`;
  return `0.${'0'.repeat(-e - s.length)}${s}`;
};

/** A decimal as Calc prints it in float mode: at most `digits` significant digits, a whole number with a trailing point. */
function floatText(x, { digits }) {
  if (x.m === 0n) return '0.';
  let m = x.m; let e = x.e;
  const extra = digitsOf(m) - digits;
  if (extra > 0) {
    const p = pow10(extra);
    const r = abs(m) % p;
    m /= p;
    if (r * 2n >= p) m += x.m < 0n ? -1n : 1n;
    e += extra;
    if (digitsOf(m) > digits) { m /= 10n; e++; }
  }
  const sig = digitsOf(m);
  const mag = sig + e; // the decimal point sits after `mag` digits
  let body;
  if (mag > 12 || mag < -1) {
    const s = abs(m).toString();
    body = `${s[0]}${s.length > 1 ? `.${s.slice(1)}` : ''}e${mag - 1}`;
  } else body = digitsString(m, e);
  const out = (x.m < 0n ? '-' : '') + body;
  return out.endsWith('.') && !/e/.test(out) ? out : out;
}

/** The text of a value; a whole-number decimal is printed with its point ("1000.") like Calc, and a number that is not exact ends in the digits kept. */
export function text(x, opts = DEFAULTS) {
  switch (x.k) {
    case 'q': if (opts.radix && opts.radix !== 10 && x.d === 1n) return radixText(x, opts.radix, opts.digits); return x.d === 1n ? x.n.toString() : `${x.n}:${x.d}`;
    case 'f': {
      if (opts.mode === 'fix') return opts.radix && opts.radix !== 10 ? radixText(x, opts.radix, opts.digits, true) : fixed(x, opts.digits);
      if (opts.mode === 'sci') return sci(x, opts.digits);
      if (opts.radix && opts.radix !== 10) return radixText(x, opts.radix, opts.digits);
      return floatText(x, opts.mode === 'eng' ? { ...opts, digits: opts.digits } : opts);
    }
    case 'v': return `[${x.items.map((i) => text(i, opts)).join(', ')}]`;
    case 'x': return printTree(x.e, opts);
    case 'm': return `${text(x.a, opts)} mod ${text(x.n, opts)}`;
    case 'l': return x.paren ? `(${x.items.map((i) => text(i, opts)).join(', ')})` : x.items.map((i) => text(i, opts)).join(', ');
    case 'd': return dateText(x);
    default: return x.text;
  }
}

/** Fixed point with n decimals. */
export function fixed(x, n) {
  const v = toFloat(x, 40);
  const shifted = v.e + n >= 0 ? v.m * pow10(v.e + n) : roundDiv(v.m, pow10(-(v.e + n)));
  const s = abs(shifted).toString().padStart(n + 1, '0');
  const body = n > 0 ? `${s.slice(0, s.length - n)}.${s.slice(s.length - n)}` : s;
  return (shifted < 0n ? '-' : '') + body;
}
const roundDiv = (m, p) => { const r = abs(m) % p; let q = m / p; if (r * 2n >= p) q += m < 0n ? -1n : 1n; return q; };
function sci(x, n) {
  if (x.m === 0n) return '0.';
  const d = digitsOf(x.m);
  let m = d > n ? roundDiv(x.m, pow10(d - n)) : x.m;
  let e = x.e + Math.max(0, d - n);
  if (digitsOf(m) > n) { m = roundDiv(m, 10n); e++; }
  while (m !== 0n && m % 10n === 0n && digitsOf(m) > 1) { m /= 10n; e++; }
  const s = abs(m).toString();
  return `${x.m < 0n ? '-' : ''}${s[0]}${s.length > 1 ? `.${s.slice(1)}` : ''}e${e + s.length - 1}`;
}
function eng(x, n) {
  const v = toNumber(x);
  if (v === 0) return '0.';
  const exp = Math.floor(Math.log10(Math.abs(v)));
  if (exp >= -3 && exp < n) { const sd = Math.max(0, n - 1 - exp); return trimZeros(fixed(x, sd)); }
  return sci(x, n);
}
const trimZeros = (s) => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s);

// ---- the expression language ----------------------------------------------

// 1_000 is the atom 1_0 (the part after _ is read as an integer); _5 is -5
const underscore = (w) => {
  let x = /^(\d+)_(\d+)$/.exec(w);
  if (x) return { t: 'id', v: `${x[1]}_${BigInt(x[2])}` };
  x = /^_(\d+)$/.exec(w);
  return x ? { t: 'num', v: `-${x[1]}` } : { t: 'id', v: w };
};
const TOKEN = /\s*(?:([<[]\d{4}-\d\d-\d\d(?: [A-Za-z]+)?(?: \d\d:\d\d(?::\d\d)?)?[>\]])|(\d+#[0-9a-zA-Z]+(?:\.[0-9a-zA-Z]*)?|\d+:\d+(?![\d.eE]))|(\d+_\d+(?![\w.]))|(\d*\.\d+(?:[eE][-+]?\d+)?|\d+\.?(?:[eE][-+]?\d+)?|\d+\.)|([A-Za-z_][A-Za-z_0-9]*)|(&&|\|\||==|!=|<=|>=|[-+*/^%(),<>!\[\]])|"((?:[^"\\]|\\.)*)")/y;

function tokens(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    if (/^\s*$/.test(src.slice(i))) break;
    TOKEN.lastIndex = i;
    const m = TOKEN.exec(src);
    if (!m) throw new Error('syntax');
    out.push(m[1] ? { t: 'date', v: m[1] } : m[2] ? { t: 'num', v: m[2] } : m[3] ? underscore(m[3]) : m[4] ? { t: 'num', v: m[4] } : m[5] ? underscore(m[5]) : m[7] !== undefined ? { t: 'str', v: m[7] } : { t: 'op', v: m[6] });
    i = TOKEN.lastIndex;
  }
  return out;
}

const FUNCS = {
  sqrt: (a, p) => sqrt(a, p), abs: (a) => (sign(a) < 0 ? neg(a) : a), floor: (a, p) => floor(a, p), round: (a, p) => round(a, p),
  ceil: (a, p) => neg(floor(neg(a), p)), trunc: (a, p) => (sign(a) < 0 ? neg(floor(neg(a), p)) : floor(a, p)),
  exp: (a, p) => (a.k === 'q' && a.n === 0n ? int(1) : fromNumber(Math.exp(toNumber(a)), p)), ln: (a, p) => (a.k === 'q' && a.d === 1n && a.n === 1n ? int(0) : fromNumber(Math.log(toNumber(a)), p)),
  log10: (a, p) => fromNumber(Math.log10(toNumber(a)), p),
  atan: (a, p) => fromNumber(Math.atan(toNumber(a)), p),
  deg: (a, p) => fromNumber((toNumber(a) * 180) / Math.PI, p), rad: (a, p) => fromNumber((toNumber(a) * Math.PI) / 180, p),
};
/** sin, cos and tan take degrees unless the formula says radians; whole quarter turns are exact. */
const TRIG = { sin: Math.sin, cos: Math.cos, tan: Math.tan };
const trig = (name, a, prec, angle) => {
  const x = toNumber(a);
  if (angle === 'deg') {
    if (a.k === 'q' && a.d === 1n && a.n % 90n === 0n) {
      const q = Number(((a.n / 90n) % 4n + 4n) % 4n);
      const v = { sin: [0, 1, 0, -1], cos: [1, 0, -1, 0], tan: [0, null, 0, null] }[name][q];
      if (v !== null) return int(v);
    }
    return fromNumber(TRIG[name]((x * Math.PI) / 180), prec);
  }
  return fromNumber(TRIG[name](x), prec);
};
const flat = (xs) => xs.flatMap((x) => (x.k === 'v' ? flat(x.items) : [x]));
const VEC = {
  vsum: (xs, p) => xs.reduce((a, x) => add(a, x, p), int(0)),
  vprod: (xs, p) => xs.reduce((a, x) => mul(a, x, p), int(1)),
  vcount: (xs) => int(xs.length),
  vmax: (xs, p) => xs.reduce((a, x) => (cmp(x, a, p) > 0 ? x : a)),
  vmin: (xs, p) => xs.reduce((a, x) => (cmp(x, a, p) < 0 ? x : a)),
  vmean: (xs, p) => div(VEC.vsum(xs, p), int(xs.length), p),
  vmedian: (xs, p) => { const s = [...xs].sort((a, b) => cmp(a, b, p)); const h = s.length >> 1; return s.length % 2 ? s[h] : div(add(s[h - 1], s[h], p), int(2), p); },
};
const bool = (b) => int(b ? 1 : 0);
const numeric = (x) => x.k === 'q' || x.k === 'f';

// ---- symbolic results: the simplifications Calc makes when an operand is a name ---------------------------

const N = (v) => ({ t: 'n', v });
const isN = (t) => t.t === 'n';
const toTree = (v) => (v.k === 'x' ? v.e : v.k === 's' ? { t: 's', name: v.text } : N(v));
const fromTree = (t) => (t.t === 'n' ? t.v : t.t === 's' ? { k: 's', text: t.name } : { k: 'x', e: t });
const wrapIf = (c, t, o) => (c ? `(${printTree(t, o)})` : printTree(t, o));
/** The text of a symbolic expression: a coefficient and its factors are written with a space, a power with ^. */
function printTree(t, o = DEFAULTS) {
  switch (t.t) {
    case 'n': return text(t.v, o);
    case 's': return t.name;
    case 'add': return `${printTree(t.a, o)} + ${wrapIf(t.b.t === 'add' || t.b.t === 'sub', t.b, o)}`;
    case 'sub': return `${printTree(t.a, o)} - ${wrapIf(t.b.t === 'add' || t.b.t === 'sub', t.b, o)}`;
    case 'mul': return `${wrapIf(['add', 'sub', 'div'].includes(t.a.t), t.a, o)} ${wrapIf(['add', 'sub', 'div'].includes(t.b.t), t.b, o)}`;
    case 'div': return `${wrapIf(t.a.t === 'add' || t.a.t === 'sub', t.a, o)} / ${wrapIf(['add', 'sub', 'mul', 'div'].includes(t.b.t), t.b, o)}`;
    case 'pow': return `${wrapIf(!['s', 'fn'].includes(t.a.t) && !(t.a.t === 'n' && sign(t.a.v) >= 0), t.a, o)}^${wrapIf(!['s', 'fn', 'n'].includes(t.b.t), t.b, o)}`;
    case 'neg': return `-${wrapIf(['add', 'sub'].includes(t.a.t), t.a, o)}`;
    default: return `${t.name}(${t.args.map((x) => printTree(x, o)).join(', ')})`;
  }
}
const sameTree = (a, b) => printTree(a) === printTree(b);
const coef = (t) => (isN(t) ? [t.v, null] : t.t === 'neg' ? [int(-1), t.a] : t.t === 'mul' && isN(t.a) ? [t.a.v, t.b] : [int(1), t]);
const isOne = (v, prec) => cmp(v, int(1), prec) === 0;

function sAdd(a, b, prec) {
  if (isN(a) && isN(b)) return N(add(a.v, b.v, prec));
  if (isN(b) && isZero(b.v)) return a;
  if (isN(a) && isZero(a.v)) return b;
  if (a.t === 'sub' && sameTree(a.b, b)) return a.a;
  if (a.t === 'add' && isN(a.b) && isN(b)) return sAdd(a.a, N(add(a.b.v, b.v, prec)), prec);
  const [ca, ra] = coef(a); const [cb, rb] = coef(b);
  if (ra && rb && sameTree(ra, rb)) return sMul(N(add(ca, cb, prec)), ra, prec);
  return { t: 'add', a, b };
}
function sSub(a, b, prec) {
  if (isN(a) && isN(b)) return N(sub(a.v, b.v, prec));
  if (isN(b) && isZero(b.v)) return a;
  if (isN(a) && isZero(a.v)) return sNeg(b, prec);
  if (b.t === 'add') return sSub(sSub(a, b.a, prec), b.b, prec);
  if (b.t === 'sub') return sAdd(sSub(a, b.a, prec), b.b, prec);
  if (sameTree(a, b)) return N(int(0));
  const [ca, ra] = coef(a); const [cb, rb] = coef(b);
  if (ra && rb && sameTree(ra, rb)) return sMul(N(sub(ca, cb, prec)), ra, prec);
  return { t: 'sub', a, b };
}
function sNeg(a, prec) {
  if (isN(a)) return N(neg(a.v));
  if (a.t === 'add') return sSub(sNeg(a.a, prec), a.b, prec);
  if (a.t === 'sub') return sAdd(sNeg(a.a, prec), a.b, prec);
  return a.t === 'neg' ? a.a : { t: 'neg', a };
}
function sMul(a, b, prec) {
  if (isN(a) && isN(b)) return N(mul(a.v, b.v, prec));
  if ((isN(a) && isZero(a.v)) || (isN(b) && isZero(b.v))) return N(int(0));
  if (isN(a) && isOne(a.v, prec)) return b;
  if (isN(b) && isOne(b.v, prec)) return a;
  if (isN(b)) [a, b] = [b, a];
  if (isN(a) && cmp(a.v, int(-1), prec) === 0 && !isN(b)) return sNeg(b, prec);
  if (isN(a) && b.t === 'div' && isN(b.b)) return sDiv(b.a, N(mul(b.b.v, a.v, prec)), prec);
  if (!isN(a) && a.t === 'neg') return sNeg(sMul(a.a, b, prec), prec);
  if (!isN(a) && b.t === 'neg') return sNeg(sMul(a, b.a, prec), prec);
  if (isN(a) && b.t === 'div') return sDiv(sMul(a, b.a, prec), b.b, prec);
  if (!isN(a) && a.t === 'div' && a.a.t === 'mul' && isN(a.a.a)) return sDiv(sMul(a.a, b, prec), a.b, prec);
  if (!isN(a) && a.t === 'div') return sDiv(a.a, sMul(a.b, b, prec), prec);
  if (!isN(a) && b.t === 'div') return sDiv(sMul(a, b.a, prec), b.b, prec);
  if (isN(a)) {
    if (b.t === 'add') return sAdd(sMul(a, b.a, prec), sMul(a, b.b, prec), prec);
    if (b.t === 'sub') return sSub(sMul(a, b.a, prec), sMul(a, b.b, prec), prec);
    if (b.t === 'mul' && isN(b.a)) return sMul(N(mul(a.v, b.a.v, prec)), b.b, prec);
    return { t: 'mul', a, b };
  }
  if (a.t === 'mul' && isN(a.a)) return sMul(a.a, sMul(a.b, b, prec), prec);
  if (b.t === 'mul' && isN(b.a)) return sMul(b.a, sMul(a, b.b, prec), prec);
  if (sameTree(a, b)) return sPow(a, N(int(2)), prec);
  if (a.t === 'pow' && b.t === 'pow' && isN(a.b) && isN(b.b) && sameTree(a.a, b.a)) return sPow(a.a, N(add(a.b.v, b.b.v, prec)), prec);
  if (a.t === 'pow' && isN(a.b) && sameTree(a.a, b)) return sPow(a.a, N(add(a.b.v, int(1), prec)), prec);
  if (b.t === 'pow' && isN(b.b) && sameTree(b.a, a)) return sPow(a, N(add(b.b.v, int(1), prec)), prec);
  return { t: 'mul', a, b };
}
function sDiv(a, b, prec) {
  if (isN(a) && isN(b)) return N(div(a.v, b.v, prec));
  if (isN(b) && isOne(b.v, prec)) return a;
  if (isN(a) && isZero(a.v)) return a;
  if (sameTree(a, b)) return N(int(1));
  if (isN(b) && cmp(b.v, int(-1), prec) === 0) return sNeg(a, prec);
  if (isN(b) && a.t === 'div' && isN(a.b)) return sDiv(a.a, N(mul(a.b.v, b.v, prec)), prec);
  if (isN(a) && isOne(a.v, prec) && b.t === 'pow' && isN(b.b)) return sPow(b.a, N(neg(b.b.v)), prec);
  {
    const [pa, ea] = a.t === 'pow' && isN(a.b) ? [a.a, a.b.v] : [a, int(1)];
    const [pb, eb] = b.t === 'pow' && isN(b.b) ? [b.a, b.b.v] : [b, int(1)];
    if ((a.t === 'pow' || b.t === 'pow') && !isN(pa) && sameTree(pa, pb)) return sPow(pa, N(sub(ea, eb, prec)), prec);
  }
  if (isN(b) && a.t === 'mul' && isN(a.a)) return sMul(N(div(a.a.v, b.v, prec)), a.b, prec);
  if (a.t === 'mul' && isN(a.a) && b.t === 'mul' && isN(b.a)) return sMul(N(div(a.a.v, b.a.v, prec)), { t: 'div', a: a.b, b: b.b }, prec);
  if (a.t === 'div' && sameTree(a.b, b)) return sDiv(a.a, sPow(b, N(int(2)), prec), prec);
  if (isN(b) && a.t === 'add' && (isN(a.a) || isN(a.b))) return sAdd(sDiv(a.a, b, prec), sDiv(a.b, b, prec), prec);
  return { t: 'div', a, b };
}
function sPow(a, b, prec) {
  if (a.t === 'fn' && a.name === 'sqrt' && isN(b) && cmp(b.v, int(2), prec) === 0) return a.args[0];
  if (isN(b) && isZero(b.v)) return N(int(1));
  if (isN(b) && isOne(b.v, prec)) return a;
  if (isN(a) && isN(b)) return N(pow(a.v, b.v, prec));
  if (a.t === 'pow' && isN(a.b) && isN(b)) return sPow(a.a, N(mul(a.b.v, b.v, prec)), prec);
  if (a.t === 'mul' && isN(a.a) && isN(b) && b.v.k === 'q' && b.v.d === 1n) return sMul(N(pow(a.a.v, b.v, prec)), sPow(a.b, b, prec), prec);
  return { t: 'pow', a, b };
}
/** usimplify: the value as a number times units, with commensurable units merged into the first one met; null when the expression is not made of known units. */
function unitForm(t, prec) {
  const ONE = { c: int(1), f: [] };
  const merge = (a, b, k) => ({ c: mul(a.c, b.c, prec), f: [...a.f.map((x) => [...x]), ...b.f.map(([u, e]) => [u, e * k])] });
  switch (t.t) {
    case 'n': return numeric(t.v) ? { c: t.v, f: [] } : null;
    case 's': return Object.hasOwn(UNITS, t.name) ? { c: int(1), f: [[t.name, 1]] } : null;
    case 'neg': { const a = unitForm(t.a, prec); return a && { c: neg(a.c), f: a.f }; }
    case 'mul': { const a = unitForm(t.a, prec); const b = a && unitForm(t.b, prec); return b && merge(a, b, 1); }
    case 'div': { const a = unitForm(t.a, prec); const b = a && unitForm(t.b, prec); return b && { c: div(a.c, b.c, prec), f: [...a.f.map((x) => [...x]), ...b.f.map(([u, e]) => [u, -e])] }; }
    case 'pow': { const a = unitForm(t.a, prec); if (!a || !isN(t.b) || t.b.v.k !== 'q' || t.b.v.d !== 1n) return null; const e = Number(t.b.v.n); return { c: pow(a.c, t.b.v, prec), f: a.f.map(([u, x]) => [u, x * e]) }; }
    case 'add': case 'sub': {
      const a = norm(unitForm(t.a, prec), prec); const b = a && norm(unitForm(t.b, prec), prec);
      if (!b) return null;
      const r = convertTo(b, a.f, prec);
      return r && { c: t.t === 'add' ? add(a.c, r, prec) : sub(a.c, r, prec), f: a.f };
    }
    default: return ONE && null;
  }
}
const dimOf = (u) => UNITS[u].dim;
const ratio = (u, v) => frac(UNITS[u].n * UNITS[v].d, UNITS[u].d * UNITS[v].n);
/** Merges units of one dimension into the first of them; zero exponents drop out. */
function norm(a, prec) {
  if (!a) return null;
  let c = a.c; const f = [];
  for (const [u, e] of a.f) {
    const at = f.find(([v]) => sameDim(dimOf(v), dimOf(u)));
    if (!at) { f.push([u, e]); continue; }
    const k = ratio(u, at[0]);
    c = mul(c, pow(k, int(e), prec), prec); at[1] += e;
  }
  return { c, f: f.filter(([, e]) => e !== 0) };
}
/** The coefficient of `a` written in the units `target`, or null when they do not measure the same thing. */
function convertTo(a, target, prec) {
  const sig = (f) => f.map(([u, e]) => [dimOf(u), e]);
  if (a.f.length !== target.length) return null;
  let c = a.c;
  for (const [u, e] of a.f) {
    const t = target.find(([v, x]) => x === e && sameDim(dimOf(v), dimOf(u)));
    if (!t) return null;
    const k = ratio(u, t[0]);
    c = mul(c, pow(k, int(e), prec), prec);
  }
  return sig && c;
}
function unitTree(a, prec) {
  const power = ([u, e]) => sPow({ t: 's', name: u }, N(int(Math.abs(e))), prec);
  const prod = (xs) => xs.map(power).reduce((p, x) => (p ? sMul(p, x, prec) : x), null);
  const top = prod(a.f.filter(([, e]) => e > 0)); const bottom = prod(a.f.filter(([, e]) => e < 0));
  const c = a.c.k === 'q' && a.c.d !== 1n ? toFloat(a.c, prec) : a.c;
  let r = top ? sMul(N(c), top, prec) : N(c);
  if (bottom) r = { t: 'div', a: r, b: bottom };
  return r;
}
const BASES = [['m', [1, 0, 0, 0]], ['kg', [0, 1, 0, 0]], ['s', [0, 0, 1, 0]], ['K', [0, 0, 0, 1]]];
const dimOfForm = (a) => a.f.reduce((d, [u, e]) => d.map((x, i) => x + e * UNITS[u].dim[i]), [0, 0, 0, 0]);
const sizeOf = (a, prec) => a.f.reduce((c, [u, e]) => {
  const { n, d } = UNITS[u];
  const k = BigInt(Math.abs(e));
  return mul(c, e >= 0 ? frac(n ** k, d ** k) : frac(d ** k, n ** k), prec);
}, int(1));
/** uconv (the function Org's own documentation defines with defmath): the value in the target units; units that do not match, or are not known, give base units. */
function uconv(v, target, pure, prec) {
  if (numeric(v) || (v.k !== 's' && v.k !== 'x')) return v;
  const src = unitForm(toTree(v), prec);
  if (!src) return v;
  let tgt = target && (target.k === 's' || target.k === 'x') ? unitForm(toTree(target), prec) : null;
  if (tgt && (tgt.f.length === 0 || !(tgt.c.k === 'q' && tgt.c.n === 1n && tgt.c.d === 1n))) tgt = null;
  const dim = dimOfForm(src);
  const same = tgt && sameDim(dim, dimOfForm(tgt));
  let c = mul(src.c, sizeOf(src, prec), prec);
  let units;
  if (same) { c = div(c, sizeOf(tgt, prec), prec); units = tgt.f; } else units = BASES.filter(([, d]) => dim.some((x, i) => x !== 0 && d[i] === 1)).map(([u]) => [u, dim[BASES.findIndex(([n]) => n === u)]]);
  if ([...src.f, ...(same ? tgt.f : [])].some(([u]) => inexact(u)) && c.k === 'q') c = toFloat(c, prec);
  if (pure) return c.k === 'q' && c.d !== 1n ? toFloat(c, prec) : c;
  return fromTree(unitTree({ c, f: units }, prec));
}
/** utemp: what Calc's u t gives, an absolute temperature in another scale; anything else is an error. */
function utemp(v, target, prec) {
  const one = (x) => { const f = x && (x.k === 's' || x.k === 'x' ? unitForm(toTree(x), prec) : null); return f && f.f.length === 1 && f.f[0][1] === 1 && ['K', 'degC', 'degF'].includes(f.f[0][0]) ? f : null; };
  const a = one(v), t = target && target.k === 's' && ['K', 'degC', 'degF'].includes(target.text) ? target.text : null;
  if (!a || !t) throw new Error('syntax');
  const k = ({ K: (x) => x, degC: (x) => add(x, frac(27315n, 100n), prec), degF: (x) => mul(add(x, frac(45967n, 100n), prec), frac(5n, 9n), prec) })[a.f[0][0]](a.c);
  const out = ({ K: (x) => x, degC: (x) => sub(x, frac(27315n, 100n), prec), degF: (x) => sub(mul(x, frac(9n, 5n), prec), frac(45967n, 100n), prec) })[t](k);
  return fromTree(sMul(N(toFloat(out, prec)), { t: 's', name: t }, prec));
}
const SYM = { '+': sAdd, '-': sSub, '*': sMul, '/': sDiv, '^': sPow };

/**
 * Evaluates the text of a formula. `prec` is the working precision. Throws an Error('syntax') for what Calc cannot read.
 * @param {string} src @param {{ prec?: number }} [opts]
 */
export function evaluate(src, { prec = DEFAULTS.prec, angle = 'deg', frac: fractions = false, symbolic = false } = {}) {
  const toks = tokens(src);
  let i = 0;
  const peek = () => toks[i];
  const eat = (v) => { if (toks[i]?.t === 'op' && toks[i].v === v) { i++; return true; } return false; };
  const need = (v) => { if (!eat(v)) throw new Error('syntax'); };
  const arith = (f, ...xs) => (xs.every(numeric) ? f(...xs, prec) : { k: 's', text: 'nan' });
  const binary = (op, a, b) => {
    if (a.k === 'd' || b.k === 'd') {
      if (op === '-' && a.k === 'd' && b.k === 'd') { const r = sub(a.v, b.v, prec); return a.fl || b.fl ? toFloat(r, prec) : r; }
      if ((op === '+' || op === '-') && a.k === 'd' && numeric(b)) return { k: 'd', fl: a.fl, v: op === '+' ? add(a.v, b, prec) : sub(a.v, b, prec) };
      if (op === '+' && numeric(a) && b.k === 'd') return { k: 'd', fl: b.fl, v: add(b.v, a, prec) };
      if (['<', '>', '<=', '>=', '==', '!='].includes(op) && a.k === b.k) return binary(op, a.v, b.v);
      return { k: 's', text: `${text(a)} ${op} ${text(b)}` };
    }
    if (op === 'mod' && a.k === 'v' && numeric(b)) return { k: 'v', items: a.items.map((x) => binary('mod', x, b)) };
    if (op === 'mod') {
      if (numeric(a) && numeric(b) && isZero(b)) return { k: 's', text: `makemod(${text(a)}, 0)` };
      if (!numeric(a) || !numeric(b) || isZero(b)) return { k: 's', text: `${text(a)} mod ${text(b)}` };
      return { k: 'm', a: mod(a, b, prec), n: b };
    }
    if (a.k === 'l' || b.k === 'l') {
      const l = a.k === 'l' ? a : b; const o = a.k === 'l' ? b : a;
      const pair = (x) => x.k === 'l' && x.paren && x.items.length === 2 && x.items.every(numeric);
      if (pair(a) && pair(b) && ['+', '-', '*'].includes(op)) {
        const [p1, q1] = a.items; const [p2, q2] = b.items;
        const items = op === '+' ? [add(p1, p2, prec), add(q1, q2, prec)] : op === '-' ? [sub(p1, p2, prec), sub(q1, q2, prec)]
          : [sub(mul(p1, p2, prec), mul(q1, q2, prec), prec), add(mul(p1, q2, prec), mul(q1, p2, prec), prec)];
        return isZero(items[1]) ? items[0] : { ...a, items };
      }
      if (op === '^' && pair(a) && b.k === 'q' && b.d === 1n && b.n >= 1n) { let r = a; for (let i = 1n; i < b.n; i++) r = binary('*', r, a); return r; }
      if (o.k === 'l' || !numeric(o)) return { k: 's', text: `${text(a)} ${op} ${text(b)}` };
      const f = (x) => (a.k === 'l' ? binary(op, x, o) : binary(op, o, x));
      const items = op === '*' || op === '/' ? l.items.map(f) : [f(l.items[0]), ...l.items.slice(1)];
      return l.paren && items.length === 2 && numeric(items[1]) && isZero(items[1]) ? items[0] : { ...l, items };
    }
    if (a.k === 'm' || b.k === 'm') {
      const m = a.k === 'm' ? a : b; const o = a.k === 'm' ? b : a;
      const on = o.k === 'm' ? o.a : o;
      const whole = (x) => x.k === 'q' && x.d === 1n;
      const inverse = (x, n) => { // x^-1 mod n, when n is a whole number and x is prime to it
        if (!whole(x) || !whole(n)) return null;
        let [r0, r1, t0, t1] = [n.n, ((x.n % n.n) + n.n) % n.n, 0n, 1n];
        while (r1 !== 0n) { const q = r0 / r1; [r0, r1] = [r1, r0 - q * r1]; [t0, t1] = [t1, t0 - q * t1]; }
        return r0 === 1n ? { k: 'q', n: ((t0 % n.n) + n.n) % n.n, d: 1n } : null;
      };
      if (a.k === 'm' && b.k === 'm' && !(sign(sub(a.n, b.n, prec)) === 0)) return { k: 's', text: `${text(a)} ${op} ${text(b)}` };
      if (op === '^' && a.k === 'm' && whole(b) && whole(a.a) && whole(a.n)) {
        let base = a.a; let e = b.n;
        if (e < 0n) { base = inverse(base, a.n); e = -e; if (!base) return { k: 's', text: `${text(a)} ^ ${text(b)}` }; }
        let r = { k: 'q', n: 1n, d: 1n }; for (let i = 0n; i < e; i++) r = mod(mul(r, base, prec), a.n, prec);
        return { k: 'm', a: r, n: a.n };
      }
      if (op === '^' && a.k === 'm' && numeric(b)) return { k: 'm', a: mod(pow(a.a, b, prec), a.n, prec), n: a.n };
      if (['==', '!='].includes(op) && a.k === 'm' && b.k === 'm') return bool((sign(sub(a.a, b.a, prec)) === 0) === (op === '=='));
      if (op === '/' && whole(m.n ?? m)) {
        const den = b.k === 'm' ? b.a : b; const num = a.k === 'm' ? a.a : a;
        const inv = inverse(den, m.n);
        if (inv && numeric(num)) return { k: 'm', a: mod(mul(num, inv, prec), m.n, prec), n: m.n };
        const q = numeric(num) && !isZero(den) ? div(num, den, prec) : null; // not prime to the modulus: an exact quotient still counts
        if (q && q.k === 'q' && q.d === 1n) return { k: 'm', a: mod(q, m.n, prec), n: m.n };
        return { k: 's', text: `${text(a)} / ${b.k === 'm' ? `(${text(b)})` : text(b)}` };
      }
      if (!['+', '-', '*'].includes(op) || !numeric(on) || (o.k === 'm' && !numeric(o.n))) return { k: 's', text: `${text(a)} ${op} ${text(b)}` };
      const r = a.k === 'm' ? binary(op, m.a, on) : binary(op, on, m.a);
      return { k: 'm', a: mod(r, m.n, prec), n: m.n };
    }
    if (op === '^' && a.k === 'v' && b.k === 'q' && b.d === 1n && b.n === 2n && a.items.every(numeric)) return a.items.reduce((t, x) => add(t, mul(x, x, prec), prec), int(0));
    if (a.k === 'v' || b.k === 'v') {
      if (a.k === 'v' && b.k === 'v' && a.items.length !== b.items.length) throw new Error('syntax');
      const len = a.k === 'v' ? a.items.length : b.items.length;
      return { k: 'v', items: Array.from({ length: len }, (_, j) => binary(op, a.k === 'v' ? a.items[j] : a, b.k === 'v' ? b.items[j] : b)) };
    }
    if (!numeric(a) || !numeric(b)) {
      if ((a.k === 's' && a.text === 'nan') || (b.k === 's' && b.text === 'nan')) return { k: 's', text: 'nan' }; // not a number stays not a number
      if (SYM[op]) return fromTree(SYM[op](toTree(a), toTree(b), prec));
      return { k: 's', text: `${text(a)} ${op} ${text(b)}` };
    }
    switch (op) {
      case '+': return add(a, b, prec); case '-': return sub(a, b, prec); case '*': return mul(a, b, prec);
      case '/': return fractions && a.k === 'q' && b.k === 'q' && !isZero(b) ? frac(a.n * b.d, a.d * b.n) : div(a, b, prec); case '^': return pow(a, b, prec); case '%': return mod(a, b, prec);
      case '<': return bool(cmp(a, b, prec) < 0); case '>': return bool(cmp(a, b, prec) > 0);
      case '<=': return bool(cmp(a, b, prec) <= 0); case '>=': return bool(cmp(a, b, prec) >= 0);
      case '==': return bool(cmp(a, b, prec) === 0); case '!=': return bool(cmp(a, b, prec) !== 0);
      case '&&': return bool(!isZero(a) && !isZero(b)); default: return bool(!isZero(a) || !isZero(b));
    }
  };
  const level = (ops, next) => () => {
    let a = next();
    while (peek()?.t === 'op' && ops.includes(peek().v)) { const op = toks[i++].v; a = binary(op, a, next()); }
    return a;
  };
  const primary = () => {
    const t = toks[i++];
    if (!t) throw new Error('syntax');
    if (t.t === 'date') {
      const d = /(\d{4})-(\d\d)-(\d\d)(?: [A-Za-z]+)?(?: (\d\d):(\d\d)(?::(\d\d))?)?/.exec(t.v);
      return dateForm(Number(d[1]), Number(d[2]), Number(d[3]), Number(d[4] ?? 0), Number(d[5] ?? 0), Number(d[6] ?? 0));
    }
    if (t.t === 'str') return { k: 'v', items: [...t.v].map((c) => int(c.codePointAt(0))) };
    if (t.t === 'num') {
      const v = parseNumber(t.v, prec);
      if (!v) throw new Error('syntax');
      return v;
    }
    if (t.t === 'op') {
      if (t.v === '(') {
        const v = or();
        if (peek()?.v === ',') { const items = [v]; while (eat(',')) items.push(or()); need(')'); return items.length === 2 && items.every(numeric) && isZero(items[1]) ? items[0] : { k: 'l', items, paren: true }; }
        need(')'); return v;
      }
      if (t.v === '[') { const items = []; if (!eat(']')) { do items.push(or()); while (eat(',')); need(']'); } return { k: 'v', items }; }
      throw new Error('syntax');
    }
    if (eat('(')) {
      const args = [];
      if (!eat(')')) { do args.push(or()); while (eat(',')); need(')'); }
      return call(t.v, args);
    }
    return { k: 's', text: t.v };
  };
  const call = (name, args) => {
    if (name === 'abs' && args.length === 1 && args[0].k === 'm') return args[0];
    if ((name === 'abs' || name === 'sqrt') && args.length === 1 && (args[0].k === 's' || args[0].k === 'x') && args[0].text !== 'nan') {
      let a = toTree(args[0]);
      if (name === 'abs' && a.t === 'neg') a = a.a;
      if (name === 'sqrt' && a.t === 'mul' && isN(a.a) && numeric(a.a.v)) { const r = FUNCS.sqrt(a.a.v, prec); if (r.k === 'q') return fromTree(sMul(N(r), { t: 'fn', name, args: [a.b] }, prec)); }
      return fromTree({ t: 'fn', name, args: [a] });
    }
    if (name === 'uconv' && (args.length === 2 || args.length === 3)) return uconv(args[0], args[1], args[2] && !(numeric(args[2]) && isZero(args[2])), prec);
    if (name === 'utemp' && args.length === 2) return utemp(args[0], args[1], prec);
    if (name === 'usimplify' && args.length === 1) {
      if (numeric(args[0])) return args[0];
      if (args[0].k === 's' || args[0].k === 'x') { const u = norm(unitForm(toTree(args[0]), prec), prec); if (u) return fromTree(unitTree(u, prec)); }
    }
    if (name === 'vlen' && args.length === 1 && args[0].k === 'v') return int(args[0].items.length);
    if (name === 'ln' && args.length === 1 && args[0].k === 's' && args[0].text === 'e') return int(1);
    if (name === 'mod' && args.length === 2 && numeric(args[0]) && numeric(args[1])) return mod(args[0], args[1], prec);
    if (name === 'sqrt' && symbolic && args.length === 1 && numeric(args[0]) && !(FUNCS.sqrt(args[0], prec).k === 'q')) return { k: 's', text: `sqrt(${text(args[0])})` };
    if (VEC[name]) {
      const xs = flat(args);
      if (!xs.every(numeric)) {
        if (!xs.length) throw new Error('syntax');
        if (name === 'vcount') return int(xs.length);
        if (name === 'vsum') return xs.reduce((a, x) => binary('+', a, x));
        if (name === 'vprod') return xs.reduce((a, x) => binary('*', a, x));
        if (name === 'vmean') return binary('/', xs.reduce((a, x) => binary('+', a, x)), int(xs.length));
        if (name === 'vmax' || name === 'vmin') return { k: 's', text: `${name === 'vmax' ? 'max' : 'min'}(${xs.map((x) => text(x)).join(', ')})` };
        throw new Error('syntax');
      }
      if (!xs.length) { if (name === 'vsum' || name === 'vcount') return int(0); if (name === 'vprod') return int(1); throw new Error('syntax'); }
      return VEC[name](xs, prec);
    }
    if (TRIG[name] && args.length === 1) return numeric(args[0]) ? trig(name, args[0], prec, angle) : { k: 's', text: `${name}(${text(args[0])})` };
    if (FUNCS[name] && args.length === 1) return numeric(args[0]) ? FUNCS[name](args[0], prec) : { k: 's', text: `${name}(${text(args[0])})` };
    if ((name === 'min' || name === 'max') && args.length) { const xs = flat(args); return VEC[name === 'min' ? 'vmin' : 'vmax'](xs, prec); }
    if (name === 'date') {
      if (args.length === 1 && args[0].k === 'd') return args[0].fl ? toFloat(args[0].v, prec) : args[0].v.d === 1n ? int(args[0].v.n / args[0].v.d) : args[0].v;
      if (args.length >= 3 && args.every((a) => a.k === 'q' && a.d === 1n)) return dateForm(...args.map((a) => Number(a.n)));
      throw new Error('syntax');
    }
    if (name === 'now' && !args.length) return nowForm();
    if (name === 'if' && args.length === 3) return isZero(args[0]) ? args[2] : args[1];
    return { k: 's', text: `${name}(${args.map((a) => text(a)).join(', ')})` };
  };
  const unary = () => { if (eat('-')) { const a = unary(); return numeric(a) ? neg(a) : a.k === 'l' && a.items.every(numeric) ? { ...a, items: a.items.map(neg) } : fromTree(sNeg(toTree(a), prec)); } if (eat('+')) return unary(); if (eat('!')) return bool(isZero(unary())); return power(); };
  const power = () => { const a = primary(); return eat('^') ? binary('^', a, unary()) : a; };
  const implicit = (t) => t && ((t.t === 'id' && t.v !== 'mod') || (t.t === 'op' && t.v === '(') || t.t === 'num');
  const mulDiv = () => {
    let a = unary();
    for (;;) {
      const t = peek();
      if (t?.t === 'op' && t.v === '/') { i++; let r = unary(); while (implicit(peek())) r = binary('*', r, unary()); a = binary('/', a, r); }
      else if (t?.t === 'op' && ['*', '%'].includes(t.v)) { i++; a = binary(t.v, a, unary()); }
      else if (t?.t === 'id' && t.v === 'mod') { i++; a = binary('mod', a, unary()); }
      else if (implicit(t)) a = binary('*', a, unary());
      else return a;
    }
  };
  const sum = level(['+', '-'], mulDiv);
  const compare = level(['<', '>', '<=', '>=', '==', '!='], sum);
  const and = level(['&&'], compare);
  const or = level(['||'], and);
  let v = or();
  if (toks[i]?.v === ',') { const items = [v]; while (eat(',')) items.push(or()); v = { k: 'l', items }; }
  if (i < toks.length) throw new Error('syntax');
  return v;
}
