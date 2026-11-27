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
