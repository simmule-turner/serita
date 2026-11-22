// Query replace. The cases are Emacs 30.1 results: the text and point left after the same answers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { expand, followCase, startReplace } from '../core/replace.js';

const cases = JSON.parse(readFileSync(new URL('./fixtures/emacs-replace.json', import.meta.url), 'utf8'));

for (const c of cases) {
  test(`Emacs query replace ${c.id}`, () => {
    const s = startReplace(c.input, { from: c.from_, to: c.to, regexp: c.regexp, at: c.at });
    for (const k of c.answers) s.answer(k);
    assert.equal(s.text, c.text);
    assert.equal(s.point, c.point);
  });
}

test('the replacement follows the case of the match', () => {
  assert.equal(followCase('bar', 'foo'), 'bar');
  assert.equal(followCase('bar', 'Foo'), 'Bar');
  assert.equal(followCase('bar', 'FOO'), 'BAR');
  assert.equal(followCase('bar', 'fOo'), 'bar');
  assert.equal(followCase('bar baz', 'Foo Bar'), 'Bar Baz');
  assert.equal(followCase('bar', 'F'), 'Bar');
});

test('regexp replacements: \\& \\N \\# and \\\\', () => {
  const m = /(f)(o+)/.exec('foo');
  assert.equal(expand('<\\&>', m, 0), '<foo>');
  assert.equal(expand('\\2\\1', m, 0), 'oof');
  assert.equal(expand('#\\#', m, 3), '#3');
  assert.equal(expand('a\\\\b', m, 0), 'a\\b');
  assert.throws(() => expand('\\3', m, 0));
  assert.throws(() => expand('\\q', m, 0));
});

test('answers: n skips, ^ goes back, q stops with the point on the match', () => {
  const s = startReplace('a a a', { from: 'a', to: 'b' });
  s.answer('y'); s.answer('n'); s.answer('^');
  assert.equal(s.text, 'b a a');
  s.answer('y');
  assert.equal(s.text, 'b b a');
  s.answer('q');
  assert.equal(s.done, true);
  assert.equal(s.count, 2);
});

test('an empty match advances so a replace cannot loop', () => {
  const s = startReplace('ab', { from: 'x*', to: '-', regexp: true });
  s.answer('!');
  assert.equal(s.text, '-a-b-');
});
