import { test } from 'node:test';
import assert from 'node:assert/strict';
import { search, isCaseSensitive } from '../app/ui/find.js';

test('lowercase queries ignore case; an uppercase letter makes it exact', () => {
  assert.equal(isCaseSensitive('plant'), false);
  assert.equal(isCaseSensitive('Plant'), true);
  assert.deepEqual(search('Buy PLANT food', 'plant', { from: 0 }), { start: 4, end: 9, wrapped: false });
  assert.equal(search('Buy PLANT food', 'Plant', { from: 0 }), null);
  assert.deepEqual(search('a Plant', 'Plant', { from: 0 }), { start: 2, end: 7, wrapped: false });
});

test('forward starts at from; past the last match it fails, and wraps when asked', () => {
  const t = 'ab ab ab';
  assert.deepEqual(search(t, 'ab', { from: 1 }), { start: 3, end: 5, wrapped: false });
  assert.equal(search(t, 'ab', { from: 7 }), null);
  assert.deepEqual(search(t, 'ab', { from: 7, wrap: true }), { start: 0, end: 2, wrapped: true });
});

test('backward finds the last match ending at or before from', () => {
  const t = 'ab ab ab';
  assert.deepEqual(search(t, 'ab', { from: 8, backward: true }), { start: 6, end: 8, wrapped: false });
  assert.deepEqual(search(t, 'ab', { from: 5, backward: true }), { start: 3, end: 5, wrapped: false });
  assert.equal(search(t, 'ab', { from: 1, backward: true }), null);
  assert.deepEqual(search(t, 'ab', { from: 1, backward: true, wrap: true }), { start: 6, end: 8, wrapped: true });
});

test('no match at all, and an empty query, give null', () => {
  assert.equal(search('abc', 'z', { from: 0 }), null);
  assert.equal(search('abc', 'z', { from: 0, backward: true }), null);
  assert.equal(search('abc', '', { from: 0 }), null);
});

test('offsets stay right when lowercasing would change a character length', () => {
  const t = 'İx abc';
  assert.deepEqual(search(t, 'abc', { from: 0 }), { start: 3, end: 6, wrapped: false });
});

test('regexp search: forward from point, backward by start, wrap on request, errors thrown', () => {
  const t = 'ab1 cd22 ef333';
  assert.deepEqual(search(t, '[0-9]+', { from: 0, regexp: true }), { start: 2, end: 3, wrapped: false });
  assert.deepEqual(search(t, '[0-9]+', { from: 3, regexp: true }), { start: 6, end: 8, wrapped: false });
  assert.deepEqual(search(t, '[0-9]+', { from: 9, backward: true, regexp: true }), { start: 7, end: 8, wrapped: false }); // as re-search-backward: the nearest start
  assert.equal(search(t, '[0-9]+', { from: 14, regexp: true }), null);
  assert.equal(search(t, '[0-9]+', { from: 14, regexp: true, wrap: true }).wrapped, true);
  assert.equal(search('Ab ab', 'ab', { from: 0, regexp: true }).start, 0); // lowercase: ignores case
  assert.equal(search('Ab ab', 'Ab', { from: 1, regexp: true }), null); // an uppercase letter: exact
  assert.throws(() => search(t, '\\(a', { from: 0, regexp: true }));
});
