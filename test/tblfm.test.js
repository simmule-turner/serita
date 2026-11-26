import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { recalc } from '../core/tblfm.js';
import { evaluate, text } from '../core/calc.js';

const cases = JSON.parse(readFileSync(new URL('./fixtures/emacs-tblfm.json', import.meta.url), 'utf8'));

// What this does not do yet, by case id; each is checked to still differ, so finishing one means deleting its line here.
const PENDING = {
  'dt-11': 'the time now', 'sy-now-0': 'the time now', 'sy-now-2': 'the time now', 'sy-now-3': 'the time now',
  'nm-cell-13': 'a number with _', 'lit-c02': 'a number with _', 'lit-f02': 'a number with _', 'lit-c10': 'a number with a comma', 'lit-f10': 'a number with a comma',
  'hl2-13': '@+I with a column formula', 'sy-pi-07': 'pi with the N flag',
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
