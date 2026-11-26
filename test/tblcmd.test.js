// Table formula commands. Messages are what Emacs 30.1 / Org 9.7.11 showed (conformance v0.1.41).
import test from 'node:test';
import assert from 'node:assert/strict';
import { recalculate, recalculateBuffer, setFormula, formulasOf } from '../core/tblcmd.js';

const T = '| a | b | c |\n|---+---+---|\n| 1 | 2 |   |\n| 3 | 4 |   |\n#+TBLFM: $3=$1+$2\n';

test('C-c * recalculates the row and says so', () => {
  const r = recalculate(T, 2, 'row');
  assert.equal(r.text, '| a | b | c |\n|---+---+---|\n| 1 | 2 | 3 |\n| 3 | 4 |   |\n#+TBLFM: $3=$1+$2\n');
  assert.equal(r.message, 'Re-applying formulas... done');
});
test('C-u C-c * does every row, silently', () => {
  const r = recalculate(T, 2, 'all');
  assert.match(r.text, /\| 3 \| 4 \| 7 \|/);
  assert.equal(r.message, undefined);
});
test('C-u C-u C-c * iterates until stable', () => assert.equal(recalculate(T, 2, 'iterate').message, 'Convergence after 2 iterations'));
test('a formula can be set, replaced and removed', () => {
  const a = setFormula(T, 2, '@3$3', '$1*10');
  assert.match(a.text, /#\+TBLFM: \$3=\$1\+\$2 :: @3\$3=\$1\*10/);
  assert.deepEqual(formulasOf(a.text, 2).map((f) => f.lhs), ['$3', '@3$3']);
  assert.equal(setFormula(T, 2, '$3', '').text.includes('#+TBLFM'), false);
  assert.equal(setFormula('| a |\n', 0, '$1', '1+1').text, '| a |\n#+TBLFM: $1=1+1\n');
});
test('every table in a buffer', () => assert.equal(recalculateBuffer(`${T}\n${T}`).message, '2 tables recalculated'));
test('outside a table', () => assert.equal(recalculate('x\n', 0, 'row').error, 'Not in table'));
