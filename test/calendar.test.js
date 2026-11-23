import test from 'node:test';
import assert from 'node:assert/strict';
import { monthGrid, stepMonth, stepTime } from '../core/calendar.js';

test('November 2026 starts on a Sunday and the grid has six weeks', () => {
  const g = monthGrid(2026, 11);
  assert.equal(g.length, 42);
  assert.deepEqual(g[0], { y: 2026, m: 11, d: 1, other: false });
  assert.deepEqual(g[29], { y: 2026, m: 11, d: 30, other: false });
  assert.deepEqual(g[30], { y: 2026, m: 12, d: 1, other: true });
});

test('the days before the first belong to the month before', () => {
  const g = monthGrid(2026, 12); // Tuesday
  assert.deepEqual(g[0], { y: 2026, m: 11, d: 29, other: true });
  assert.deepEqual(g[2], { y: 2026, m: 12, d: 1, other: false });
});

test('months step across years', () => {
  assert.deepEqual(stepMonth(2026, 12, 1), { y: 2027, m: 1 });
  assert.deepEqual(stepMonth(2026, 1, -1), { y: 2025, m: 12 });
});

test('hours step by one and minutes by five, wrapping', () => {
  assert.deepEqual(stepTime(23, 30, 'hour', 1), { hour: 0, minute: 30 });
  assert.deepEqual(stepTime(0, 30, 'hour', -1), { hour: 23, minute: 30 });
  assert.deepEqual(stepTime(9, 35, 'minute', 1), { hour: 9, minute: 40 });
  assert.deepEqual(stepTime(9, 0, 'minute', 1), { hour: 9, minute: 5 });
  assert.deepEqual(stepTime(9, 35, 'minute', -1), { hour: 9, minute: 30 });
  assert.deepEqual(stepTime(9, 32, 'minute', 1), { hour: 9, minute: 35 });
  assert.deepEqual(stepTime(9, 55, 'minute', 1), { hour: 9, minute: 0 });
});
