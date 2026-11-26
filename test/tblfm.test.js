import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { recalc } from '../core/tblfm.js';
import { evaluate, text } from '../core/calc.js';

const cases = JSON.parse(readFileSync(new URL('./fixtures/emacs-tblfm.json', import.meta.url), 'utf8'));

// What this does not do yet, by case id; each is checked to still differ, so finishing one means deleting its line here.
const PENDING = {
  'tf-edge-11': 'an unknown flag letter', 'tf-edge-18': '$1.5 read as a quirk of Org', 'tf-edge-19': 'string literals in Calc',
  'tf-edge-28': 'the word mod', 'tf-edge-30': 'binary 0b literals', 'tf-edge-31': 'string arithmetic', 'tf-hl-09': 'hline targets such as @+I',
  'tf-lisp-07': 'remote() and Lisp', 'tf-name-8': 'remote()', 'tf-text-02': 'the E flag', 'tf-text-04': 'symbolic sums of text', 'tf-text-05': 'symbolic means of text',
  'dt-11': 'the time now', 'dt-13': 'now() minus now()', 'dt-26': 'symbolic pi', 'dt-35': 'symbolic mode', 'dt-37': 'symbolic e',
  'mk-7': 'names from a ^ row', 'mk-8': 'remote()', 'mk-9': 'remote()', 'nm-cell-13': 'a number with _', 'nm-cell-14': 'a 0x literal',
  'nm-fmt-26': 'a | inside a format', 'nm-radix-fix': 'f2 in another base', 'tm-22': 'T with a digit', 'tm-24': 'N on a time',
};

for (const c of cases) {
  if (!/^#\+TBLFM:/i.test(c.input.split('\n')[c.line] ?? '')) continue;
  test(`Emacs ${c.id}: ${c.input.split('\n')[c.line]}`, () => {
    const was = process.env.TZ;
    process.env.TZ = c.tz ?? 'UTC';
    const got = recalc(c.input, c.line, { radix: c.radix, digits: c.digits, constants: c.constants ? new Map(Object.entries(c.constants)) : undefined });
    process.env.TZ = was ?? '';
    if (was === undefined) delete process.env.TZ;
    const same = got.text === c.text && !!got.error === !!c.error;
    if (PENDING[c.id]) assert.ok(!same, `${c.id} now matches Emacs; remove it from PENDING`);
    else assert.deepEqual({ text: got.text, failed: !!got.error }, { text: c.text, failed: !!c.error });
  });
}

test('integers and fractions are exact however large, and decimals are kept to 12 digits', () => {
  const t = (s) => text(evaluate(s));
  assert.equal(t('2^100'), '1267650600228229401496703205376');
  assert.equal(t('1:2+1'), '3:2');
  assert.equal(t('1/3'), '0.33333333');
  assert.equal(t('0.1+0.2'), '0.3');
  assert.equal(t('1/0'), '1/0');
  assert.equal(text(evaluate('1/3', { prec: 20 }), { mode: 'float', digits: 20 }), '0.33333333333333333333');
});
