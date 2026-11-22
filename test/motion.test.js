import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forwardChar, backwardChar, forwardWord, backwardWord, moveVertical, lineStart, lineEnd } from '../core/motion.js';

// Expectations come from GNU Emacs 30.1 (conformance cases mv-*), as offsets into the text.
const at = (v, line, col) => v.split('\n').slice(0, line - 1).reduce((n, l) => n + l.length + 1, 0) + col;
const where = (v, p) => { const b = v.slice(0, p).split('\n'); return [b.length, b.at(-1).length]; };

test('C-f and C-b move a character, across lines, and report the ends', () => {
  assert.deepEqual(where('abc\n', forwardChar('abc\n', forwardChar('abc\n', 0).pos).pos), [1, 2]);
  assert.deepEqual(where('ab\ncd\n', forwardChar('ab\ncd\n', 2).pos), [2, 0]);
  assert.equal(forwardChar('ab', 2).error, 'end-of-buffer');
  assert.deepEqual(where('ab\ncd\n', backwardChar('ab\ncd\n', at('ab\ncd\n', 2, 0)).pos), [1, 2]);
  assert.equal(backwardChar('ab', 0).error, 'beginning-of-buffer');
});

test('M-f and M-b move over words made of letters and digits', () => {
  const t = 'foo, bar-baz qux\n';
  assert.equal(forwardWord(t, 0), 3);
  assert.equal(forwardWord(t, forwardWord(t, 0)), 8);
  assert.equal(forwardWord(t, 8), 12);
  assert.equal(forwardWord('ab\n\ncd', 2), 6);
  assert.equal(forwardWord('ab', 2), 2);
  assert.equal(forwardWord('héllo wörld\n', forwardWord('héllo wörld\n', 0)), 11);
  assert.equal(backwardWord(t, 16), 13);
  assert.equal(backwardWord(t, backwardWord(t, 16)), 9);
  assert.equal(backwardWord('foo bar\n', 6), 4);
  assert.equal(backwardWord('ab', 0), 0);
});

test('C-n and C-p keep the goal column through short lines and report the ends', () => {
  const t = 'long line here\nab\nlong line here\n';
  const a = moveVertical(t, at(t, 1, 8), 1, null);
  assert.deepEqual(where(t, a.pos), [2, 2]);
  assert.deepEqual(where(t, moveVertical(t, a.pos, 1, a.goal).pos), [3, 8]);
  const b = moveVertical(t, at(t, 3, 8), -1, null);
  assert.deepEqual(where(t, moveVertical(t, b.pos, -1, b.goal).pos), [1, 8]);
  assert.deepEqual(moveVertical('a\nb\n', at('a\nb\n', 2, 0), 1, null).error, null);
  assert.equal(moveVertical('a\nb\n', 4, 1, null).error, 'end-of-buffer');
  const e = moveVertical('a\nb', 2, 1, null);
  assert.deepEqual([e.pos, e.error], [3, 'end-of-buffer']);
  assert.equal(moveVertical('a\nb\n', 0, -1, null).error, 'beginning-of-buffer');
});

test('screen lines: C-n goes down one row of a wrapped line', () => {
  const t = 'x'.repeat(20) + '\nend\n';
  const rows = (s, e) => (e - s > 10 ? [s, s + 10] : [s]);
  assert.equal(moveVertical(t, 5, 1, null, rows).pos, 15);
  assert.equal(moveVertical(t, 15, -1, null, rows).pos, 5);
  assert.deepEqual(where(t, moveVertical(t, 15, 1, null, rows).pos), [2, 3]);
});

test('line start and end', () => {
  assert.equal(lineStart('  hi\nyo', 3), 0);
  assert.equal(lineEnd('  hi\nyo', 3), 4);
  assert.equal(lineEnd('  hi\nyo', 6), 7);
});
