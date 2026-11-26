// The arithmetic of table formulas: exact integers and fractions (BigInt), decimal numbers kept to a working precision, and the
// expression language of Emacs Calc's algebraic entry that Org hands formulas to. Pure: values in, text out.
//
// Values: { k: 'q', n, d }       an integer (d = 1n) or an exact fraction
//         { k: 'f', m, e }       the decimal m x 10^e, m rounded to `prec` digits
//         { k: 'v', items }      a vector
//         { k: 's', text }       an expression Calc leaves as it is (1/0, foo(1))

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
export const nowForm = () => { const n = new Date(); return dateForm(n.getFullYear(), n.getMonth() + 1, n.getDate(), n.getHours(), n.getMinutes(), n.getSeconds()); };

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
export function radixText(x, base, digits) {
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
  const room = Math.max(0, digits - (whole === 0n ? 0 : w.length));
  let kept = 0;
  while (kept < room && rest !== 0n) { rest *= B; const dg = rest / d; fr += Number(dg).toString(36).toUpperCase(); rest %= d; if (whole !== 0n || dg !== 0n || kept > 0) kept++; }
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
      if (opts.mode === 'fix') return fixed(x, opts.digits);
      if (opts.mode === 'sci') return sci(x, opts.digits);
      if (opts.radix && opts.radix !== 10) return radixText(x, opts.radix, opts.digits);
      return floatText(x, opts.mode === 'eng' ? { ...opts, digits: opts.digits } : opts);
    }
    case 'v': return `[${x.items.map((i) => text(i, opts)).join(', ')}]`;
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

const TOKEN = /\s*(?:([<[]\d{4}-\d\d-\d\d(?: [A-Za-z]+)?(?: \d\d:\d\d(?::\d\d)?)?[>\]])|(\d+#[0-9a-zA-Z]+(?:\.[0-9a-zA-Z]*)?|\d+:\d+(?![\d.eE]))|(\d*\.\d+(?:[eE][-+]?\d+)?|\d+\.?(?:[eE][-+]?\d+)?|\d+\.)|([A-Za-z_][A-Za-z_0-9]*)|(&&|\|\||==|!=|<=|>=|[-+*/^%(),<>!\[\]]))/y;

function tokens(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    if (/^\s*$/.test(src.slice(i))) break;
    TOKEN.lastIndex = i;
    const m = TOKEN.exec(src);
    if (!m) throw new Error('syntax');
    out.push(m[1] ? { t: 'date', v: m[1] } : m[2] ? { t: 'num', v: m[2] } : m[3] ? { t: 'num', v: m[3] } : m[4] ? { t: 'id', v: m[4] } : { t: 'op', v: m[5] });
    i = TOKEN.lastIndex;
  }
  return out;
}

const FUNCS = {
  sqrt: (a, p) => sqrt(a, p), abs: (a) => (sign(a) < 0 ? neg(a) : a), floor: (a, p) => floor(a, p), round: (a, p) => round(a, p),
  ceil: (a, p) => neg(floor(neg(a), p)), trunc: (a, p) => (sign(a) < 0 ? neg(floor(neg(a), p)) : floor(a, p)),
  exp: (a, p) => fromNumber(Math.exp(toNumber(a)), p), ln: (a, p) => fromNumber(Math.log(toNumber(a)), p),
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

/**
 * Evaluates the text of a formula. `prec` is the working precision. Throws an Error('syntax') for what Calc cannot read.
 * @param {string} src @param {{ prec?: number }} [opts]
 */
export function evaluate(src, { prec = DEFAULTS.prec, angle = 'deg', frac: fractions = false } = {}) {
  const toks = tokens(src);
  let i = 0;
  const peek = () => toks[i];
  const eat = (v) => { if (toks[i]?.t === 'op' && toks[i].v === v) { i++; return true; } return false; };
  const need = (v) => { if (!eat(v)) throw new Error('syntax'); };
  const arith = (f, ...xs) => (xs.every(numeric) ? f(...xs, prec) : { k: 's', text: 'nan' });
  const binary = (op, a, b) => {
    if (a.k === 'd' || b.k === 'd') {
      if (op === '-' && a.k === 'd' && b.k === 'd') return sub(a.v, b.v, prec);
      if ((op === '+' || op === '-') && a.k === 'd' && numeric(b)) return { k: 'd', v: op === '+' ? add(a.v, b, prec) : sub(a.v, b, prec) };
      if (op === '+' && numeric(a) && b.k === 'd') return { k: 'd', v: add(b.v, a, prec) };
      if (['<', '>', '<=', '>=', '==', '!='].includes(op) && a.k === b.k) return binary(op, a.v, b.v);
      return { k: 's', text: `${text(a)} ${op} ${text(b)}` };
    }
    if (!numeric(a) || !numeric(b)) {
      if (a.k === 'v' || b.k === 'v') throw new Error('syntax');
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
    if (t.t === 'num') {
      const v = parseNumber(t.v, prec);
      if (!v) throw new Error('syntax');
      return v;
    }
    if (t.t === 'op') {
      if (t.v === '(') { const v = or(); need(')'); return v; }
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
    if (VEC[name]) {
      const xs = flat(args);
      if (!xs.every(numeric)) throw new Error('syntax');
      if (!xs.length) { if (name === 'vsum' || name === 'vcount') return int(0); if (name === 'vprod') return int(1); throw new Error('syntax'); }
      return VEC[name](xs, prec);
    }
    if (TRIG[name] && args.length === 1) return numeric(args[0]) ? trig(name, args[0], prec, angle) : { k: 's', text: `${name}(${text(args[0])})` };
    if (FUNCS[name] && args.length === 1) return numeric(args[0]) ? FUNCS[name](args[0], prec) : { k: 's', text: `${name}(${text(args[0])})` };
    if ((name === 'min' || name === 'max') && args.length) { const xs = flat(args); return VEC[name === 'min' ? 'vmin' : 'vmax'](xs, prec); }
    if (name === 'date') {
      if (args.length === 1 && args[0].k === 'd') return args[0].v.d === 1n ? int(args[0].v.n / args[0].v.d) : args[0].v;
      if (args.length >= 3 && args.every((a) => a.k === 'q' && a.d === 1n)) return dateForm(...args.map((a) => Number(a.n)));
      throw new Error('syntax');
    }
    if (name === 'now' && !args.length) return nowForm();
    if (name === 'if' && args.length === 3) return isZero(args[0]) ? args[2] : args[1];
    return { k: 's', text: `${name}(${args.map((a) => text(a)).join(', ')})` };
  };
  const unary = () => { if (eat('-')) return neg(unary()); if (eat('+')) return unary(); if (eat('!')) return bool(isZero(unary())); return power(); };
  const power = () => { const a = primary(); return eat('^') ? binary('^', a, unary()) : a; };
  const mulDiv = level(['*', '/', '%'], unary);
  const sum = level(['+', '-'], mulDiv);
  const compare = level(['<', '>', '<=', '>=', '==', '!='], sum);
  const and = level(['&&'], compare);
  const or = level(['||'], and);
  const v = or();
  if (i < toks.length) throw new Error('syntax');
  return v;
}
