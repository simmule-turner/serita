// Property drawers, priorities and TODO states. The expected texts are what Emacs 29.3 gave in batch mode (cases prop-*, pri-*, todo2-*).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deleteProperty, propertiesOf, propertyNames, setProperty } from '../core/properties.js';
import { cycleTodo, stepPriority, setPriority } from '../core/outline-edit.js';
import { analyze, startupFolds } from '../core/outline.js';

test('a property in a heading with no drawer creates the drawer and reports its line', () => {
  const r = setProperty('* H\nbody\n', 0, 'Foo', 'bar');
  assert.equal(r.text, '* H\n:PROPERTIES:\n:Foo:      bar\n:END:\nbody\n');
  assert.equal(r.drawer, 1);
});

test('the drawer goes after a planning line', () => {
  assert.equal(setProperty('* TODO H\nSCHEDULED: <2025-01-06 Mon>\nbody\n', 0, 'Foo', 'bar').text,
    '* TODO H\nSCHEDULED: <2025-01-06 Mon>\n:PROPERTIES:\n:Foo:      bar\n:END:\nbody\n');
});

test('an existing property is changed, a new one is added at the end of the drawer', () => {
  assert.equal(setProperty('* H\n:PROPERTIES:\n:Foo: bar\n:END:\n', 0, 'Foo', 'new').text, '* H\n:PROPERTIES:\n:Foo:      new\n:END:\n');
  assert.equal(setProperty('* H\n:PROPERTIES:\n:Foo: bar\n:END:\nbody\n', 0, 'Baz', 'qux').text, '* H\n:PROPERTIES:\n:Foo: bar\n:Baz:      qux\n:END:\nbody\n');
});

test('deleting a property; the drawer goes with the last one', () => {
  assert.equal(deleteProperty('* H\n:PROPERTIES:\n:Foo: bar\n:Baz: qux\n:END:\n', 0, 'Foo').text, '* H\n:PROPERTIES:\n:Baz: qux\n:END:\n');
  assert.equal(deleteProperty('* H\n:PROPERTIES:\n:Foo: bar\n:END:\nbody\n', 0, 'Foo').text, '* H\nbody\n');
  assert.throws(() => deleteProperty('* H\n', 0, 'Foo'), /No such property: Foo/);
});

test('properties are listed per heading and names collected for completion', () => {
  const t = '* A\n:PROPERTIES:\n:Foo: 1\n:END:\n* B\n:PROPERTIES:\n:Bar: 2\n:Foo: 3\n:END:\n';
  assert.deepEqual(propertiesOf(t, 4), [['Bar', '2'], ['Foo', '3']]);
  assert.deepEqual(propertyNames(t).sort(), ['Bar', 'Foo']);
});

test('drawers are folded at startup, whatever the startup view', () => {
  const t = '* H\n:PROPERTIES:\n:Foo: bar\n:END:\nbody\n';
  assert.equal(startupFolds(t)[1], 'all');
  assert.equal(analyze(t).drawers.length, 1);
});

test('priorities: S-up and S-down as Emacs does them', () => {
  const step = (t, dir, n = 1) => { for (let i = 0; i < n; i++) t = stepPriority(t, 0, dir).text; return t; };
  assert.equal(step('* TODO A\n', -1), '* TODO [#B] A\n');
  assert.equal(step('* TODO A\n', -1, 2), '* TODO [#A] A\n');
  assert.equal(step('* TODO [#A] A\n', -1), '* TODO A\n');
  assert.equal(step('* TODO A\n', 1), '* TODO [#B] A\n');
  assert.equal(step('* TODO A\n', 1, 2), '* TODO [#C] A\n');
  assert.equal(step('* TODO [#C] A\n', 1), '* TODO A\n');
  assert.equal(step('* Plain\n', -1), '* [#B] Plain\n');
  assert.equal(step('* TODO A :work:\n', -1), `* TODO [#B] A${' '.repeat(58)}:work:\n`);
  assert.equal(setPriority('* TODO A\n', 0, 'B').text, '* TODO [#B] A\n');
});

test('TODO states: S-right and S-left walk a sequence both ways, and tags are aligned again', () => {
  const t = '#+TODO: TODO NEXT | DONE\n* A\n';
  const go = (s, dir, n = 1) => { for (let i = 0; i < n; i++) s = cycleTodo(s, 1, dir).text; return s; };
  assert.equal(go(t, 1), '#+TODO: TODO NEXT | DONE\n* TODO A\n');
  assert.equal(go(t, 1, 3), '#+TODO: TODO NEXT | DONE\n* DONE A\n');
  assert.equal(go(t, -1), '#+TODO: TODO NEXT | DONE\n* DONE A\n');
  assert.equal(go('#+TODO: TODO NEXT | DONE\n* DONE A\n', -1), '#+TODO: TODO NEXT | DONE\n* NEXT A\n');
  assert.equal(cycleTodo('* [#A] Title :x:\n', 0).text, `* TODO [#A] Title${' '.repeat(57)}:x:\n`);
});

test('a parent\'s statistics cookie follows its children\'s TODO states', () => {
  const twice = (t) => cycleTodo(cycleTodo(t, 1).text, 1).text; // TODO, DONE, then no state
  assert.equal(cycleTodo('* H [0/2]\n** TODO a\n** TODO b\n', 1).text.split('\n')[0], '* H [1/2]');
  assert.equal(twice('* H [0/2]\n** TODO a\n** TODO b\n'), '* H [0/1]\n** a\n** TODO b\n');
  assert.equal(twice('* H [0%]\n** TODO a\n** TODO b\n'), '* H [0%]\n** a\n** TODO b\n');
  assert.equal(cycleTodo('* H [/]\n** a\n** TODO b\n', 1).text.split('\n')[0], '* H [0/2]');
});
