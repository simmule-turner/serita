// Emacs regexp syntax, translated to a JavaScript RegExp. Written from the Emacs Lisp manual's description of the syntax and from
// observed Emacs results; no Emacs source was read. Constructs this cannot express (categories, numbered shy groups, \=) are errors.

const WORD = '\\p{L}\\p{N}';
const SYMBOL = '\\p{L}\\p{N}_';
const SPECIAL = new Set([...'^$\\.*+?()[]{}|/']);
const lit = (c) => (SPECIAL.has(c) ? `\\${c}` : c);

const CLASSES = {
  alpha: '\\p{L}', digit: '0-9', alnum: '\\p{L}\\p{N}', upper: '\\p{Lu}', lower: '\\p{Ll}', space: '\\s', blank: ' \\t',
  punct: '\\p{P}\\p{S}', word: WORD, xdigit: '0-9A-Fa-f', cntrl: '\\x00-\\x1f\\x7f', print: '\\x20-\\x7e\\u00a0-\\u{10ffff}',
  graph: '\\x21-\\x7e\\u00a1-\\u{10ffff}', ascii: '\\x00-\\x7f', nonascii: '\\u0080-\\u{10ffff}', multibyte: '\\u0080-\\u{10ffff}', unibyte: '\\x00-\\x7f',
};
const SYNTAX = { '-': '\\s', ' ': '\\s', w: WORD, _: SYMBOL, '.': '\\p{P}\\p{S}' };
const inClass = (set, negate) => `[${negate ? '^' : ''}${set}]`;
const boundary = (set) => ({
  start: `(?<![${set}])(?=[${set}])`,
  end: `(?<=[${set}])(?![${set}])`,
});

/** Does the pattern contain an uppercase letter that is not part of an escape? Emacs then searches with exact case. */
export const hasUpper = (pattern) => /\p{Lu}/u.test(pattern.replace(/\\./gsu, ''));

/** The characters of a bracket expression starting after its `[`: returns { source, next }. */
function bracket(p, i) {
  let negate = false;
  if (p[i] === '^') { negate = true; i++; }
  let set = '';
  let first = true;
  while (i < p.length) {
    const c = p[i];
    if (c === ']' && !first) return { source: inClass(set, negate), next: i + 1 };
    first = false;
    if (c === '[' && p[i + 1] === ':') {
      const end = p.indexOf(':]', i + 2);
      const name = end < 0 ? null : p.slice(i + 2, end);
      if (name !== null && /^[a-z]+$/.test(name)) {
        if (!(name in CLASSES)) throw new Error('Invalid character class name');
        set += CLASSES[name];
        i = end + 2;
        continue;
      }
    }
    // A range a-b; a dash at the start or end is itself.
    if (p[i + 1] === '-' && p[i + 2] !== undefined && p[i + 2] !== ']') {
      const lo = c;
      const hi = p[i + 2];
      if (lo.codePointAt(0) > hi.codePointAt(0)) throw new Error('Invalid range end');
      set += `${esc(lo)}-${esc(hi)}`;
      i += 3;
      continue;
    }
    set += esc(c);
    i++;
  }
  throw new Error('Unmatched [ or [^');
}
const esc = (c) => (/[\\\]\[^-]/.test(c) ? `\\${c}` : c);

/**
 * @param {string} pattern  an Emacs regexp
 * @param {boolean} fold    ignore case
 * @returns {RegExp}        global, multiline and Unicode
 */
export function emacsRegexp(pattern, fold = true) {
  const p = pattern;
  let out = '';
  let i = 0;
  let groups = 0;
  const open = []; // the groups that are open, by their number or null for a shy group
  const closed = new Set();
  let atStart = true; // at the start of the pattern, of a group or of an alternative: * + ? ^ mean something else here
  const lastAtomStart = [];
  let atom = null;    // where the latest atom began in `out`, for the postfix operators
  const push = (s, isAtom = true) => { if (isAtom) atom = out.length; out += s; atStart = false; };
  while (i < p.length) {
    const c = p[i];
    if (c === '\\') {
      const d = p[i + 1];
      if (d === undefined) throw new Error('Trailing backslash');
      i += 2;
      if (d === '(') {
        let capture = true;
        if (p[i] === '?') {
          const m = /^\?(\d*):/.exec(p.slice(i));
          if (!m) throw new Error('Invalid regular expression');
          if (m[1] !== '') throw new Error('Numbered groups are not supported');
          capture = false;
          i += m[0].length;
        }
        if (capture) groups++;
        open.push({ n: capture ? groups : null, at: out.length });
        out += capture ? '(' : '(?:';
        atStart = true;
        atom = null;
      } else if (d === ')') {
        const g = open.pop();
        if (!g) throw new Error('Unmatched ) or \\)');
        out += ')';
        if (g.n !== null) closed.add(g.n);
        atom = g.at;
        atStart = false;
      } else if (d === '|') { out += '|'; atStart = true; atom = null; }
      else if (d === '{') {
        const end = p.indexOf('\\}', i);
        if (end < 0) throw new Error('Unmatched \\{');
        const m = /^(\d*)(,?)(\d*)$/.exec(p.slice(i, end));
        if (!m) throw new Error('Invalid content of \\{\\}');
        if (atom === null) throw new Error('Invalid preceding regular expression');
        const lo = m[1] === '' ? '0' : m[1];
        out += m[2] === '' ? `{${lo}}` : `{${lo},${m[3]}}`;
        i = end + 2;
      } else if (/[1-9]/.test(d)) {
        if (!closed.has(Number(d))) throw new Error('Invalid back reference');
        push(`\\${d}`);
      } else if (d === 'w') push(`[${WORD}]`);
      else if (d === 'W') push(`[^${WORD}]`);
      else if (d === 's' || d === 'S') {
        const code = p[i++];
        if (code === undefined || !(code in SYNTAX)) throw new Error('Invalid syntax designator');
        push(inClass(SYNTAX[code], d === 'S'));
      } else if (d === '`') push('(?<![\\s\\S])', false);
      else if (d === "'") push('(?![\\s\\S])', false);
      else if (d === '<') push(boundary(WORD).start, false);
      else if (d === '>') push(boundary(WORD).end, false);
      else if (d === 'b') push(`(?:${boundary(WORD).start}|${boundary(WORD).end})`, false);
      else if (d === 'B') push(`(?:(?<=[${WORD}])(?=[${WORD}])|(?<![${WORD}])(?![${WORD}]))`, false);
      else if (d === '_') {
        const e = p[i++];
        if (e === '<') push(boundary(SYMBOL).start, false);
        else if (e === '>') push(boundary(SYMBOL).end, false);
        else throw new Error('Invalid regular expression');
      } else if (d === 'c' || d === 'C' || d === '=') throw new Error('Not supported in this regexp syntax');
      else push(lit(d));
      continue;
    }
    i++;
    if (c === '[') { const b = bracket(p, i); i = b.next; push(b.source); }
    else if (c === '.') push('[^\\n]');
    else if (c === '*' || c === '+' || c === '?') {
      if (atStart || atom === null) push(lit(c));
      else {
        let op = c;
        if (p[i] === '?') { op += '?'; i++; }
        out += op;
      }
    } else if (c === '^') { if (atStart) { out += '^'; } else push('\\^'); }
    else if (c === '$') {
      const rest = p.slice(i);
      if (rest === '' || rest.startsWith('\\)') || rest.startsWith('\\|')) out += '$';
      else push('\\$');
    } else push(lit(c));
  }
  if (open.length) throw new Error('Unmatched ( or \\(');
  return new RegExp(out, `gmu${fold ? 'i' : ''}`);
}
