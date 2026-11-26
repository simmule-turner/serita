// The Emacs Lisp a '(...) table formula can use: arithmetic and comparison, strings, format, conditionals, and times.
// A small evaluator over core/lisp-read.js; integers are BigInt, floats are numbers, nil is null and t is true.
// A function it does not have is an error, which the table shows as #ERROR.

import { readForms, isSym } from './lisp-read.js';

class LispError extends Error {}
const bad = (m) => { throw new LispError(m); };

const isInt = (x) => typeof x === 'bigint';
const isNum = (x) => isInt(x) || typeof x === 'number';
const num = (x) => (isInt(x) ? Number(x) : x);
const need = (x) => (isNum(x) ? x : bad('wrong-type-argument number-or-marker-p'));
const str = (x) => (typeof x === 'string' ? x : bad('wrong-type-argument stringp'));
const truthy = (x) => x !== null && x !== false;
const isTime = (x) => x !== null && typeof x === 'object' && !Array.isArray(x) && 'time' in x;

const arith = (op, xs) => {
  xs = xs.map(need);
  const floats = xs.some((x) => !isInt(x));
  if (!floats) {
    const f = { '+': (a, b) => a + b, '-': (a, b) => a - b, '*': (a, b) => a * b, '/': (a, b) => (b === 0n ? bad('arith-error') : a / b) };
    if (op === '-' && xs.length === 1) return -xs[0];
    return xs.reduce(f[op]);
  }
  const f = { '+': (a, b) => a + b, '-': (a, b) => a - b, '*': (a, b) => a * b, '/': (a, b) => a / b };
  const ns = xs.map(num);
  if (op === '-' && ns.length === 1) return -ns[0];
  return ns.reduce(f[op]);
};
const compare = (op, xs) => {
  const ns = xs.map((x) => num(need(x)));
  for (let i = 0; i + 1 < ns.length; i++) {
    const [a, b] = [ns[i], ns[i + 1]];
    const t = { '<': a < b, '>': a > b, '<=': a <= b, '>=': a >= b, '=': a === b, '/=': a !== b }[op];
    if (!t) return null;
  }
  return true;
};

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A time (seconds since 1970) from the text of a date: 2026-11-26, 2026-11-26 13:45[:10], with or without <> and a day name. Local time. */
function dateToTime(s) {
  const m = /^\s*[<[]?(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+[A-Za-z]+\.?)?(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?[>\]]?\s*$/.exec(s);
  if (!m) bad('error Invalid date');
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0));
  return { time: Math.floor(d.getTime() / 1000) };
}

/** format-time-string for the usual conversions. */
function formatTime(fmt, t, utc) {
  const secs = t === null ? Math.floor(Date.now() / 1000) : isTime(t) ? t.time : Number(need(t));
  const d = new Date(secs * 1000);
  const g = utc ? { y: d.getUTCFullYear(), mo: d.getUTCMonth(), day: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds(), wd: d.getUTCDay() }
    : { y: d.getFullYear(), mo: d.getMonth(), day: d.getDate(), h: d.getHours(), mi: d.getMinutes(), s: d.getSeconds(), wd: d.getDay() };
  const two = (n) => String(n).padStart(2, '0');
  const yday = Math.round((Date.UTC(g.y, g.mo, g.day) - Date.UTC(g.y, 0, 1)) / 86400000) + 1;
  const week = (first) => Math.floor((yday - 1 + 7 - ((g.wd - first + 7) % 7)) / 7);
  const offset = utc ? 0 : -d.getTimezoneOffset();
  const out = {
    Y: g.y, m: two(g.mo + 1), d: two(g.day), H: two(g.h), M: two(g.mi), S: two(g.s), y: two(g.y % 100), e: String(g.day).padStart(2, ' '),
    j: String(yday).padStart(3, '0'), a: DAYS[g.wd].slice(0, 3), A: DAYS[g.wd], b: MONTHS[g.mo].slice(0, 3), B: MONTHS[g.mo], h: MONTHS[g.mo].slice(0, 3),
    I: two(g.h % 12 || 12), p: g.h < 12 ? 'AM' : 'PM', s: String(secs), u: String(g.wd || 7), w: String(g.wd), U: two(week(0)), W: two(week(1)),
    F: `${g.y}-${two(g.mo + 1)}-${two(g.day)}`, T: `${two(g.h)}:${two(g.mi)}:${two(g.s)}`, R: `${two(g.h)}:${two(g.mi)}`, '%': '%',
    z: `${offset < 0 ? '-' : '+'}${two(Math.floor(Math.abs(offset) / 60))}${two(Math.abs(offset) % 60)}`, Z: utc ? 'UTC' : '',
  };
  return str(fmt).replace(/%([A-Za-z%])/g, (all, c) => (c in out ? String(out[c]) : all));
}

/** format for %s %d %f %x %o %e %g %c %% with flags, width and precision. */
function format(fmt, args) {
  let i = 0;
  return str(fmt).replace(/%([-+ 0#]*)(\d*)(?:\.(\d+))?([sdfxXoecg%])/g, (all, fl, width, precision, conv) => {
    if (conv === '%') return '%';
    const a = args[i++];
    let body;
    if (conv === 's') body = typeof a === 'string' ? a : print(a);
    else if (conv === 'd') body = String(isInt(a) ? a : BigInt(Math.trunc(num(need(a)))));
    else if (conv === 'f') body = num(need(a)).toFixed(precision === undefined ? 6 : Number(precision));
    else if (conv === 'e') body = num(need(a)).toExponential(precision === undefined ? 6 : Number(precision)).replace(/e([-+])(\d)$/, 'e$10$2');
    else if (conv === 'g') body = String(Number(num(need(a)).toPrecision(precision === undefined ? 6 : Number(precision) || 1)));
    else if (conv === 'c') body = String.fromCodePoint(Number(a));
    else { const n = BigInt(Math.trunc(num(need(a)))); body = (n < 0n ? -n : n).toString(conv === 'o' ? 8 : 16); if (conv === 'X') body = body.toUpperCase(); if (n < 0n) body = `-${body}`; }
    if (fl.includes('+') && !body.startsWith('-') && 'dfeg'.includes(conv)) body = `+${body}`;
    const w = Number(width || 0);
    if (body.length < w) body = fl.includes('-') ? body.padEnd(w) : fl.includes('0') && conv !== 's' ? (/^[-+]/.test(body) ? body[0] + body.slice(1).padStart(w - 1, '0') : body.padStart(w, '0')) : body.padStart(w);
    return body;
  });
}

/** How Lisp prints a value, as a table cell shows it. */
export function print(x) {
  if (x === null) return 'nil';
  if (x === true) return 't';
  if (isInt(x)) return x.toString();
  if (typeof x === 'number') return Number.isInteger(x) ? `${x}.0` : String(x);
  if (typeof x === 'string') return x;
  return bad('a value a field cannot show');
}

const toNumber = (s) => { const m = /^\s*([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)/i.exec(s); if (!m) return 0n; return /[.e]/i.test(m[1]) ? Number(m[1]) : BigInt(m[1]); };

const FUNCS = {
  '+': (a) => arith('+', a), '-': (a) => arith('-', a), '*': (a) => arith('*', a), '/': (a) => arith('/', a),
  '<': (a) => compare('<', a), '>': (a) => compare('>', a), '<=': (a) => compare('<=', a), '>=': (a) => compare('>=', a), '=': (a) => compare('=', a), '/=': (a) => compare('/=', a),
  '1+': ([a]) => arith('+', [a, 1n]), '1-': ([a]) => arith('-', [a, 1n]),
  mod: ([a, b]) => (isInt(a) && isInt(b) ? (b === 0n ? bad('arith-error') : ((a % b) + b) % b) : num(a) - num(b) * Math.floor(num(a) / num(b))),
  abs: ([a]) => (isInt(need(a)) ? (a < 0n ? -a : a) : Math.abs(a)),
  max: (a) => a.map(need).reduce((p, c) => (num(c) > num(p) ? c : p)), min: (a) => a.map(need).reduce((p, c) => (num(c) < num(p) ? c : p)),
  floor: ([a]) => BigInt(Math.floor(num(need(a)))), ceiling: ([a]) => BigInt(Math.ceil(num(need(a)))), truncate: ([a]) => BigInt(Math.trunc(num(need(a)))),
  round: ([a]) => { const v = num(need(a)); const r = Math.round(v); return BigInt(Math.abs(v % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r); },
  float: ([a]) => num(need(a)), sqrt: ([a]) => Math.sqrt(num(need(a))), expt: ([a, b]) => (isInt(a) && isInt(b) && b >= 0n ? a ** b : num(a) ** num(b)),
  concat: (a) => a.map(str).join(''), upcase: ([s]) => str(s).toUpperCase(), downcase: ([s]) => str(s).toLowerCase(),
  capitalize: ([s]) => str(s).toLowerCase().replace(/(^|[^A-Za-z0-9])([a-z])/g, (m, p, c) => p + c.toUpperCase()),
  length: ([s]) => BigInt(typeof s === 'string' ? [...s].length : Array.isArray(s) ? s.length : bad('wrong-type-argument sequencep')),
  substring: ([s, from, to]) => { const cs = [...str(s)]; const n = cs.length; const f = Number(from ?? 0n); const t = to === undefined || to === null ? n : Number(to); return cs.slice(f < 0 ? n + f : f, t < 0 ? n + t : t).join(''); },
  'string-to-number': ([s]) => toNumber(str(s)), 'number-to-string': ([n]) => print(need(n)), 'string-trim': ([s]) => str(s).trim(),
  'string=': ([a, b]) => a === b || null, equal: ([a, b]) => a === b || null, 'string-prefix-p': ([p, s]) => str(s).startsWith(str(p)) || null,
  identity: ([a]) => a, list: (a) => a, format: ([f, ...a]) => format(f, a), not: ([a]) => (truthy(a) ? null : true), null: ([a]) => (a === null ? true : null),
  'date-to-time': ([s]) => dateToTime(str(s)), 'time-add': ([a, b]) => ({ time: (isTime(a) ? a.time : num(a)) + (isTime(b) ? b.time : num(b)) }),
  'time-subtract': ([a, b]) => { const d = (isTime(a) ? a.time : num(a)) - (isTime(b) ? b.time : num(b)); return isTime(b) ? d : { time: d }; },
  'float-time': ([t]) => (t === undefined || t === null ? Date.now() / 1000 : t.time), 'current-time': () => ({ time: Math.floor(Date.now() / 1000) }),
  'format-time-string': ([f, t, utc]) => formatTime(f, t ?? null, truthy(utc ?? null)),
};

function evalForm(x, env) {
  if (typeof x === 'bigint' || typeof x === 'number' || typeof x === 'string' || x === true || x === null) return x;
  if (x === false) return null;
  if (isSym(x)) {
    if (x.sym === 'nil') return null;
    if (x.sym === 't') return true;
    if (env.has(x.sym)) return env.get(x.sym);
    return bad(`void-variable ${x.sym}`);
  }
  if (x && !Array.isArray(x) && 'quote' in x) return x.quote === null || (Array.isArray(x.quote) && !x.quote.length) ? null : x.quote;
  if (!Array.isArray(x)) return bad('invalid form');
  if (!x.length) return null;
  const head = x[0];
  if (!isSym(head)) return bad('invalid-function');
  const name = head.sym;
  switch (name) {
    case 'if': return truthy(evalForm(x[1], env)) ? evalForm(x[2], env) : x.slice(3).reduce((_, f) => evalForm(f, env), null);
    case 'when': return truthy(evalForm(x[1], env)) ? x.slice(2).reduce((_, f) => evalForm(f, env), null) : null;
    case 'unless': return truthy(evalForm(x[1], env)) ? null : x.slice(2).reduce((_, f) => evalForm(f, env), null);
    case 'progn': return x.slice(1).reduce((_, f) => evalForm(f, env), null);
    case 'and': { let v = true; for (const f of x.slice(1)) { v = evalForm(f, env); if (!truthy(v)) return null; } return v; }
    case 'or': { for (const f of x.slice(1)) { const v = evalForm(f, env); if (truthy(v)) return v; } return null; }
    case 'let': { const inner = new Map(env); for (const b of x[1]) { if (Array.isArray(b)) inner.set(b[0].sym, evalForm(b[1], env)); else inner.set(b.sym, null); } return x.slice(2).reduce((_, f) => evalForm(f, inner), null); }
    default: {
      const f = FUNCS[name];
      if (!f) return bad(`void-function ${name}`);
      return f(x.slice(1).map((a) => evalForm(a, env)));
    }
  }
}

/** Evaluates the text of a Lisp form and returns the text a field shows. Throws on an error. */
export function evalLisp(src) {
  const forms = readForms(src, { integers: true });
  if (forms.length !== 1) bad('one form expected');
  return print(evalForm(forms[0], new Map()));
}
