// Lossless line-based Org parser.
// Every line keeps its exact text and line ending, so serialize(parse(t)) === t.
// Structure (headline tree, line kinds) is derived from the text and never rewrites it.

/**
 * @typedef {{ text: string, eol: string }} Line
 * @typedef {{ type: string, line: Line, children?: Node[], [k: string]: any }} Node
 * @typedef {{ type: 'root', children: Node[] }} Root
 * @typedef {{ todo?: { open: string[], done: string[] } }} ParseOptions
 */

export const DEFAULT_TODO = Object.freeze({ open: ['TODO'], done: ['DONE'] });

/**
 * Split text into lines. "\n" and "\r\n" end a line; the final line may have no ending.
 * @param {string} text
 * @returns {Line[]}
 */
export function splitLines(text) {
  const lines = [];
  let start = 0;
  while (start < text.length) {
    const nl = text.indexOf('\n', start);
    if (nl === -1) { lines.push({ text: text.slice(start), eol: '' }); break; }
    const crlf = nl > start && text[nl - 1] === '\r';
    lines.push({ text: text.slice(start, crlf ? nl - 1 : nl), eol: crlf ? '\r\n' : '\n' });
    start = nl + 1;
  }
  return lines;
}

export const TAGS = /(?:^|[ \t]+)(:[\p{L}\p{N}_@#%]+(?::[\p{L}\p{N}_@#%]+)*:)[ \t]*$/u;
const PRIORITY = /^\[#([A-Z0-9])\](?: +|$)/;

/**
 * Break a headline's text after the stars into its parts.
 * @param {string} rest
 * @param {{ open: string[], done: string[] }} kw
 */
function headlineParts(rest, kw) {
  let s = rest;
  let todo = null;
  const first = /^(\S+)(?: +|$)/.exec(s);
  if (first && (kw.open.includes(first[1]) || kw.done.includes(first[1]))) {
    todo = first[1];
    s = s.slice(first[0].length);
  }
  let priority = null;
  const p = PRIORITY.exec(s);
  if (p) { priority = p[1]; s = s.slice(p[0].length); }
  let comment = false;
  const c = /^COMMENT(?: +|$)/.exec(s);
  if (c) { comment = true; s = s.slice(c[0].length); }
  let tags = [];
  const t = TAGS.exec(s);
  if (t) {
    tags = t[1].slice(1, -1).split(':');
    s = s.slice(0, t.index);
  }
  return { todo, priority, comment, title: s.replace(/[ \t]+$/, ''), tags };
}

const BLOCK_BEGIN = /^[ \t]*#\+begin_(\S+)/i;
const blockEnd = (name) => new RegExp(`^[ \\t]*#\\+end_${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \\t]*$`, 'i');

/**
 * Classify one line that is not inside a block.
 * @param {string} s
 * @returns {{ type: string, [k: string]: any }}
 */
function classify(s) {
  let m;
  if ((m = /^(\*+) (.*)$/.exec(s))) return { type: 'headline', level: m[1].length, rest: m[2] };
  if (/^[ \t]*$/.test(s)) return { type: 'blank' };
  if ((m = /^[ \t]*#\+([^\s:]+):(?: (.*))?$/.exec(s))) return { type: 'keyword', key: m[1], value: m[2] ?? '' };
  if (/^[ \t]*#( |$)/.test(s)) return { type: 'comment' };
  if (/^[ \t]*:END:[ \t]*$/i.test(s)) return { type: 'drawer-end' };
  if ((m = /^[ \t]*:([\p{L}\p{N}_-]+):[ \t]*$/u.exec(s))) return { type: 'drawer-begin', name: m[1] };
  if (/^[ \t]*:( |$)/.test(s)) return { type: 'fixed-width' };
  if (/^[ \t]*\|-/.test(s)) return { type: 'table-rule' };
  if (/^[ \t]*\|/.test(s)) return { type: 'table-row' };
  if (/^[ \t]*(?:SCHEDULED|DEADLINE|CLOSED):/.test(s)) return { type: 'planning' };
  if ((m = /^([ \t]*)(?:[-+]|\*(?=[ \t])|\d+[.)])(?: |$)/.exec(s))) return { type: 'list-item', indent: m[1].length };
  return { type: 'text' };
}

/**
 * @param {string} text
 * @param {ParseOptions} [options]
 * @returns {{ root: Root, options: ParseOptions }}
 */
export function parse(text, options = {}) {
  const kw = options.todo ?? DEFAULT_TODO;
  const lines = splitLines(text);

  // Where each block name ends, so a "#+begin_x" only opens a block when an end exists.
  const ends = new Map();
  lines.forEach((l, i) => {
    const m = /^[ \t]*#\+end_(\S+?)[ \t]*$/i.exec(l.text);
    if (m) {
      const k = m[1].toLowerCase();
      if (!ends.has(k)) ends.set(k, []);
      ends.get(k).push(i);
    }
  });

  /** @type {Root} */
  const root = { type: 'root', children: [] };
  /** @type {Node[]} */
  const stack = [];
  const parent = () => (stack.length ? stack[stack.length - 1] : root);
  const add = (node) => { parent().children.push(node); };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const b = BLOCK_BEGIN.exec(line.text);
    if (b) {
      const name = b[1].toLowerCase();
      const j = (ends.get(name) ?? []).find((k) => k > i && blockEnd(b[1]).test(lines[k].text));
      if (j !== undefined) {
        add({ type: 'block-begin', name, line });
        for (let k = i + 1; k < j; k++) add({ type: 'block-line', line: lines[k] });
        add({ type: 'block-end', name, line: lines[j] });
        i = j;
        continue;
      }
    }
    const c = classify(line.text);
    if (c.type === 'headline') {
      const { rest, level } = c;
      const node = { type: 'headline', level, line, ...headlineParts(rest, kw), children: [] };
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      add(node);
      stack.push(node);
    } else {
      add({ ...c, line });
    }
  }

  return { root: deepFreeze(root), options: Object.freeze({ ...options }) };
}

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
}
