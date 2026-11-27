import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as L from '../core/lists.js';

// Cases from Emacs 30.1 (conformance v0.1.76 li3-* and v0.1.77 li4-*): C-c - with a prefix argument, and S-left / S-right on an item line, in lists at the left margin and in sublists.
const cases = JSON.parse(fs.readFileSync(new URL('./fixtures/emacs-lists3.json', import.meta.url), 'utf8'));
const prefix = { c4: undefined, c16: undefined, arg2: 2, arg9: 9, arg0: 0, 'arg-1': -1 };

test('C-c - with a prefix and S-arrows on bullets give what Emacs gave (li3-*)', () => {
  for (const c of cases) {
    if (c.keys) { // li4-*: S-arrows and C-c - on sublists, several presses in a row
      let t = c.input;
      for (const key of c.keys) t = L.ctrlCMinus(t, c.line - 1, c.col, { which: key === 'org-shiftleft' ? 'previous' : undefined }).text;
      assert.equal(t, c.output, c.id);
      continue;
    }
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
