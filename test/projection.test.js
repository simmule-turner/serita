import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineAt, project, toFull, toShown, touchedFold } from '../core/projection.js';

const TEXT = '* A\nbody\n* B\nb1\nb2\n* C\n';
const p = project(TEXT, new Set([3, 4]), new Set([2]));

test('folded lines are left out and "..." follows the heading', () => {
  assert.equal(p.value, '* A\nbody\n* B...\n* C\n');
});

test('offsets in the shown text map to the real text and back', () => {
  assert.equal(toFull(p, 0), 0);
  assert.equal(toFull(p, 14), 12);
  assert.equal(toFull(p, 15), 12);
  assert.equal(toFull(p, 16), 19);
  assert.equal(toShown(p, 19), 16);
  assert.equal(toShown(p, 16), 12);
  assert.equal(lineAt(p, 16), 5);
});

test('typing at the end of a folded heading goes into the heading, before its hidden text', () => {
  assert.equal(toFull(p, 12), 12);
  const at = toFull(p, 12);
  assert.equal(TEXT.slice(0, at) + '!' + TEXT.slice(at), '* A\nbody\n* B!\nb1\nb2\n* C\n');
});

test('a range crossing a fold takes the hidden text with it', () => {
  assert.equal(toFull(p, 16) - toFull(p, 12), 7);
});

test('an edit touching "..." or the break after it names the heading to open', () => {
  assert.equal(touchedFold(p, 12, 15, ''), 2);
  assert.equal(touchedFold(p, 12, 12, '\n'), 2);
  assert.equal(touchedFold(p, 12, 12, 'x'), null);
  assert.equal(touchedFold(p, 11, 12, ''), null);
});

test('hiding leading stars keeps every offset', () => {
  const q = project('*** A\n', new Set(), new Set(), { hideStars: true });
  assert.equal(q.value, '  * A\n');
  assert.equal(q.value.length, 6);
});

test('indent puts two columns per level before each line, and positions still map', () => {
  const p = project('* A\nbody\n** B\n  more\n', new Set(), new Set(), { indent: true });
  assert.equal(p.value, '* A\n  body\n  * B\n      more\n');
  for (const f of [0, 2, 4, 6, 9, 14]) assert.equal(toFull(p, toShown(p, f)), f);
  assert.equal(toFull(p, 5), 4);
});
