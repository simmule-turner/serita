import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parse, splitLines } from '../core/parse.js';
import { serialize } from '../core/serialize.js';
import { parseName, formatName } from '../core/names.js';

const rt = (t) => serialize(parse(t));

test('round trip: edge cases', () => {
  for (const t of ['', '\n', '\n\n', 'a', 'a\n', 'a\r\nb\r\n', 'a\r\nb\n', '* \n', '*\n', '  \t \n', 'x\r', '\r\n']) {
    assert.equal(rt(t), t, JSON.stringify(t));
  }
});

test('round trip: a realistic document', () => {
  const t = [
    '#+TITLE: Notes', '', '* TODO [#A] Write it   :work:home:', '  SCHEDULED: <2026-11-21 Sat>',
    ':PROPERTIES:', ':ID: 1', ':END:', '- [ ] one', '  + two', '1. three', '', '| a | b |', '|---+---|', '| 1 | 2 |',
    '#+begin_src js', '* not a headline', 'let x = 1', '#+end_src', '** DONE sub', '*bold* text', '',
  ].join('\n');
  assert.equal(rt(t), t);
});

test('round trip: seeded random documents', () => {
  const pieces = ['* H', '** TODO x :t:', '- item', '1. n', '| a |', '|--|', '#+begin_x', '#+end_x', '#+KEY: v', ': f', '# c',
    ':D:', ':END:', 'text', '', '   ', '*** ', 'SCHEDULED: <2026-01-01>', '[#A]', '\t- tab'];
  let seed = 12345;
  const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
  for (let n = 0; n < 300; n++) {
    const count = rnd(30);
    let t = '';
    for (let i = 0; i < count; i++) t += pieces[rnd(pieces.length)] + (rnd(5) === 0 ? '\r\n' : '\n');
    if (rnd(3) === 0) t = t.replace(/\r?\n$/, '');
    assert.equal(rt(t), t);
  }
});

test('splitLines keeps endings', () => {
  assert.deepEqual(splitLines('a\r\nb\nc'), [
    { text: 'a', eol: '\r\n' }, { text: 'b', eol: '\n' }, { text: 'c', eol: '' }]);
});

test('headline parts', () => {
  const h = parse('** TODO [#B] COMMENT Buy milk   :shop:@home:\n').root.children[0];
  assert.equal(h.level, 2);
  assert.equal(h.todo, 'TODO');
  assert.equal(h.priority, 'B');
  assert.equal(h.comment, true);
  assert.equal(h.title, 'Buy milk');
  assert.deepEqual(h.tags, ['shop', '@home']);
});

test('headline: no keyword unless configured, no tags without trailing colons', () => {
  const a = parse('* NEXT x\n').root.children[0];
  assert.equal(a.todo, null);
  const b = parse('* NEXT x\n', { todo: { open: ['NEXT'], done: ['DONE'] } }).root.children[0];
  assert.equal(b.todo, 'NEXT');
  assert.deepEqual(parse('* a :b\n').root.children[0].tags, []);
});

test('stars need a following space', () => {
  assert.equal(parse('*bold*\n').root.children[0].type, 'text');
  assert.equal(parse('* \n').root.children[0].type, 'headline');
});

test('tree nests by level, including skipped levels', () => {
  const r = parse('* a\n** b\n*** c\n** d\n* e\n').root;
  assert.deepEqual(r.children.map((n) => n.title), ['a', 'e']);
  assert.deepEqual(r.children[0].children.map((n) => n.title), ['b', 'd']);
  const s = parse('* a\n*** c\n').root;
  assert.equal(s.children[0].children[0].title, 'c');
});

test('preamble lines come before the first headline', () => {
  const r = parse('#+TITLE: x\ntext\n* h\n').root;
  assert.deepEqual(r.children.map((n) => n.type), ['keyword', 'text', 'headline']);
  assert.equal(r.children[0].key, 'TITLE');
  assert.equal(r.children[0].value, 'x');
});

test('a block hides headline-looking lines; an unterminated block does not', () => {
  const a = parse('#+begin_src js\n* x\n#+end_src\n').root.children;
  assert.deepEqual(a.map((n) => n.type), ['block-begin', 'block-line', 'block-end']);
  const b = parse('#+begin_src js\n* x\n').root.children;
  assert.equal(b[0].type, 'text');
  assert.equal(b[1].type, 'headline');
});

test('line kinds', () => {
  const kinds = (t) => parse(t).root.children.map((n) => n.type);
  assert.deepEqual(kinds('| a |\n|--+--|\n'), ['table-row', 'table-rule']);
  assert.deepEqual(kinds(':PROPERTIES:\n:END:\n'), ['drawer-begin', 'drawer-end']);
  assert.deepEqual(kinds('- a\n+ b\n1. c\n2) d\n  * e\n'), ['list-item', 'list-item', 'list-item', 'list-item', 'list-item']);
  assert.deepEqual(kinds('DEADLINE: <2026-01-01>\n# c\n: f\n\nplain\n'), ['planning', 'comment', 'fixed-width', 'blank', 'text']);
});

test('parsed trees are frozen', () => {
  const d = parse('* a\n');
  assert.throws(() => { 'use strict'; d.root.children.push({}); }, TypeError);
});

test('storage names', () => {
  assert.deepEqual(parseName('github:home.org'), { provider: 'github', path: 'home.org' });
  assert.deepEqual(parseName('local:notes.org'), { provider: 'local', path: 'notes.org' });
  assert.deepEqual(parseName('webdav:a/b.org'), { provider: 'webdav', path: 'a/b.org' });
  assert.deepEqual(parseName('notes.org'), { provider: 'local', path: 'notes.org' });
  assert.deepEqual(parseName('c:foo.org'), { provider: 'local', path: 'c:foo.org' });
  assert.equal(formatName('github', 'org/globals.el'), 'github:org/globals.el');
  assert.throws(() => formatName('ftp', 'x'));
});
