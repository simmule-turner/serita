import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { scanEmphasis } from '../core/emphasis.js';

const cases = JSON.parse(fs.readFileSync(new URL('./fixtures/emacs-emphasis.json', import.meta.url), 'utf8'));

test('emphasis in a line is found as Emacs finds it', () => {
  for (const c of cases) {
    const got = scanEmphasis(c.line).map((o) => `${o.kind}:${c.line.slice(o.start, o.end)}`).sort();
    assert.deepEqual(got, c.found.map(([k, t]) => `${k}:${t}`).sort(), JSON.stringify(c.line));
  }
});

import { emphasisByLine } from '../core/emphasis.js';
import { analyze } from '../core/outline.js';
test('emphasis runs over lines of one paragraph (Emacs 30.1, me-*)', () => {
  const by = (t) => emphasisByLine(analyze(t).nodes);
  const a = by('*a\nb*\n');
  assert.equal(a.get(0)[0].open, true);
  assert.equal(a.get(0)[0].close, false);
  assert.equal(a.get(1)[0].close, true);
  assert.equal(by('*a\n\nb*\n').size, 0);
  assert.equal(by('- x *a\nb*\n').size, 0);
  assert.equal(by('- x *a\n  b*\n').size, 2);
});
