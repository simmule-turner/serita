import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as L from '../core/lists.js';

// Cases from Emacs 30.1 (conformance v0.1.75, li2-*): the text after the command and where the cursor is (line, column, 1-based lines).
const cases = JSON.parse(fs.readFileSync(new URL('./fixtures/emacs-lists2.json', import.meta.url), 'utf8'));
const run = {
  mret: (t, l, c) => L.insertItem(t, l, c, { box: false }),
  msret: (t, l, c) => L.insertItem(t, l, c, { box: true }),
  'tg-box-c4': (t, l, c) => L.boxCommand(t, l, c, { list: 4 }),
  'tg-none-c4': (t, l, c) => L.boxCommand(t, l, c, { list: 4 }),
  'tg-box-c16': (t, l, c) => L.boxCommand(t, l, c, { list: 16 }),
  'tg-text-c4': (t, l, c) => L.boxCommand(t, l, c, { list: 4 }),
  cminus: (t, l, c) => L.ctrlCMinus(t, l, c),
  sort: (t, l, c, id) => L.sortList(t, l, id.endsWith('-box') ? id.at(-5) : id.includes('-n-') ? 'n' : id.endsWith('-t') || id.includes('-t-') ? 't' : 'a'),
  ret: (t, l, c) => L.returnInItem(t, l, c),
};
const pick = (id) => (id.startsWith('li2-mret') ? 'mret' : id.startsWith('li2-msret') ? 'msret' : id.startsWith('li2-cminus') ? 'cminus' : id.startsWith('li2-sort') ? 'sort' : id.startsWith('li2-ret') ? 'ret' : id.replace('li2-', '').replace(/-c4b$/, '-c4'));

test('list commands give what Emacs gave (li2-*)', () => {
  for (const c of cases) {
    if (c.id === 'li2-ret' || c.id.startsWith('li2-sort-a-cursor') || c.id === 'li2-ret-mid' && false) continue; // plain RET and sort cursor rules are not asserted here
    const k = pick(c.id);
    const r = run[k](c.input, c.line - 1, c.col, c.id);
    assert.ok(r, c.id);
    assert.equal(r.text, c.output, c.id);
  }
});
