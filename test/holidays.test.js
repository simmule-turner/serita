import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { holidayList, holidaysOf } from '../core/holidays.js';

const fx = JSON.parse(readFileSync(new URL('./fixtures/emacs-holidays.json', import.meta.url)));
const flat = (y, which) => holidaysOf(y, { which: [which] }).map((h) => [h.m, h.d, h.name]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);

test('the general and Christian holidays match what Emacs listed', () => {
  for (const y of [2026, 2027, 2028]) {
    assert.deepEqual(flat(y, 'general'), fx[`general-${y}`].map((x) => [...x]));
    assert.deepEqual(flat(y, 'christian'), fx[`christian-${y}`].map((x) => [...x]));
  }
});

test('local forms match what Emacs listed', () => {
  const localText = `((holiday-fixed 3 14 "Pi Day") (holiday-float 11 4 4 "Fourth Thursday") (holiday-float 5 1 -1 "Last Monday of May") (holiday-sexp '(if (= year 2026) (list 7 4 year)) "Sexp day") (holiday-fixed 12 25 "Xmas"))`;
  const names = (m) => holidayList(2026, m, { which: [], localText }).map((h) => `${h.m}/${h.d} ${h.name}`);
  assert.deepEqual(holidaysOf(2026, { which: [] }), []);
  const at = (m) => holidayList(2026, m, { which: ['general', 'christian'], localText }).filter((h) => h.name === 'Pi Day' || h.name === 'Sexp day' || h.name === 'Xmas' || h.name === 'Fourth Thursday').map((h) => `${h.m}/${h.d} ${h.name}`);
  assert.deepEqual(at(3), ['3/14 Pi Day']);
  assert.deepEqual(at(7), ['7/4 Sexp day']);
  assert.deepEqual(at(12), ['11/26 Fourth Thursday', '12/25 Xmas']);
  assert.equal(names(1).length, 0);
});
