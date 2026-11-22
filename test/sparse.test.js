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
