// Org's inline markup in one table cell, translated for an export format: bold, italic, underline, strike-through, code, verbatim,
// links, entities, sub- and superscripts, and the characters each format has to escape. Written from the Org manual's description of
// markup and observed Emacs 30.1 results for orgtbl-to-latex, -html, -texinfo and -unicode (conformance v0.1.58); no Emacs or Org
// source was read. A cell with a part this does not translate yet is an error that names it, never a wrong guess.

import { ENTITIES } from './entities.js';

export class MarkupError extends Error {}

const PRE = /[-\s('"{]/;
const POST = /[-\s.,:!?;'")}[\]\\]/;
const MARKERS = { '*': 'bold', '/': 'italic', '_': 'underline', '+': 'strike', '=': 'verbatim', '~': 'code' };
const LINK_TYPES = ['http', 'https', 'ftp', 'mailto', 'file'];

/** The objects of a string: text, markup with children, verbatim, entities, links and sub/superscripts. */
export function parseInline(s) {
  const out = [];
  let text = '';
  const flush = () => { if (text) { out.push({ type: 'text', value: text }); text = ''; } };
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    const rest = () => s.slice(i);
    if (c === '\\') {
      let m;
      if ((m = /^\\\((?:[^\\]|\\(?!\)))*\\\)/.exec(rest()))) { flush(); out.push({ type: 'math', value: m[0].slice(2, -2), display: false, raw: m[0] }); i += m[0].length; continue; }
      if ((m = /^\\\[(?:[^\\]|\\(?!\]))*\\\]/.exec(rest()))) { flush(); out.push({ type: 'math', value: m[0].slice(2, -2), display: true, raw: m[0] }); i += m[0].length; continue; }
      if ((m = /^\\(_ +)/.exec(rest())) && ENTITIES[m[1]]) { flush(); out.push({ type: 'entity', name: m[1] }); i += m[0].length; continue; }
      if ((m = /^\\([a-zA-Z]+[0-9]*)(\{\})?/.exec(rest())) && ENTITIES[m[1]] && (m[2] || !/^[a-zA-Z]/.test(s[i + m[0].length] ?? ''))) { flush(); out.push({ type: 'entity', name: m[1] }); i += m[0].length; continue; }
      const f = /^\\[a-zA-Z]+\*?(?:\[[^\][\n{}]*\]|\{[^{}\n]*\})*/.exec(rest());
      if (f) { flush(); out.push({ type: 'latex', value: f[0] }); i += f[0].length; continue; }
      if (s[i + 1] === '-') { flush(); out.push({ type: 'shy' }); i += 2; continue; }
      if (s[i + 1] === '\\') { text += '\\'; flush(); out.push({ type: 'latex', value: '\\' }); i += 2; continue; }
      text += c; i++; continue;
    }
    if (c === '@' && s[i + 1] === '@') {
      const m = /^@@([-A-Za-z0-9]+):((?:(?!@@).)*)@@/.exec(rest());
      if (m) { flush(); out.push({ type: 'snippet', backend: m[1], value: m[2] }); i += m[0].length; continue; }
    }
    if (c === '[' && s[i + 1] === '[') {
      const m = /^\[\[((?:[^\][\\]|\\.)+)\](?:\[((?:.|\n)+?)\])?\]/.exec(rest());
      if (m) {
        const path = m[1].replace(/\\(.)/g, '$1');
        const type = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(path)?.[1];
        if (/^[#*]/.test(path)) throw new MarkupError(`Org export aborted.  Unable to resolve link: "${path.startsWith('#') ? path.slice(1) : path}"`);
        if (!LINK_TYPES.includes(type)) throw new MarkupError(`Links of this kind are not translated yet: ${path}`);
        flush(); out.push({ type: 'link', path, kind: type, children: m[2] === undefined ? null : parseInline(m[2]) }); i += m[0].length; continue;
      }
    }
    if (c === '<' || c === '[') {
      const m = /^(?:<\d{4}-\d\d-\d\d[^>\n]*>|\[\d{4}-\d\d-\d\d[^\]\n]*\])/.exec(rest());
      if (m) { flush(); out.push({ type: 'timestamp', value: m[0], active: c === '<' }); i += m[0].length; continue; }
      const fn = /^\[fn:[^\]\n]*\]/.exec(rest());
      if (fn) { flush(); out.push({ type: 'footnote', value: fn[0] }); i += fn[0].length; continue; }
    }
    if (c === '$') {
      const m = /^\$\$(?:(?!\$\$)[^\n])+\$\$|^\$[^\s$.,;](?:[^$\n]*[^\s$.,;])?\$(?=[\s.,;:!?'")}\]-]|$)/.exec(rest());
      if (m && (i === 0 || s[i - 1] !== '$')) {
        flush(); const display = m[0].startsWith('$$');
        out.push({ type: 'math', value: m[0].slice(display ? 2 : 1, display ? -2 : -1), display, dollar: true, raw: m[0] }); i += m[0].length; continue;
      }
    }
    if ((c === '_' || c === '^') && i > 0 && !/\s/.test(s[i - 1])) {
      const m = /^[_^](?:(\*)|\{((?:[^{}]|\{[^{}]*\})*)\}|([-+]?[a-zA-Z0-9.,\\]*[a-zA-Z0-9]))/.exec(rest());
      if (m) { flush(); out.push({ type: c === '_' ? 'sub' : 'sup', braces: m[2] !== undefined, children: parseInline(m[1] ?? m[2] ?? m[3]) }); i += m[0].length; continue; }
    }
    if (MARKERS[c] && (i === 0 || PRE.test(s[i - 1])) && i + 1 < s.length && !/\s/.test(s[i + 1])) {
      let found = -1;
      for (let j = i + 2; j < s.length; j++) if (s[j] === c && !/\s/.test(s[j - 1]) && (j + 1 === s.length || POST.test(s[j + 1]))) { found = j; break; }
      if (found > 0) {
        flush();
        const body = s.slice(i + 1, found);
        out.push(c === '=' || c === '~' ? { type: MARKERS[c], value: body } : { type: MARKERS[c], children: parseInline(body) });
        i = found + 1; continue;
      }
    }
    if (c === 'h' || c === 'f' || c === 'm') {
      const m = /^(?:https?|ftp):\/\/[^\s<>()[\]]*[^\s<>()[\].,;:!?'"]|^mailto:[^\s<>()[\]]*[^\s<>()[\].,;:!?'"]/.exec(rest());
      if (m && (i === 0 || !/[a-zA-Z0-9]/.test(s[i - 1]))) { flush(); out.push({ type: 'link', path: m[0], kind: /^[a-z]+/.exec(m[0])[0], children: null }); i += m[0].length; continue; }
    }
    text += c; i++;
  }
  flush();
  return out;
}

// The file of a file: link, without the search option
const fileOf = (n) => n.path.slice(5).replace(/::.*$/, '');
const TEX = { '&': '\\&', '%': '\\%', $: '\\$', '#': '\\#', _: '\\_', '{': '\\{', '}': '\\}', '~': '\\textasciitilde{}', '^': '\\^{}', '\\': '$\\backslash$' };
const texText = (t) => t.replace(/[&%$#_{}~^\\]/g, (c) => TEX[c]);
const html = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const tex = (t) => t.replace(/[@{}]/g, '@$&');
// Special strings: ... and --- (and -- in the Unicode table) become characters or commands
const special = (map, needsNext = false) => (t, esc) => {
  const parts = t.split(/(\.\.\.|---|--)/);
  return parts.map((p, k) => (k % 2 ? (map[p] !== undefined && !(needsNext && p[0] === '-' && k === parts.length - 2 && parts[k + 1] === '') ? map[p] : esc(p)) : esc(p))).join('');
};
const BACKENDS = {
  html: {
    shy: '&#x00ad;',
    text: special({ '...': '&#x2026;', '---': '&#x2014;', '--': '&#x2013;' }, true), esc: html, latex: html, break: () => '<br />\n',
    bold: (x) => `<b>${x}</b>`, italic: (x) => `<i>${x}</i>`, underline: (x) => `<span class="underline">${x}</span>`, strike: (x) => `<del>${x}</del>`,
    code: (v) => `<code>${html(v)}</code>`, verbatim: (v) => `<code>${html(v)}</code>`,
    entity: (e) => e.html, sub: (x) => `<sub>${x}</sub>`, sup: (x) => `<sup>${x}</sup>`,
    link: (n, desc) => {
      if (n.kind === 'file' && /::/.test(n.path)) throw new MarkupError(`Org export aborted.  Unable to resolve link: "No match for fuzzy expression: ${n.path.split('::')[1]}"`);
      const url = n.kind === 'file' ? fileOf(n).replace(/\.org$/, '.html') : n.path;
      return `<a href="${url.replace(/&/g, '&amp;')}">${desc ?? html(url)}</a>`;
    },
    timestamp: (n) => `<span class="timestamp-wrapper"><span class="timestamp">${html(n.value)}</span></span>`,
    math: (n) => (n.display ? `\\[${n.value}\\]` : n.dollar ? `\\(${n.value}\\)` : n.raw),
    snippet: (n) => (n.backend === 'html' ? n.value : ''),
  },
  latex: {
    shy: '\\-',
    text: special({ '...': '\\ldots{}' }), esc: texText, latex: (v) => v, break: () => '\\\\\n',
    bold: (x) => `\\textbf{${x}}`, italic: (x) => `\\emph{${x}}`, underline: (x) => `\\uline{${x}}`, strike: (x) => `\\sout{${x}}`,
    code: (v) => `\\texttt{${texText(v).replace(/\$\\backslash\$/g, '\\textbackslash{}')}}`, verbatim: (v) => `\\texttt{${texText(v).replace(/\$\\backslash\$/g, '\\textbackslash{}')}}`,
    entity: (e) => (e.math ? `\\(${e.latex}\\)` : e.latex), sub: (x) => `\\textsubscript{${x}}`, sup: (x) => `\\textsuperscript{${x}}`,
    link: (n, desc) => {
      const url = (n.kind === 'file' ? fileOf(n) : n.path).replace(/[&_]/g, '\\$&');
      return desc === null ? `\\url{${url}}` : `\\href{${url}}{${desc}}`;
    },
    timestamp: (n) => `\\textit{${n.active ? n.value : `{[}${n.value.slice(1)}`}}`,
    math: (n) => (n.dollar && n.display ? n.raw : n.dollar ? `\\(${n.value}\\)` : n.raw),
    snippet: (n) => (n.backend === 'latex' ? n.value : ''),
  },
  texinfo: {
    shy: '@-',
    text: special({ '...': '@dots{}' }), esc: tex, latex: (v) => v, break: () => '@*\n',
    bold: (x) => `@strong{${x}}`, italic: (x) => `@emph{${x}}`, underline: (x) => x, strike: (x) => x,
    code: (v) => `@code{${tex(v)}}`, verbatim: (v) => `@samp{${tex(v)}}`,
    entity: (e) => e.texinfo, sub: (x) => `@math{_${x}}`, sup: (x) => `@math{^${x}}`,
    link: (n, desc) => {
      const url = n.kind === 'file' ? fileOf(n) : n.path;
      if (n.kind === 'mailto') return desc === null ? `@email{${tex(url)}}` : `@email{${tex(url)}, ${desc}}`;
      return desc === null ? `@uref{${tex(url)}}` : `@uref{${tex(url)}, ${desc}}`;
    },
    timestamp: (n) => `@emph{${n.value}}`,
    math: (n) => (n.display ? `\n@displaymath\n${n.value}\n@end displaymath` : `@math{${n.value}}`),
    snippet: (n) => (n.backend === 'texinfo' ? n.value : ''),
  },
  ascii: {
    shy: '',
    text: special({ '...': '…', '---': '—', '--': '–' }), esc: (t) => t, latex: (v) => v, break: () => '\n',
    bold: (x) => `*${x}*`, italic: (x) => `/${x}/`, underline: (x) => `_${x}_`, strike: (x) => `+${x}+`,
    code: (v) => `\`${v}'`, verbatim: (v) => `\`${v}'`,
    entity: (e) => e.utf8, sub: (x, n) => (n.braces ? `_{${x}}` : `_${x}`), sup: (x, n) => (n.braces ? `^{${x}}` : `^${x}`),
    link: (n, desc) => (desc === null ? `<${n.path}>` : `[${desc}]`),
    timestamp: (n) => n.value,
    math: (n) => n.raw,
    snippet: (n) => (n.backend === 'ascii' ? n.value : ''),
  },
};

/** The cell as text for `format`: html, latex, texinfo or ascii (the Unicode table). */
export function translate(cell, format) {
  const b = BACKENDS[format];
  const render = (nodes) => nodes.map((n, k) => {
    switch (n.type) {
      case 'text': return b.text(n.value, b.esc);
      case 'latex': return b.latex(n.value);
      case 'break': return b.break();
      case 'shy': return b.shy;
      case 'entity': return b.entity(ENTITIES[n.name], n.name);
      case 'bold': case 'italic': case 'underline': case 'strike': return b[n.type](render(n.children));
      case 'code': case 'verbatim': return b[n.type](n.value);
      case 'sub': case 'sup': return b[n.type](render(n.children), n);
      case 'link': return b.link(n, n.children === null ? null : render(n.children));
      case 'timestamp': return b.timestamp(n);
      case 'math': return b.math(n);
      case 'footnote':
        if (format === 'ascii') return '[nil]';
        throw new MarkupError(`Definition not found for footnote ${n.value.slice(4, -1)}`);
      case 'snippet': {
        const v = b.snippet(n);
        // A snippet that is dropped takes one of the two spaces around it with it
        if (v === '' && /\s$/.test(nodes[k - 1]?.value ?? '') && /^\s/.test(nodes[k + 1]?.value ?? '')) nodes[k + 1] = { ...nodes[k + 1], value: nodes[k + 1].value.slice(1) };
        return v;
      }
      default: throw new MarkupError(`Not translated: ${n.type}`);
    }
  }).join('');
  if (/^\*\s*$/.test(cell)) throw new MarkupError('A cell that is only an asterisk is not translated yet');
  return render(parseInline(cell));
}
