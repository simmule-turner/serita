import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHistory } from '../app/ui/history.js';

const at = (id, offset) => ({ kind: 'place', id, offset });

test('back takes the newest place first', () => {
  const h = createHistory();
  h.push(at(1, 0)); h.push(at(1, 40)); h.push({ kind: 'agenda' });
  assert.deepEqual(h.pop(), { kind: 'agenda' });
  assert.deepEqual(h.pop(), at(1, 40));
  assert.deepEqual(h.pop(), at(1, 0));
  assert.equal(h.pop(), null);
});

test('the same place twice in a row is kept once', () => {
  const h = createHistory();
  h.push(at(1, 5)); h.push(at(1, 5));
  assert.equal(h.size(), 1);
});

test('places in a closed buffer are skipped', () => {
  const h = createHistory();
  h.push(at(1, 0)); h.push(at(2, 0));
  assert.deepEqual(h.peek((e) => e.id !== 2), at(1, 0));
  assert.equal(h.size(), 1);
});

test('the oldest places drop off past the limit', () => {
  const h = createHistory({ max: 2 });
  h.push(at(1, 1)); h.push(at(1, 2)); h.push(at(1, 3));
  assert.deepEqual(h.pop(), at(1, 3));
  assert.deepEqual(h.pop(), at(1, 2));
  assert.equal(h.pop(), null);
});
