import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chordOf, createKeymap, TEXT_KEYS } from '../app/ui/keys.js';

test('key presses are named as Emacs names them', () => {
  assert.equal(chordOf({ key: 'Tab' }), 'TAB');
  assert.equal(chordOf({ key: 'Tab', shift: true }), '<backtab>');
  assert.equal(chordOf({ key: 'ArrowUp', meta: true }), 'M-<up>');
  assert.equal(chordOf({ key: 'ArrowLeft', meta: true, shift: true }), 'M-S-<left>');
  assert.equal(chordOf({ key: 'Enter', ctrl: true }), 'C-RET');
  assert.equal(chordOf({ key: 'C', ctrl: true }), 'C-c');
  assert.equal(chordOf({ key: 'a' }), null);
  assert.equal(chordOf({ key: 'Shift' }), null);
});

test('C-c is a prefix; C-c C-t runs the TODO command', () => {
  const k = createKeymap(TEXT_KEYS);
  assert.deepEqual(k.press('C-c'), { kind: 'prefix', echo: 'C-c-' });
  assert.equal(k.pending(), 'C-c');
  assert.deepEqual(k.press('C-t'), { kind: 'run', command: 'todo' });
  assert.equal(k.pending(), '');
});

test('a key with no binding after a prefix says so, and C-g quits', () => {
  const k = createKeymap(TEXT_KEYS);
  k.press('C-c');
  assert.deepEqual(k.press('C-z'), { kind: 'none', echo: 'C-c C-z is undefined' });
  k.press('C-c');
  assert.deepEqual(k.press('C-g'), { kind: 'none', echo: 'Quit' });
  assert.deepEqual(k.press('C-x'), { kind: 'none' });
});
