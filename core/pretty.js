// org-pretty-entities as Emacs shows it (recorded from Emacs 30.1 / Org 9.7.11, conformance v0.1.88): \alpha is drawn as α, and in x_{1}
// and y_2 the _ and the braces are hidden while the script is lowered (^ raises it). With org-use-sub-superscripts t every _ and ^ after a
// non-space character is a script; with {} (and, as Emacs draws it, nil) only the braced ones are. A name that is not an entity stays as typed.

import { ENTITIES } from './entities.js';

const BRACED = /^[_^]\{((?:[^{}]|\{[^{}]*\})*)\}/;
const ANY = /^[_^](?:(\*)|\{((?:[^{}]|\{[^{}]*\})*)\}|([-+]?[a-zA-Z0-9.,\\]*[a-zA-Z0-9]))/;

/**
 * The pieces `text` is drawn as: { text } as typed, { entity } the character of \name, { sub } or { sup } the script (its own pieces in `parts`).
 * @param {string} text
 * @param {{ entities: boolean, scripts: boolean, braces: boolean }} how `scripts` draws _ and ^ ; `braces` limits that to the braced ones
 */
export function pretty(text, { entities, scripts, braces }) {
  const out = [];
  let plain = '';
  const flush = () => { if (plain) { out.push({ text: plain }); plain = ''; } };
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (entities && c === '\\') {
      const m = /^\\([a-zA-Z]+[0-9]*)(\{\})?/.exec(text.slice(i));
      if (m && ENTITIES[m[1]] && (m[2] || !/^[a-zA-Z]/.test(text[i + m[0].length] ?? ''))) { flush(); out.push({ entity: ENTITIES[m[1]].utf8, raw: m[0] }); i += m[0].length; continue; }
    }
    if (scripts && (c === '_' || c === '^') && i > 0 && !/\s/.test(text[i - 1])) {
      const m = (braces ? BRACED : ANY).exec(text.slice(i));
      if (m) {
        flush();
        const body = braces ? m[1] : (m[1] ?? m[2] ?? m[3]);
        out.push({ [c === '_' ? 'sub' : 'sup']: true, parts: pretty(body, { entities, scripts, braces }), raw: m[0] });
        i += m[0].length;
        continue;
      }
    }
    plain += c;
    i++;
  }
  flush();
  return out;
}
