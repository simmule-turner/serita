// Sparse trees. The cases are Emacs 30.1 results: which lines show, and which show an ellipsis, after C-c / r, C-c / t.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyze, hiddenLines, ellipsisLines, cycle } from '../core/outline.js';
import { sparseTree } from '../core/sparse.js';

const cases = JSON.parse(readFileSync(new URL('./fixtures/emacs-sparse.json', import.meta.url), 'utf8'));

for (const c of cases) {
  test(`Emacs sparse tree ${c.id}`, () => {
    const a = analyze(c.input);
    const { folds } = sparseTree(c.input, a, { kind: c.kind, arg: c.arg });
    const hidden = hiddenLines(a.foldables, folds);
    const dots = ellipsisLines(a.foldables, folds);
    assert.deepEqual(c.visible.map((_, i) => !hidden.has(i)), c.visible);
    // Emacs reports an ellipsis on the very last line (the end of the buffer) that has nothing hidden under it; that line is left out.
    const last = c.visible.length - 1;
    assert.deepEqual(c.visible.map((v, i) => v && dots.has(i)).slice(0, last), c.ellipsis.map((e, i) => c.visible[i] && e).slice(0, last));
  });
}

test('the first TAB after a sparse tree folds the heading and drops what the tree held open', () => {
  const text = '* A\n** B\nmatch\n* C\n';
  const a = analyze(text);
  const { folds } = sparseTree(text, a, { kind: 'regexp', arg: 'match' });
  const r = cycle(a.foldables, folds, 0);
  assert.deepEqual(r.folds, { 0: 'all' });
});

test('an unfinished TODO is one that is not in the done states', () => {
  const text = '#+TODO: TODO NEXT | DONE\n* TODO A\n* DONE B\n* NEXT C\n';
  const a = analyze(text);
  assert.deepEqual(sparseTree(text, a, { kind: 'todo' }).lines, [1, 3]);
  assert.deepEqual(sparseTree(text, a, { kind: 'todo-keyword', arg: 'DONE' }).lines, [2]);
});

test('TAB on a heading the tree does not hold open cycles it as usual and leaves the tree alone', () => {
  const text = '* A\nbody\n* B\nmatch\n';
  const a = analyze(text);
  const { folds } = sparseTree(text, a, { kind: 'regexp', arg: 'match' });
  const r = cycle(a.foldables, folds, 0);
  assert.equal(r.folds[0], undefined);
  assert.equal(r.folds[3], 'show');
});

test('what a sparse tree highlights: the matched text, or the TODO keyword', () => {
  const text = '* TODO A :work:\nthe cat sat\n* DONE B\n';
  const a = analyze(text);
  assert.deepEqual(sparseTree(text, a, { kind: 'regexp', arg: 'cat' }).ranges, [{ line: 1, from: 4, to: 7 }]);
  assert.deepEqual(sparseTree(text, a, { kind: 'todo' }).ranges, [{ line: 0, from: 2, to: 6 }]);
  assert.deepEqual(sparseTree(text, a, { kind: 'match', arg: 'work' }).ranges, []);
});

// Match expressions and regexps over lines, from Emacs 30.1 (conformance v0.1.74, ms-* and sd-occur-*).
{
  const more = JSON.parse(readFileSync(new URL('./fixtures/emacs-sparse-match.json', import.meta.url), 'utf8'));
  for (const c of more) {
    test(`Emacs sparse tree ${c.id}`, () => {
      const a = analyze(c.input);
      if (c.error) { assert.throws(() => sparseTree(c.input, a, { kind: c.kind, arg: c.arg })); return; }
      const { folds } = sparseTree(c.input, a, { kind: c.kind, arg: c.arg });
      const hidden = hiddenLines(a.foldables, folds);
      assert.deepEqual(c.visible.map((_, i) => !hidden.has(i)).slice(0, -1), c.visible.slice(0, -1));
    });
  }
}

// By date (C-c / b, a, D): visible lines and the count Emacs reported for each case.
import { dateSparse } from '../core/sparse.js';
const dateCases = JSON.parse(readFileSync(new URL('./fixtures/emacs-sparse-dates.json', import.meta.url), 'utf8'));
for (const c of dateCases) {
  test(`Emacs sparse tree by date ${c.id}`, () => {
    const a = analyze(c.input);
    const r = dateSparse(c.input, a, { mode: c.mode, from: c.from, to: c.to });
    const hidden = hiddenLines(a.foldables, r.folds);
    const n = c.input.split('\n').length;
    assert.deepEqual(Array.from({ length: n }, (_, i) => !hidden.has(i)), c.visible.slice(0, n));
    assert.equal(r.count, Number(/^(\d+)/.exec(c.message)[1]));
  });
}

// C-c / d: deadlines past due or coming up (Emacs 30.1, run on 2026-11-28).
import { deadlineSparse } from '../core/sparse.js';
const dlCases = JSON.parse(readFileSync(new URL('./fixtures/emacs-sparse-deadlines.json', import.meta.url), 'utf8'));
for (const c of dlCases) {
  test(`Emacs deadline sparse tree ${c.id}`, () => {
    const a = analyze(c.input);
    const r = deadlineSparse(c.input, a, { days: c.days, today: c.today });
    const hidden = hiddenLines(a.foldables, r.folds);
    assert.deepEqual(c.visible.map((_, i) => !hidden.has(i)), c.visible);
    assert.equal(r.count, Number(/^(\d+)/.exec(c.message)[1]));
  });
}
