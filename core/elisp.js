// A small Emacs Lisp for the functions an init file defines for capture: finding where an entry goes (file+function) and tidying
// the captured text (:prepare-finalize). It runs over a buffer (text and point) and has what those functions use: let, setq, dolist,
// conditionals, format, searching and inserting. A function or form it does not have is an error that names it.
// Written from the Emacs Lisp manual's description; no Emacs source was read.

import { isSym } from './lisp-read.js';
import { emacsRegexp, hasUpper } from './regexp.js';
import { analyze } from './outline.js';

export class ElispError extends Error {}
/** find-file for a file whose text the caller has not given yet; the caller reads it and runs the form again. */
export class NeedFile extends Error { constructor(file) { super(`Need ${file}`); this.file = file; } }
const bad = (m) => { throw new ElispError(m); };
const truthy = (x) => x !== null && x !== false;
const sym = (x) => (isSym(x) ? x.sym : null);
const two = (n) => String(n).padStart(2, '0');
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** format-time-string for the usual conversions; `now` is a Date whose UTC fields are the local time. */
function strftime(fmt, d) {
  const f = { Y: d.getUTCFullYear(), y: two(d.getUTCFullYear() % 100), m: two(d.getUTCMonth() + 1), d: two(d.getUTCDate()), e: String(d.getUTCDate()).padStart(2), H: two(d.getUTCHours()), M: two(d.getUTCMinutes()), S: two(d.getUTCSeconds()),
    a: DAYS[d.getUTCDay()].slice(0, 3), A: DAYS[d.getUTCDay()], b: MONTHS[d.getUTCMonth()].slice(0, 3), B: MONTHS[d.getUTCMonth()], '%': '%' };
  f.F = `${f.Y}-${f.m}-${f.d}`; f.T = `${f.H}:${f.M}:${f.S}`;
  return fmt.replace(/%(.)/g, (all, c) => (c in f ? String(f[c]) : all));
}

/** format: %s %S %d %% with an optional width. */
function format(fmt, args) {
  if (typeof fmt !== 'string') bad('wrong-type-argument stringp');
  let n = 0;
  return fmt.replace(/%(-?\d*)([sSd%])/g, (all, width, c) => {
    if (c === '%') return '%';
    if (n >= args.length) bad('error Not enough arguments for format string');
    const a = args[n++];
    const s = c === 'd' ? String(Math.trunc(Number(a))) : c === 'S' ? show(a, true) : typeof a === 'string' ? a : show(a, false);
    const w = Math.abs(Number(width) || 0);
    return width.startsWith('-') ? s.padEnd(w) : s.padStart(w);
  });
}
const show = (x, quote) => (x === null ? 'nil' : x === true ? 't' : typeof x === 'string' ? (quote ? JSON.stringify(x) : x) : Array.isArray(x) ? `(${x.map((y) => show(y, quote)).join(' ')})` : isSym(x) ? x.sym : String(x));
const regexpQuote = (s) => s.replace(/[[*.\\?+^$]/g, (c) => `\\${c}`);

/**
 * An interpreter over one buffer.
 * @param {string} source the init file text's forms, already read (defuns are taken from them)
 * @param {{ text: string, now?: Date }} init the buffer text; `now` (a Date, or a function that gives one) for format-time-string
 */
/** The local date and time as a Date whose UTC fields hold them. */
const localNow = () => { const n = new Date(); return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate(), n.getHours(), n.getMinutes(), n.getSeconds())); };

export function makeLisp(forms, { now = localNow, files = new Map() } = {}) {
  const defs = new Map();
  let visiting = null; // the file find-file opened
  for (const f of forms) if (Array.isArray(f) && sym(f[0]) === 'defun') defs.set(sym(f[1]), { params: f[2].map(sym), body: f.slice(3) });
  const globals = new Map();
  let buf = { text: '', pt: 1 };
  let match = null; // [[start, end], ...] 1-based, end exclusive
  let steps = 0;

  const at = (p) => buf.text.length + 1 < p || p < 1 ? bad('args-out-of-range') : p - 1;
  const lineStart = (p) => buf.text.lastIndexOf('\n', p - 2) + 2;
  const lineEnd = (p) => { const i = buf.text.indexOf('\n', p - 1); return (i < 0 ? buf.text.length : i) + 1; };
  const num = (x) => (typeof x === 'number' ? x : bad('wrong-type-argument number-or-marker-p'));
  const str = (x) => (typeof x === 'string' ? x : bad('wrong-type-argument stringp'));
  const edit = (from, to, s) => { buf.text = buf.text.slice(0, from - 1) + s + buf.text.slice(to - 1); };

  const search = (forward, args) => {
    const [pattern, bound, noerror, count] = args;
    const re = emacsRegexp(str(pattern), !hasUpper(pattern));
    const sticky = new RegExp(re.source, `${re.flags.replace('g', '')}y`);
    let n = count == null ? 1 : num(count);
    let from = buf.pt;
    for (; n > 0; n--) {
      let found = null;
      if (forward) {
        const limit = bound == null ? buf.text.length + 1 : num(bound);
        if (limit < buf.pt) bad('error Invalid search bound (wrong side of point)');
        const hay = buf.text.slice(0, limit - 1);
        re.lastIndex = from - 1;
        const m = re.exec(hay);
        if (m) found = { s: m.index + 1, e: m.index + 1 + m[0].length, m };
      } else {
        const limit = bound == null ? 1 : num(bound);
        if (limit > buf.pt) bad('error Invalid search bound (wrong side of point)');
        for (let p = from - 1; p >= limit - 1; p--) {
          sticky.lastIndex = p;
          const m = sticky.exec(buf.text.slice(0, from - 1)); // a backward match may not run past where the search began
          if (m) { found = { s: p + 1, e: p + 1 + m[0].length, m }; break; }
        }
      }
      if (!found) {
        if (noerror === null || noerror === undefined || noerror === false) bad(`search-failed ${pattern}`);
        return null;
      }
      match = [[found.s, found.e]];
      if (found.m.indices) found.m.indices.slice(1).forEach((g) => match.push(g ? [g[0] + 1, g[1] + 1] : null));
      buf.pt = forward ? found.e : found.s;
      from = forward ? found.e : found.s;
    }
    return buf.pt;
  };

  const forwardLine = (n = 1) => {
    let moved = 0;
    if (n > 0) { while (moved < n) { const e = buf.text.indexOf('\n', buf.pt - 1); if (e < 0) { buf.pt = buf.text.length + 1; return n - moved; } buf.pt = e + 2; moved++; } return 0; }
    buf.pt = lineStart(buf.pt);
    while (moved < -n) { if (buf.pt <= 1) return -n - moved; buf.pt = lineStart(buf.pt - 1); moved++; }
    return 0;
  };

  const FUNCS = {
    '+': (...a) => a.reduce((x, y) => num(x) + num(y), 0), '*': (...a) => a.reduce((x, y) => num(x) * num(y), 1),
    '-': (...a) => (a.length === 1 ? -num(a[0]) : a.reduce((x, y) => num(x) - num(y))), '/': (...a) => a.reduce((x, y) => Math.trunc(num(x) / num(y))),
    '1+': (a) => num(a) + 1, '1-': (a) => num(a) - 1,
    '=': (a, b) => num(a) === num(b), '<': (a, b) => num(a) < num(b), '>': (a, b) => num(a) > num(b), '<=': (a, b) => num(a) <= num(b), '>=': (a, b) => num(a) >= num(b), '/=': (a, b) => num(a) !== num(b),
    not: (a) => !truthy(a), null: (a) => !truthy(a), equal: (a, b) => show(a, true) === show(b, true), eq: (a, b) => a === b, 'string=': (a, b) => str(a) === str(b),
    cons: (a, b) => (b === null ? [a] : Array.isArray(b) ? [a, ...b] : bad('error Improper lists are not supported')),
    'find-file': (n) => { const name = str(n); if (!files.has(name)) throw new NeedFile(name); buf = { text: files.get(name), pt: 1 }; match = null; visiting = name; return null; },
    'org-find-olp': (path, thisBuffer) => {
      if (!Array.isArray(path) || path.some((x) => typeof x !== 'string')) bad('wrong-type-argument listp');
      let text = buf.text; let names = path;
      if (thisBuffer === undefined || !truthy(thisBuffer)) { const f = path[0]; if (!files.has(f)) throw new NeedFile(f); text = files.get(f); names = path.slice(1); }
      const a = analyze(text);
      let level = 1; let scope = a.heads.filter((h) => h.level === 1); let found = null;
      for (const name of names) {
        found = scope.find((h) => h.title === name);
        if (!found) bad(`error Heading not found on level ${level}: ${name}`);
        level++; scope = found.children;
      }
      if (!found) bad('error No outline path');
      const lines = text.split('\n');
      return lines.slice(0, found.line).reduce((n, l) => n + l.length + 1, 0) + 1;
    },
    list: (...a) => a, car: (a) => (Array.isArray(a) ? a[0] ?? null : null), cdr: (a) => (Array.isArray(a) ? a.slice(1) : null), nth: (n, a) => a?.[n] ?? null, length: (a) => (typeof a === 'string' || Array.isArray(a) ? a.length : 0),
    concat: (...a) => a.map(str).join(''), format: (f, ...a) => format(f, a), 'regexp-quote': (s) => regexpQuote(str(s)), 'make-string': (n, c) => String.fromCodePoint(num(c)).repeat(num(n)),
    'format-time-string': (f) => strftime(str(f), typeof now === 'function' ? now() : now), upcase: (s) => str(s).toUpperCase(), downcase: (s) => str(s).toLowerCase(), 'string-empty-p': (s) => str(s) === '',
    point: () => buf.pt, 'point-min': () => 1, 'point-max': () => buf.text.length + 1,
    'goto-char': (p) => { at(num(p)); buf.pt = p; return p; },
    'forward-line': (n) => forwardLine(n ?? 1), 'beginning-of-line': () => { buf.pt = lineStart(buf.pt); return null; }, 'end-of-line': () => { buf.pt = lineEnd(buf.pt); return null; },
    'line-beginning-position': () => lineStart(buf.pt), 'line-end-position': () => lineEnd(buf.pt),
    bolp: () => buf.pt === 1 || buf.text[buf.pt - 2] === '\n', eolp: () => buf.pt > buf.text.length || buf.text[buf.pt - 1] === '\n', bobp: () => buf.pt === 1, eobp: () => buf.pt > buf.text.length,
    'forward-char': (n = 1) => { const p = buf.pt + n; if (p < 1 || p > buf.text.length + 1) bad('error End of buffer'); buf.pt = p; return null; },
    insert: (...a) => { const s = a.map((x) => (typeof x === 'number' ? String.fromCodePoint(x) : str(x))).join(''); edit(buf.pt, buf.pt, s); buf.pt += s.length; return null; },
    'delete-region': (a, b) => { const [s, e] = [Math.min(a, b), Math.max(a, b)]; at(s); at(e); edit(s, e, ''); if (buf.pt > e) buf.pt -= e - s; else if (buf.pt > s) buf.pt = s; return null; },
    'buffer-substring': (a, b) => buf.text.slice(Math.min(a, b) - 1, Math.max(a, b) - 1), 'buffer-substring-no-properties': (a, b) => buf.text.slice(Math.min(a, b) - 1, Math.max(a, b) - 1),
    'char-after': (p = buf.pt) => (p >= 1 && p <= buf.text.length ? buf.text.codePointAt(p - 1) : null),
    're-search-forward': (...a) => search(true, a), 're-search-backward': (...a) => search(false, a),
    'search-forward': (s, ...r) => search(true, [regexpQuote(str(s)), ...r]), 'search-backward': (s, ...r) => search(false, [regexpQuote(str(s)), ...r]),
    'looking-at': (p) => { const re0 = emacsRegexp(str(p), !hasUpper(p)); const re = new RegExp(re0.source, `${re0.flags.replace('g', '')}y`); re.lastIndex = buf.pt - 1; const m = re.exec(buf.text); if (m) { match = [[buf.pt, buf.pt + m[0].length]]; return true; } return null; },
    'match-beginning': (n) => match?.[n]?.[0] ?? null, 'match-end': (n) => match?.[n]?.[1] ?? null,
    'match-string': (n) => (match?.[n] ? buf.text.slice(match[n][0] - 1, match[n][1] - 1) : null),
    'replace-match': (s) => { if (!match) bad('error replace-match called before any match found'); const [a, b] = match[0]; const r = str(s); edit(a, b, r); buf.pt = a + r.length; match = [[a, a + r.length]]; return null; },
    'flush-lines': (p) => {
      const re = emacsRegexp(str(p), !hasUpper(p));
      let from = buf.pt; if (from > 1 && buf.text[from - 2] !== '\n') from = lineEnd(from) + 1;
      for (;;) {
        re.lastIndex = from - 1;
        const m = from <= buf.text.length ? re.exec(buf.text) : null;
        if (!m) return null;
        const s = lineStart(m.index + 1); const e = Math.min(lineEnd(m.index + 1) + 1, buf.text.length + 1);
        edit(s, e, '');
        from = s;
      }
    },
  };

  const evalBody = (forms, env) => { let r = null; for (const f of forms) r = ev(f, env); return r; };
  const lookup = (name, env) => { for (let e = env; e; e = e.up) if (e.vars.has(name)) return e; return null; };
  const bind = (list, env, sequential) => {
    const inner = { vars: new Map(), up: env };
    for (const b of list ?? []) {
      const [name, init] = Array.isArray(b) ? [sym(b[0]), b[1]] : [sym(b), null];
      inner.vars.set(name, init === undefined ? null : ev(init, sequential ? inner : env));
    }
    return inner;
  };

  const SPECIAL = {
    quote: (a) => a[0], progn: (a, env) => evalBody(a, env),
    if: (a, env) => (truthy(ev(a[0], env)) ? ev(a[1], env) : evalBody(a.slice(2), env)),
    when: (a, env) => (truthy(ev(a[0], env)) ? evalBody(a.slice(1), env) : null), unless: (a, env) => (truthy(ev(a[0], env)) ? null : evalBody(a.slice(1), env)),
    and: (a, env) => { let r = true; for (const f of a) { r = ev(f, env); if (!truthy(r)) return null; } return r; },
    or: (a, env) => { for (const f of a) { const r = ev(f, env); if (truthy(r)) return r; } return null; },
    cond: (a, env) => { for (const c of a) { const t = ev(c[0], env); if (truthy(t)) return c.length > 1 ? evalBody(c.slice(1), env) : t; } return null; },
    let: (a, env) => evalBody(a.slice(1), bind(a[0], env, false)), 'let*': (a, env) => evalBody(a.slice(1), bind(a[0], env, true)),
    setq: (a, env) => { let v = null; for (let i = 0; i < a.length; i += 2) { const n = sym(a[i]); v = ev(a[i + 1], env); (lookup(n, env)?.vars ?? globals).set(n, v); } return v; },
    while: (a, env) => { while (truthy(ev(a[0], env))) { if (++steps > 100000) bad('error Too many steps'); evalBody(a.slice(1), env); } return null; },
    dolist: (a, env) => {
      const [v, list] = a[0]; const items = ev(list, env);
      if (items !== null && !Array.isArray(items)) bad('wrong-type-argument listp');
      for (const x of items ?? []) evalBody(a.slice(1), { vars: new Map([[sym(v), x]]), up: env });
      return null;
    },
    'save-excursion': (a, env) => { const pt = buf.pt; try { return evalBody(a, env); } finally { buf.pt = Math.min(pt, buf.text.length + 1); } },
    'save-restriction': (a, env) => evalBody(a, env), 'save-match-data': (a, env) => evalBody(a, env),
    defun: (a) => { defs.set(sym(a[0]), { params: a[1].map(sym), body: a.slice(2) }); return a[0]; },
    defvar: (a, env) => { const n = sym(a[0]); if (a.length > 1 && !globals.has(n)) globals.set(n, ev(a[1], env)); return a[0]; },
    'add-to-list': (a, env) => {
      const n = sym(ev(a[0], env)); const el = ev(a[1], env); const append = a[2] === undefined ? null : ev(a[2], env);
      const cur = globals.get(n) ?? null;
      if (cur !== null && !Array.isArray(cur)) bad('wrong-type-argument listp');
      const same = (x) => JSON.stringify(x) === JSON.stringify(el);
      const next = (cur ?? []).some(same) ? cur : truthy(append) ? [...(cur ?? []), el] : [el, ...(cur ?? [])];
      globals.set(n, next);
      return next;
    },
  };
  SPECIAL['setq-default'] = SPECIAL.setq;
  // easy-menu-define SYMBOL MAPS DOC MENU: the menu is kept as data; it is not attached to a keymap
  // Features the app implements load silently; any other feature is reported as not supported
  const FEATURES = new Set(['org', 'org-capture', 'org-agenda', 'org-clock', 'org-table', 'org-element', 'ol', 'cl-lib', 'subr-x', 'seq', 'easymenu']);
  SPECIAL.require = (a, env) => { const f = sym(ev(a[0], env)); if (!FEATURES.has(f)) throw new Error(`void-function ${f === 'transient' ? 'require transient' : `require ${f}`}`); return ev(a[0], env); };
  SPECIAL['easy-menu-define'] = (a, env) => { const n = sym(a[0]); globals.set(n, ev(a[3], env)); return a[0]; };

  function ev(form, env) {
    if (form === null || form === true || typeof form === 'number' || typeof form === 'string') return form;
    if (isSym(form)) {
      const n = form.sym;
      if (n.startsWith(':')) return form;
      if (/^\?.$/u.test(n)) return n.codePointAt(1);
      const e = lookup(n, env);
      if (e) return e.vars.get(n);
      if (globals.has(n)) return globals.get(n);
      if (n === 'nil') return null;
      return bad(`void-variable ${n}`);
    }
    if (form.quote !== undefined) return form.quote;
    if (!Array.isArray(form)) return bad('invalid-function');
    const head = sym(form[0]);
    if (head === null) return bad('invalid-function');
    if (++steps > 200000) bad('error Too many steps');
    if (SPECIAL[head]) return SPECIAL[head](form.slice(1), env);
    const args = form.slice(1).map((x) => ev(x, env));
    if (FUNCS[head]) return FUNCS[head](...args);
    const d = defs.get(head);
    if (d) {
      const vars = new Map(); let mode = 'req'; let k = 0;
      for (const p of d.params) { if (p === '&optional' || p === '&rest') { mode = p; continue; } if (mode === '&rest') { vars.set(p, args.slice(k).length ? args.slice(k) : null); k = args.length; } else vars.set(p, args[k++] ?? null); }
      const frame = { vars, up: null };
      return evalBody(d.body.filter((x, i) => !(i === 0 && typeof x === 'string' && d.body.length > 1)), frame);
    }
    return bad(`void-function ${head}`);
  }

  return {
    has: (name) => defs.has(name),
    /** Evaluates one top-level form (setq, defun, add-to-list and the rest) with variables kept between calls. */
    evaluate(form) { steps = 0; return ev(form, null); },
    /** Runs a form in a buffer that find-file may switch; returns its value and the file and point it ended at. May throw NeedFile. */
    run(form) { steps = 0; visiting = null; buf = { text: '', pt: 1 }; match = null; const value = ev(form, null); return { value, file: visiting, point: buf.pt, text: buf.text }; },
    /** The value of a global variable, or undefined when nothing has set it. */
    get: (name) => globals.get(name),
    /** Runs the function NAME (no arguments) in a buffer; returns the new text and where point is, 1-based. */
    call(name, text, pt = 1) {
      if (!defs.has(name)) bad(`void-function ${name}`);
      buf = { text, pt }; match = null; steps = 0;
      evalBody([[{ sym: name }]], null);
      return { text: buf.text, point: buf.pt };
    },
  };
}
