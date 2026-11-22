// Emacs regexp syntax. Each case is an Emacs 30.1 result: a forward regexp search from `start` ended with point at `end`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { emacsRegexp, hasUpper } from '../core/regexp.js';

const cases = JSON.parse(readFileSync(new URL('./fixtures/emacs-regexp.json', import.meta.url), 'utf8'));

/** Where a forward regexp search leaves point: the end of the first match that starts at or after `start`. */
function search(text, pattern, start) {
  const re = emacsRegexp(pattern, !hasUpper(pattern));
  re.lastIndex = start;
  const m = re.exec(text);
  return m ? m.index + m[0].length : null;
}

for (const c of cases) {
  test(`Emacs regexp ${c.id}: ${c.pattern}`, () => {
    if (c.throws) { assert.throws(() => emacsRegexp(c.pattern)); return; }
    if (c.fails) { assert.equal(search(c.input, c.pattern, c.start), null); return; } // an incremental search stays on the last text that matched
    assert.equal(search(c.input, c.pattern, c.start), c.end);
  });
}

test('an uppercase letter outside an escape makes a regexp exact', () => {
  assert.equal(hasUpper('foo'), false);
  assert.equal(hasUpper('Foo'), true);
  assert.equal(hasUpper('\\Sw+'), false);
});

test('unsupported and invalid constructs are errors', () => {
  for (const p of ['\\(a', 'a\\)', '[a', 'a\\{2', '\\cg', '\\2', 'a\\']) assert.throws(() => emacsRegexp(p), undefined, p);
});

test('shy groups, intervals and lazy operators', () => {
  const m = (p, t) => emacsRegexp(p).exec(t)?.[0];
  assert.equal(m('\\(?:ab\\)\\{2\\}', 'xababab'), 'abab');
  assert.equal(m('a.\\{,2\\}b', 'axxb'), 'axxb');
  assert.equal(m('a+?', 'aaa'), 'a');
  assert.equal(m('\\(a\\|b\\)\\1', 'abba'), 'bb');
});
