import { test } from 'node:test';
import assert from 'node:assert/strict';
import { merge3, resolve } from '../app/storage/conflict.js';

const L = (...lines) => lines.join('\n') + '\n';

test('merge: changes in different places combine', () => {
  const base = L('a', 'b', 'c', 'd', 'e');
  const r = merge3(base, L('A', 'b', 'c', 'd', 'e'), L('a', 'b', 'c', 'd', 'E'));
  assert.equal(r.clean, true);
  assert.equal(r.text, L('A', 'b', 'c', 'd', 'E'));
});

test('merge: the same change on both sides is taken once', () => {
  const base = L('a', 'b');
  const r = merge3(base, L('a', 'X'), L('a', 'X'));
  assert.equal(r.text, L('a', 'X'));
});

test('merge: different changes to one line conflict and can be settled', () => {
  const r = merge3(L('a', 'b', 'c'), L('a', 'mine', 'c'), L('a', 'theirs', 'c'));
  assert.equal(r.clean, false);
  const conflicts = r.segments.filter((s) => s.type === 'conflict');
  assert.equal(conflicts.length, 1);
  assert.deepEqual(conflicts[0].base, ['b\n']);
  assert.equal(resolve(r.segments, () => 'mine'), L('a', 'mine', 'c'));
  assert.equal(resolve(r.segments, () => 'theirs'), L('a', 'theirs', 'c'));
  assert.equal(resolve(r.segments, () => 'both'), L('a', 'mine', 'theirs', 'c'));
});

test('merge: a delete on one side and an edit on the other conflict; a delete alone merges', () => {
  const base = L('a', 'b', 'c');
  assert.equal(merge3(base, L('a', 'c'), L('a', 'b', 'c')).text, L('a', 'c'));
  assert.equal(merge3(base, L('a', 'c'), L('a', 'B', 'c')).clean, false);
});

test('merge: insertions at different places merge; at the same place they conflict', () => {
  const base = L('a', 'b', 'c');
  assert.equal(merge3(base, L('x', 'a', 'b', 'c'), L('a', 'b', 'c', 'y')).text, L('x', 'a', 'b', 'c', 'y'));
  assert.equal(merge3(base, L('a', 'M', 'b', 'c'), L('a', 'T', 'b', 'c')).clean, false);
});

test('merge: empty base, empty sides and line endings', () => {
  assert.equal(merge3('', 'a\n', '').text, 'a\n');
  assert.equal(merge3('', '', '').text, '');
  assert.equal(merge3('', 'a\n', 'b\n').clean, false);
  const r = merge3('a\r\nb\r\nc\r\n', 'A\r\nb\r\nc\r\n', 'a\r\nb\r\nC\r\n');
  assert.equal(r.text, 'A\r\nb\r\nC\r\n');
  assert.equal(merge3('a\r\nb\r\n', 'A\r\nb\r\n', 'a\r\nB\r\n').clean, false);
});

test('merge: a missing final newline is a change like any other', () => {
  assert.equal(merge3('a\nb', 'a\nb', 'a\nb\n').text, 'a\nb\n');
});

test('merge: identities hold on seeded random texts', () => {
  let seed = 4242;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  const doc = () => Array.from({ length: rnd(12) }, () => `l${rnd(5)}`).join('\n') + (rnd(4) ? '\n' : '');
  for (let i = 0; i < 300; i++) {
    const b = doc(); const m = doc(); const t = doc();
    assert.equal(merge3(b, b, t).text, t, 'only theirs changed');
    assert.equal(merge3(b, m, b).text, m, 'only mine changed');
    assert.equal(merge3(b, m, m).text, m, 'same change');
    const r = merge3(b, m, t);
    assert.equal(resolve(r.segments, () => 'mine').length >= 0, true);
    if (r.clean) assert.equal(r.text, resolve(r.segments, () => 'mine'));
  }
});

test('merge: far-apart edits in a long file merge', () => {
  const base = Array.from({ length: 2000 }, (_, i) => `line ${i}`);
  const mine = [...base]; mine[10] = 'mine';
  const theirs = [...base]; theirs[1900] = 'theirs';
  const r = merge3(base.join('\n') + '\n', mine.join('\n') + '\n', theirs.join('\n') + '\n');
  assert.equal(r.clean, true);
  assert.ok(r.text.includes('mine\n') && r.text.includes('theirs\n'));
});
