import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { emphasize } from '../core/emphasize.js';

const cases = JSON.parse(fs.readFileSync(new URL('./fixtures/emacs-emphasize.json', import.meta.url), 'utf8'));

for (const c of cases) {
  test(`emphasize ${c.id} matches Emacs`, () => {
    const r = emphasize(c.input, c.from, c.to, c.char);
    if (c.error) { assert.equal(r.error, c.error); return; }
    assert.equal(r.text, c.text);
    assert.equal(r.offset, c.point);
  });
}
