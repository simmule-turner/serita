import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDocument, edit, undo, redo, text } from '../core/document.js';

test('edit applies, undo restores exactly, redo reapplies', () => {
  const d0 = createDocument('* a\nbody\n');
  const d1 = edit(d0, [{ from: 2, to: 3, insert: 'xyz' }]);
  assert.equal(d1.text, '* xyz\nbody\n');
  assert.equal(undo(d1).text, d0.text);
  assert.equal(redo(undo(d1)).text, d1.text);
});

test('the tree follows the text', () => {
  const d = edit(createDocument('text\n'), [{ from: 0, to: 0, insert: '* h\n' }]);
  assert.equal(d.tree.root.children[0].type, 'headline');
  assert.equal(text(d), d.text);
});

test('a batch is one undo step, edits in original coordinates', () => {
  const d0 = createDocument('abcdef');
  const d1 = edit(d0, [{ from: 0, to: 1, insert: 'XX' }, { from: 4, to: 5, insert: '' }, { from: 6, to: 6, insert: '!' }]);
  assert.equal(d1.text, 'XXbcdf!');
  assert.equal(d1.past.length, 1);
  assert.equal(undo(d1).text, 'abcdef');
});

test('a new edit clears redo', () => {
  const d1 = edit(createDocument('a'), [{ from: 1, to: 1, insert: 'b' }]);
  const d2 = edit(undo(d1), [{ from: 1, to: 1, insert: 'c' }]);
  assert.equal(d2.future.length, 0);
  assert.equal(redo(d2), d2);
});

test('undo and redo at the ends do nothing; old states are untouched', () => {
  const d0 = createDocument('a');
  assert.equal(undo(d0), d0);
  const d1 = edit(d0, [{ from: 0, to: 1, insert: 'b' }]);
  assert.equal(d0.text, 'a');
  assert.equal(redo(d1), d1);
});

test('bad edits throw and change nothing', () => {
  const d = createDocument('abc');
  assert.throws(() => edit(d, [{ from: 2, to: 9, insert: '' }]), RangeError);
  assert.throws(() => edit(d, [{ from: 0, to: 2, insert: '' }, { from: 1, to: 3, insert: '' }]), RangeError);
});

test('seeded random edits: undo all returns the original, redo all returns the last', () => {
  let seed = 777;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  for (let run = 0; run < 100; run++) {
    const original = '* a\n** b\n- x\n| 1 |\n';
    let d = createDocument(original);
    const steps = 1 + rnd(12);
    for (let i = 0; i < steps; i++) {
      const len = d.text.length;
      const from = rnd(len + 1);
      const to = Math.min(len, from + rnd(4));
      d = edit(d, [{ from, to, insert: ['', '*', '\n', 'ab', '\r\n'][rnd(5)] }]);
    }
    const last = d.text;
    while (d.past.length) d = undo(d);
    assert.equal(d.text, original);
    while (d.future.length) d = redo(d);
    assert.equal(d.text, last);
  }
});
