import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { action } from '../core/footnote.js';

const cases = JSON.parse(fs.readFileSync(new URL('./fixtures/emacs-footnote.json', import.meta.url), 'utf8'));

for (const c of cases) {
  test(`footnote ${c.id} matches Emacs`, () => {
    const r = action(c.input, c.line, c.col, { prefix: c.prefix, choice: c.answer, label: c.answer, opts: c.opts });
    assert.equal(r.text ?? c.input, c.text);
    if (c.point) assert.deepEqual([r.line, r.col], c.point);
  });
}
