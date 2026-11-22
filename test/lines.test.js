import { test } from 'node:test';
import assert from 'node:assert/strict';
import { duplicateLine, indentLine, killLine, killWholeLine, lineInfo, lineStart, moveLine } from '../core/lines.js';
import { createKillRing } from '../core/killring.js';
import { insertHeadingHere } from '../core/outline-edit.js';
import { analyze, cycle } from '../core/outline.js';

test('line numbers and starts', () => {
  assert.deepEqual(lineInfo('a\nbb\nc', 3), { line: 2, count: 3 });
  assert.equal(lineStart('a\nbb\nc', 3), 5);
  assert.equal(lineStart('a\nbb\nc', 99), 5);
});

test('duplicate, kill whole line, move and indent', () => {
  assert.deepEqual(duplicateLine('ab\ncd', 1), { text: 'ab\nab\ncd', pos: 4 });
  assert.deepEqual(killWholeLine('ab\ncd\n', 4), { text: 'ab\n', killed: 'cd\n', pos: 3 });
  assert.deepEqual(killWholeLine('ab\ncd', 4), { text: 'ab\n', killed: 'cd', pos: 3 });
  assert.deepEqual(moveLine('a\nb\nc', 2, 1), { text: 'a\nc\nb', pos: 4 });
  assert.equal(moveLine('a\nb', 0, -1), null);
  assert.deepEqual(indentLine('ab', 1, 2), { text: '  ab', pos: 3 });
  assert.deepEqual(indentLine('   ab', 4, -2), { text: ' ab', pos: 2 });
});

test('kill line takes the rest of the line, then the line break', () => {
  assert.deepEqual(killLine('abc\nd', 1), { text: 'a\nd', killed: 'bc', pos: 1 });
  assert.deepEqual(killLine('a\nd', 1), { text: 'ad', killed: '\n', pos: 1 });
  assert.equal(killLine('ab', 2), null);
});

test('the kill ring appends consecutive kills and keeps the newest first', () => {
  const k = createKillRing(2);
  k.kill('a'); k.kill('b', { append: true });
  assert.equal(k.get(), 'ab');
  k.kill('c'); k.kill('d');
  assert.deepEqual([k.get(0), k.get(1), k.size()], ['d', 'c', 2]);
});

test('insert heading at point: above, below, split, convert', () => {
  const t = '* A\nbody\n** B\n';
  assert.equal(insertHeadingHere(t, 0).text, '* \n* A\nbody\n** B\n');
  assert.equal(insertHeadingHere(t, 3).text, '* A\n* \nbody\n** B\n');
  assert.equal(insertHeadingHere(t, 6).text, '* A\nbo\n* dy\n** B\n');
  assert.equal(insertHeadingHere(t, 4).text, '* A\n* body\n** B\n');
  assert.equal(insertHeadingHere(t, 9).text, '* A\nbody\n** \n** B\n');
  assert.equal(insertHeadingHere('text', 2).text, 'te\n* xt');
});

test('TAB goes on from the remembered state, and skips children only when there are none', () => {
  const a = analyze('* P\n** C1\n** C2\n');
  const states = [];
  let f = {}; let last = null;
  for (let i = 0; i < 4; i++) { const r = cycle(a.foldables, f, 0, last); states.push(r.state); f = r.folds; last = r.state; }
  assert.deepEqual(states, ['folded', 'children', 'subtree', 'folded']);
  const b = analyze('* P\nbody\n');
  assert.equal(cycle(b.foldables, {}, 0).state, 'folded');
  assert.equal(cycle(b.foldables, { 0: 'all' }, 0).state, 'subtree');
});
