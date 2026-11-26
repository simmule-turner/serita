// Table formula commands. The cases are what Emacs 30.1 / Org 9.7.11 did for the same keys (conformance v0.1.41 and v0.1.42).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { recalculate, recalculateBuffer, iterateBuffer, setFormula, formulasOf, evalFieldFormula, editorText, installFormulas, historyText } from '../core/tblcmd.js';

const cases = JSON.parse(readFileSync(new URL('./fixtures/emacs-tblcmd.json', import.meta.url), 'utf8'));
const MODE = { 'C-c *': 'row', 'C-u C-c *': 'all', 'C-u C-u C-c *': 'iterate' };

for (const c of cases) {
  if (!MODE[c.keys]) continue;
  test(`Emacs ${c.id}: ${c.question}`, () => {
    const r = recalculate(c.input, c.line, MODE[c.keys]);
    assert.deepEqual({ text: r.text, failed: !!r.error }, { text: c.text, failed: !!c.error });
    const said = c.texts.filter((t) => /formulas|Convergence/.test(t));
    assert.deepEqual(r.message ? [r.message] : [], said);
  });
}

test('Emacs cm-30: C-c C-c in a field that starts with = sets the column formula and does that row', () => {
  const c = cases.find((x) => x.id === 'cm-30');
  assert.equal(evalFieldFormula(c.input, c.line, 2).text, c.text);
});
test('a field that does not start with = is left alone', () => assert.equal(evalFieldFormula('| 1 | := 2 |\n', 0, 1), null));

test('a formula can be set, replaced and removed', () => {
  const T = '| a | b | c |\n|---+---+---|\n| 1 | 2 |   |\n#+TBLFM: $3=$1+$2\n';
  const a = setFormula(T, 2, '@3$3', '$1*10');
  assert.match(a.text, /#\+TBLFM: \$3=\$1\+\$2 :: @3\$3=\$1\*10/);
  assert.deepEqual(formulasOf(a.text, 2).map((f) => f.lhs), ['$3', '@3$3']);
  assert.equal(setFormula(T, 2, '$3', '').text.includes('#+TBLFM'), false);
  assert.equal(setFormula('| a |\n', 0, '$1', '1+1').text, '| a |\n#+TBLFM: $1=1+1\n');
});
test('every table in a buffer', () => {
  const T = '| 1 | 2 |   |\n#+TBLFM: $3=$1+$2\n';
  assert.equal(recalculateBuffer(`${T}\n${T}`).count, 2);
});

test('C-c \' text lists the formulas by kind and installing it writes one #+TBLFM: line', () => {
  const t = '| a | b | c |\n|---+---+---|\n| 1 | 2 |   |\n#+TBLFM: $3=$1+$2::@2$3=7::@>$2=5::$1=$2;N\n';
  assert.equal(editorText(t, 2), '# Field and Range Formulas\n@>$2 = 5\n\n# Column Formulas\n$1 = $2;N\n$3 = $1+$2\n@2$3 = 7\n');
  assert.equal(editorText('| a |\n#+TBLFM: $y=1::$1=2\n', 0), '# Column Formulas\n$1 = 2\n\n# Named Field Formulas\n$y = 1\n');
  assert.equal(installFormulas(t, 2, '# Column Formulas\n$3 = $1+$2\n$4 = 1\n$5\n$6=\n= 1\n\n# note').text.split('\n')[3], '#+TBLFM: $3=$1+$2::$4=1');
  assert.equal(installFormulas(t, 2, '$4 = 1 :: $5=2').text.split('\n')[3], '#+TBLFM: $4=1 :: $5=2');
  assert.equal(installFormulas(t, 2, '').text.split('\n')[3], '#+TBLFM: ');
  assert.ok(installFormulas(t, 2, '$3 = 1\n$3 = 9').error);
});

const DEBUG = { 'c4-00': 'row', 'c4-02': 'all', 'c4-04': 'row', 'c4-05': 'row', 'c4-06': 'row' };
for (const c of cases.filter((x) => DEBUG[x.id])) {
  test(`Emacs ${c.id}: ${c.question}`, () => {
    const r = recalculate(c.input, c.line, DEBUG[c.id], { trace: [] });
    const want = c.texts.find((t) => t.startsWith('DEBUGBUF:')).slice(9);
    assert.equal(historyText(r.trace.at(-1)), want);
    assert.equal(r.text, c.text);
  });
}

test('stopping the formula debugger keeps the fields before the one it stopped at', () => {
  const t = '| a | b | c |\n|---+---+---|\n| 1 | 2 |   |\n| 3 | 4 |   |\n#+TBLFM: $3=$1+$2\n';
  const r = recalculate(t, 2, 'all', { trace: [], limit: 1 });
  assert.equal(r.error, 'Abort');
  assert.equal(r.text.split('\n')[2], '| 1 | 2 | 3 |');
  assert.equal(r.text.split('\n')[3], '| 3 | 4 |   |');
  assert.equal(recalculate(t, 2, 'all', { trace: [], limit: 0 }).text, t);
});

const iterateCases = JSON.parse(readFileSync(new URL('./fixtures/emacs-iterate.json', import.meta.url), 'utf8'));
for (const c of iterateCases) {
  test(`Emacs ${c.id}: org-table-iterate-buffer-tables, ${c.question}`, () => {
    const r = iterateBuffer(c.input);
    assert.equal(r.text, c.text);
    assert.equal(!!r.error, !!c.error);
    assert.deepEqual(r.message ? [r.message] : [], c.texts);
  });
}
