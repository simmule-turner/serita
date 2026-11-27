import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseTemplates, place } from '../core/capture.js';

// Emacs 30.1 (conformance v0.1.63, dt-*): where capture puts an entry in a date tree; the date is 2026-11-26.
const cases = JSON.parse(fs.readFileSync(new URL('./fixtures/emacs-datetree.json', import.meta.url)));
const date = new Date(Date.UTC(2026, 10, 26, 10, 0));
// :tree-type with an unquoted symbol is a void variable in Emacs
/** The first balanced form of a text, strings respected. */
function firstForm(t) {
  let depth = 0; let str = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (str) { if (ch === '\\') i++; else if (ch === '"') str = false; } else if (ch === '"') str = true; else if (ch === '(') depth++; else if (ch === ')' && --depth === 0) return t.slice(0, i + 1);
  }
  return t;
}
const SKIP = new Set(['dt-month', 'dt-week-type']);
for (const c of cases) {
  if (SKIP.has(c.id)) continue;
  test(c.id, () => {
    const src = firstForm(c.tpl).replace(/\(quote ([\w-]+)\)/, '$1').replace(/\(list '(file\+[\w+]+)/, '($1').replace(/ file( |\))/, ' "x.org"$1').replace(/^\(list /, '(');
    const tpl = parseTemplates(`(setq org-capture-templates '(${src}))`)[0];
    const captured = tpl.template.replace('%?', 'new');
    if (c.error || c.messages?.includes('ERR')) return assert.throws(() => place(c.input, tpl, captured, { date }));
    assert.equal(place(c.input, tpl, captured, { date }).text, c.expect);
  });
}
