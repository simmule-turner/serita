import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseStringList, formatStringList } from '../core/lisp-list.js';
import { isEffort } from '../core/effort.js';

test('a list of storage names, as init.el writes it', () => {
  assert.deepEqual(parseStringList(`'("github:home.org" "github:journal.org")`), ['github:home.org', 'github:journal.org']);
  assert.deepEqual(parseStringList('()'), []);
  assert.equal(formatStringList(['webdav:home.org', 'local:work/plan.org']), '("webdav:home.org" "local:work/plan.org")');
  assert.equal(formatStringList([]), '()');
});

test('quotes and backslashes in a name survive', () => {
  const names = ['local:a "b".org', 'local:c\\d.org'];
  assert.deepEqual(parseStringList(formatStringList(names)), names);
});

test('text that is not a list of strings is refused', () => {
  assert.throws(() => parseStringList('home.org'), /list/);
  assert.throws(() => parseStringList('(home.org)'), /string/);
  assert.throws(() => parseStringList('("home.org)'), /closed/);
});

test('effort values Emacs accepted, and one it refused', () => {
  for (const ok of ['2:00', '0:30', '1:65', '2h', '30min', '1d', '1d 3h']) assert.equal(isEffort(ok), true, ok);
  assert.equal(isEffort('5'), true, 'Emacs takes a bare number');
  assert.equal(isEffort('abc'), false);
});

import { readFileSync } from 'node:fs';
import { setProperty } from '../core/properties.js';

const effort = JSON.parse(readFileSync(new URL('./fixtures/emacs-effort.json', import.meta.url), 'utf8'));
for (const c of effort) {
  test(`Emacs C-c C-x e: ${c.id}`, () => {
    const typed = c.keys.replace(/ RET$/, '').replace(/^C-c C-x e ?/, '').replace(/ /g, '');
    if (c.error) { assert.equal(isEffort(typed), false); return; }
    assert.equal(typed === '' || isEffort(typed), true);
    const line = c.input.split('\n')[c.line - 1].startsWith('*') ? c.line - 1 : 0;
    assert.equal(setProperty(c.input, line, 'Effort', typed).text, c.text);
    assert.equal(c.messages[0], `Effort is now ${typed}`);
  });
}
