import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NONE, argLabel, argValue, pressDigit, pressU } from '../core/universal.js';

test('C-u multiplies by four and a fourth button press clears it', () => {
  let s = pressU(NONE, true);
  assert.deepEqual(argValue(s), { list: 4 });
  s = pressU(pressU(s, true), true);
  assert.deepEqual(argValue(s), { list: 64 });
  assert.equal(argLabel(s), 'C-u C-u C-u');
  assert.equal(argValue(pressU(s, true)), null);
  assert.deepEqual(argValue(pressU(s)), { list: 256 });
});

test('digits make a number, C-- is -1, and a digit replaces C-u', () => {
  let s = pressDigit(pressDigit(NONE, '1'), '2');
  assert.deepEqual(argValue(s), { num: 12 });
  assert.equal(argLabel(s), 'C-12');
  assert.deepEqual(argValue(pressDigit(NONE, '-')), { num: -1 });
  assert.deepEqual(argValue(pressDigit(pressDigit(NONE, '-'), '3')), { num: -3 });
  assert.deepEqual(argValue(pressDigit(pressU(NONE), '3')), { num: 3 });
  assert.equal(argValue(pressDigit(pressDigit(NONE, '3', true), '3', true)), null);
});
