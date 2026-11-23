// The diary, against what Emacs 30.1 listed for the same files (conformance v0.1.25).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { diaryEntries } from '../core/diary.js';

const cases = JSON.parse(readFileSync(new URL('./fixtures/emacs-diary.json', import.meta.url), 'utf8'));
for (const [id, c] of Object.entries(cases)) {
  test(`diary: ${id}`, () => {
    // fixtures keep start as [year, month, day]
    const got = diaryEntries(c.text, { y: c.start[0], m: c.start[1], d: c.start[2] }, c.days, { style: c.style }).map((e) => [e.m, e.d, e.y, e.text]);
    assert.deepEqual(got, c.want);
  });
}
