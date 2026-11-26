// The universal argument against Emacs 30.1 with Org 9.7.11 (conformance v0.1.38): what C-u and numbers do to sorting, headings, TODO states and visibility.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { analyze, contents, cycleGlobal, hiddenLines, startupFolds } from '../core/outline.js';
import { cycleTodo, insertHeadingAfter, todoTarget } from '../core/outline-edit.js';
import { sortFunctions, sortRows } from '../core/table.js';

const F = JSON.parse(readFileSync(new URL('./fixtures/emacs-prefix-args.json', import.meta.url), 'utf8'));
const split = (keys) => { const m = /^C-c \^ ([fF]) (\S*) RET (\S*) RET$/.exec(keys); return m && { kind: m[1], key: m[2], compare: m[3] }; };

for (const [id, c] of Object.entries(F).filter(([k]) => k.startsWith('ua-sort-'))) {
  const f = split(c.keys);
  if (!f) continue;
  test(`Emacs sort with a function ${id}: ${c.keys}`, () => {
    if (c.error) { assert.throws(() => sortFunctions(f.key, f.compare), /void/); return; }
    assert.equal(sortRows(c.input, c.line - 1, c.col, f.kind, sortFunctions(f.key, f.compare)).text, c.text);
  });
}

test('sort with a function: an empty name is refused', () => {
  assert.throws(() => sortFunctions('', ''));
});

const headLine = (text, line) => [...analyze(text).heads].reverse().find((h) => h.line <= line - 1).line;
for (const [id, c] of Object.entries(F).filter(([k]) => /^ua-ih-C-u(_C-u)?_M-RET-|^ua-ih-body-cu/.test(k))) {
  test(`Emacs heading with a prefix ${id}: ${c.keys}`, () => {
    const r = insertHeadingAfter(c.input, headLine(c.input, c.line), '', c.keys.startsWith('C-u C-u'));
    assert.equal(r.text, c.text);
    assert.equal(r.line + 1, c.point.line);
  });
}

const kw = (keys) => { const m = /^C-(\d) C-c C-t$/.exec(keys); return m ? { num: Number(m[1]) } : keys === 'C-u C-u C-c C-t' ? { list: 16 } : null; };
for (const [id, c] of Object.entries(F).filter(([k]) => k.startsWith('ua-td-'))) {
  const a = kw(c.keys);
  if (!a) continue;
  test(`Emacs TODO state with a prefix ${id}: ${c.keys} on line ${c.line}`, () => {
    const todo = analyze(c.input).todo;
    const from = analyze(c.input).heads.find((h) => h.line === c.line - 1).todo;
    const to = todoTarget(a, todo, from);
    assert.equal(cycleTodo(c.input, c.line - 1, 1, 77, to).text.replace(/ +\n/g, '\n'), c.text.replace(/ +\n/g, '\n'));
  });
}

const H = F['ua-cy-C-2_backtab'].input;
for (const n of [1, 2, 3]) {
  test(`Emacs C-${n} S-TAB shows the headings down to level ${n}`, () => {
    const a = analyze(H);
    const hidden = hiddenLines(a.heads, contents(a.heads, n));
    const lines = H.split('\n').slice(0, -1).map((_, i) => !hidden.has(i));
    assert.deepEqual(lines, F[`ua-cy-C-${n}_backtab`].lines.slice(0, lines.length));
  });
}

test('Emacs S-TAB steps overview, contents, show all', () => {
  const a = analyze(H);
  const vis = (folds) => H.split('\n').slice(0, -1).map((_, i) => !hiddenLines(a.heads, folds).has(i));
  const one = cycleGlobal(a.heads, {});
  assert.deepEqual(vis(one.folds), F['ua-cy-backtab'].lines.slice(0, 9));
  const two = cycleGlobal(a.heads, one.folds);
  assert.deepEqual(vis(two.folds), F['ua-cy-backtab_backtab'].lines.slice(0, 9));
  assert.deepEqual(vis(startupFolds(H)), F['ua-cy-C-u_C-u_TAB'].lines.slice(0, 9));
});
