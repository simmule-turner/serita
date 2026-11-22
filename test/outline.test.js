import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyze, contents, cycle, cycleGlobal, diff, ellipsisLines, hiddenLines, overview, remapFolds, reveal, startupFolds, todoOptions, validFolds } from '../core/outline.js';
import { changeLevel, cycleTodo, indentItem, insertHeadingAfter, moveItem, moveSubtree, setTags, setTitle, toggleCheckbox } from '../core/outline-edit.js';

const DOC = '#+TITLE: x\n* A\nbody\n** B\nb body\n** C\n* D\nd body\n';
const heads = analyze(DOC).heads;

test('headings know their lines, subtree end and own-text end', () => {
  assert.deepEqual(heads.map((h) => [h.line, h.level, h.end, h.bodyEnd]), [[1, 1, 6, 3], [3, 2, 5, 5], [5, 2, 6, 6], [6, 1, 8, 8]]);
});

test('a heading inside a block is not a heading', () => {
  assert.equal(analyze('* A\n#+begin_src\n* not\n#+end_src\n').heads.length, 1);
});

test('TAB on a heading cycles folded, children, subtree', () => {
  let f = {};
  const seen = [];
  for (let i = 0; i < 4; i++) { const r = cycle(heads, f, 1); seen.push(r.state); f = r.folds; }
  assert.deepEqual(seen, ['folded', 'children', 'subtree', 'folded']);
});

test('children shows the heading text and the sub-headings, folded', () => {
  const r = cycle(heads, { 1: 'all' }, 1);
  assert.deepEqual(r.folds, { 3: 'all' });
  assert.deepEqual([...hiddenLines(heads, r.folds)], [4]);
});

test('a heading with nothing under it does not cycle', () => {
  assert.equal(cycle(heads, {}, 5), null);
});

test('a heading with only text cycles between folded and subtree', () => {
  const h = analyze('* A\ntext\n').heads;
  assert.equal(cycle(h, {}, 0).state, 'folded');
  assert.equal(cycle(h, { 0: 'all' }, 0).state, 'subtree');
});

test('an ellipsis marks each heading that hides something', () => {
  assert.deepEqual([...ellipsisLines(heads, { 1: 'all', 5: 'all' })], [1]);
});

test('global cycling goes overview, contents, show all', () => {
  const a = cycleGlobal(heads, {});
  assert.equal(a.state, 'overview');
  assert.deepEqual(a.folds, { 1: 'all', 6: 'all' });
  const b = cycleGlobal(heads, a.folds);
  assert.equal(b.state, 'contents');
  assert.deepEqual(b.folds, contents(heads));
  assert.deepEqual(cycleGlobal(heads, b.folds), { folds: {}, state: 'show all' });
});

test('the text before the first heading stays visible in overview', () => {
  assert.ok(!hiddenLines(heads, overview(heads)).has(0));
});

test('#+STARTUP picks the folds; without it everything is shown', () => {
  assert.deepEqual(startupFolds(DOC), {});
  assert.deepEqual(startupFolds(`#+STARTUP: overview\n${DOC}`), overview(analyze(`#+STARTUP: overview\n${DOC}`).heads));
  const t = '#+STARTUP: show2levels\n* A\ntext\n** B\nb\n*** C\nc\n';
  const hs = analyze(t).heads;
  assert.deepEqual(hiddenLines(hs, startupFolds(t)), new Set([2, 4, 5, 6]));
});

test('TODO sequences come from #+TODO lines, with fast keys dropped', () => {
  const o = todoOptions('#+TODO: TODO(t) | DONE(d)\n#+TODO: REPORT(r) BUG(b) | FIXED(f)\n');
  assert.deepEqual(o.sequences, [{ open: ['TODO'], done: ['DONE'] }, { open: ['REPORT', 'BUG'], done: ['FIXED'] }]);
});

test('folds follow the lines when text is inserted or removed above them', () => {
  assert.deepEqual(remapFolds({ 1: 'all', 6: 'all' }, DOC, 0, 0, 'new\n'), { 2: 'all', 7: 'all' });
  assert.deepEqual(remapFolds({ 1: 'all', 6: 'all' }, DOC, 11, 15, ''), { 1: 'all', 5: 'all' });
  assert.deepEqual(validFolds(analyze('* A\n* B\n').heads, { 0: 'all' }), {});
});

test('diff finds the one replacement between two texts', () => {
  assert.deepEqual(diff('abcdef', 'abXYef'), { from: 2, to: 4, insert: 'XY' });
  assert.deepEqual(diff('abc', 'abc'), { from: 3, to: 3, insert: '' });
});

test('reveal opens the folds that hide a line', () => {
  assert.deepEqual(reveal(heads, { 1: 'all', 6: 'all' }, 4), { 6: 'all' });
});

test('promote and demote change one heading; the subtree variants change all of it', () => {
  assert.equal(changeLevel(DOC, 1, 1, false).text, DOC.replace('* A', '** A'));
  assert.equal(changeLevel(DOC, 1, 1, true).text, DOC.replace('* A', '** A').replace('** B', '*** B').replace('** C', '*** C'));
  assert.throws(() => changeLevel(DOC, 1, -1, false), /Cannot promote to level 0/);
});

test('moving a subtree swaps it with its sibling, and folds go with it', () => {
  const r = moveSubtree(DOC, 3, 1);
  assert.equal(r.text, '#+TITLE: x\n* A\nbody\n** C\n** B\nb body\n* D\nd body\n');
  assert.equal(r.line, 4);
  assert.equal(r.remap(3), 4);
  assert.equal(r.remap(5), 3);
  assert.throws(() => moveSubtree(DOC, 5, 1), /Cannot move past/);
  assert.equal(moveSubtree('* A\n* B', 0, 1).text, '* B\n* A');
});

test('a new heading goes after the subtree, at the same level', () => {
  const r = insertHeadingAfter(DOC, 1);
  assert.equal(r.text, '#+TITLE: x\n* A\nbody\n** B\nb body\n** C\n* \n* D\nd body\n');
  assert.equal(r.line, 6);
  assert.equal(insertHeadingAfter('* A', 0).text, '* A\n* ');
});

test('TODO cycles none, first, to last, none, within the sequence the heading is in', () => {
  let t = '* A\n';
  const seen = [];
  for (let i = 0; i < 4; i++) { t = cycleTodo(t, 0).text; seen.push(t.trim()); }
  assert.deepEqual(seen, ['* TODO A', '* DONE A', '* A', '* TODO A']);
  assert.equal(cycleTodo('#+TODO: A B | C\n* B x\n', 1).text, '#+TODO: A B | C\n* C x\n');
});

test('tags are set at column 77 and removed again', () => {
  const t = setTags('* A\n', 0, ['work', 'home']).text;
  assert.equal(t.trimEnd().length, 77);
  assert.ok(t.startsWith('* A ') && t.trimEnd().endsWith(':work:home:'));
  assert.equal(setTags(t, 0, []).text, '* A\n');
});

test('a checkbox toggles between [ ] and [X]', () => {
  assert.equal(toggleCheckbox('- [ ] a\n', 0).text, '- [X] a\n');
  assert.equal(toggleCheckbox('  1. [X] a\n', 0).text, '  1. [ ] a\n');
  assert.equal(toggleCheckbox('- plain\n', 0), null);
});

test('list items own the deeper-indented lines under them, and fold like headings', () => {
  const doc = '* H\n- a\n  - b\n  text\n- c\n';
  const a = analyze(doc);
  assert.deepEqual(a.items.map((i) => [i.line, i.indent, i.end]), [[1, 0, 4], [2, 2, 3], [4, 0, 5]]);
  assert.equal(a.items[1].parent, a.items[0]);
  assert.deepEqual([...hiddenLines(a.foldables, { 1: 'all' })], [2, 3]);
  assert.equal(cycle(a.foldables, {}, 1).state, 'folded');
});

test('a second blank line ends a list item', () => {
  assert.equal(analyze('- a\n  b\n\n\n  c\n').items[0].end, 2);
});

test('toggling a checkbox updates the parent checkbox and the cookies', () => {
  const t = '* Todo [0/1]\n- [ ] Parent [0/2]\n  - [ ] a\n  - [ ] b\n- plain\n';
  const one = toggleCheckbox(t, 2).text;
  assert.equal(one, '* Todo [0/1]\n- [-] Parent [1/2]\n  - [X] a\n  - [ ] b\n- plain\n');
  const two = toggleCheckbox(one, 3).text;
  assert.equal(two, '* Todo [1/1]\n- [X] Parent [2/2]\n  - [X] a\n  - [X] b\n- plain\n');
  assert.equal(toggleCheckbox(two, 2).text.split('\n')[1], '- [-] Parent [1/2]');
  assert.equal(toggleCheckbox('- [ ] a [0%]\n  - [ ] b\n', 1).text, '- [X] a [100%]\n  - [X] b\n');
});

test('list items move with their sub-items, and an ordered list keeps its numbers', () => {
  assert.equal(moveItem('1. a\n   - x\n2. b\n3. c\n', 0, 1).text, '1. b\n2. a\n   - x\n3. c\n');
  assert.equal(moveItem('- a\n- b', 0, 1).text, '- b\n- a');
  assert.throws(() => moveItem('- a\n- b\n', 0, -1), /Cannot move the item further/);
});

test('indenting a list item makes it a sub-item; outdenting moves it out; sub-items stay unless asked', () => {
  assert.equal(indentItem('- a\n- b\n', 1, 1, false).text, '- a\n  - b\n');
  assert.equal(indentItem('- a\n  - b\n', 1, -1, false).text, '- a\n- b\n');
  assert.equal(indentItem('- a\n- b\n  - c\n', 1, 1, true).text, '- a\n  - b\n    - c\n');
  assert.equal(indentItem('- a\n- b\n  - c\n', 1, 1, false).text, '- a\n  - b\n  - c\n');
  assert.throws(() => indentItem('- a\n', 0, 1, false), /Cannot indent/);
  assert.throws(() => indentItem('- a\n', 0, -1, false), /Cannot outdent/);
});

test('a heading title is replaced without touching the stars, TODO word, priority or tags', () => {
  const t = setTitle('** TODO [#A] Old title :x:\n', 0, 'New\ntitle').text;
  assert.ok(t.startsWith('** TODO [#A] New title '));
  assert.ok(t.trimEnd().endsWith(':x:') && t.trimEnd().length === 77);
  assert.equal(setTitle('* A\n', 0, '  B  ').text, '* B\n');
});

test('a new heading can be given its title', () => {
  assert.equal(insertHeadingAfter('* A\n', 0, 'New one').text, '* A\n* New one');
});

test('the tags column: negative ends the line there, positive starts the tags there, 0 is one space', () => {
  const at = (title, column) => setTags(title, 0, ['work'], column).text.replace(/\n$/, '');
  const short = '* Work item\n';
  assert.equal(at(short, -60).length, 60);
  assert.equal(at(short, -100).length, 100);
  assert.equal(at(short, 40).indexOf(':work:'), 40);
  assert.equal(at(short, 0), '* Work item :work:');
  assert.equal(at(short, 10), '* Work item :work:');
  const long = '* A rather long heading title here that goes on for quite a while\n';
  assert.equal(at(long, -60), '* A rather long heading title here that goes on for quite a while :work:');
  assert.equal(at(long, 40), '* A rather long heading title here that goes on for quite a while :work:');
  assert.equal(setTags('* Work item :a:b:\n', 0, ['a', 'b'], -50).text.trimEnd().length, 50);
  assert.equal(setTags(short, 0, ['work']).text.trimEnd().length, 77);
});
