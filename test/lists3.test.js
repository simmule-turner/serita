import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as L from '../core/lists.js';

// Cases from Emacs 30.1 (conformance v0.1.76, li3-*): C-c - with a prefix argument, and S-left / S-right on an item line.
const cases = JSON.parse(fs.readFileSync(new URL('./fixtures/emacs-lists3.json', import.meta.url), 'utf8'));
const prefix = { c4: undefined, c16: undefined, arg2: 2, arg9: 9, arg0: 0, 'arg-1': -1 };

test('C-c - with a prefix and S-arrows on bullets give what Emacs gave (li3-*)', () => {
  for (const c of cases) {
    const k = /^li3-cminus-([^-]+(?:-1)?)/.exec(c.id);
    const r = k ? L.ctrlCMinus(c.input, c.line - 1, c.col, { which: prefix[k[1]] }) : L.ctrlCMinus(c.input, c.line - 1, c.col, { which: /-l$/.test(c.id) ? 'previous' : undefined });
    assert.equal(r.text, c.output, c.id);
  }
});

test('S-arrows act on the first line of an item only', () => {
  assert.equal(L.onItemLine('* H\n- one\n  more\n', 1), true);
  assert.equal(L.onItemLine('* H\n- one\n  more\n', 2), false);
  assert.equal(L.onItemLine('* H\ntext\n', 1), false);
});
