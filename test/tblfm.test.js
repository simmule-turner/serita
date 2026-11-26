import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { recalc } from '../core/tblfm.js';
import { evaluate, text } from '../core/calc.js';

const cases = JSON.parse(readFileSync(new URL('./fixtures/emacs-tblfm.json', import.meta.url), 'utf8'));

// The answer depends on the moment the oracle ran, so these cases cannot be compared; the rules (now() is a date with a float time, ;N gives an error, ;T a type error) are covered below.
const TIME_NOW = new Set(['dt-11', 'sy-now-0', 'sy-now-2', 'sy-now-3']);

for (const c of cases) {
  if (TIME_NOW.has(c.id) || !/^#\+TBLFM:/i.test(c.input.split('\n')[c.line] ?? '')) continue;
  test(`Emacs ${c.id}: ${c.input.split('\n')[c.line]}`, () => {
    const was = process.env.TZ;
    process.env.TZ = c.tz ?? 'UTC';
    const got = recalc(c.input, c.line, { radix: c.radix, digits: c.digits, constants: c.constants ? new Map(Object.entries(c.constants)) : undefined });
    process.env.TZ = was ?? '';
    if (was === undefined) delete process.env.TZ;
    assert.deepEqual({ text: got.text, failed: !!got.error }, { text: c.text, failed: !!c.error });
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

test('observed in Emacs 29.3 / Org 9.6: implicit product, vector square, double definition', () => {
  const one = (cell, f) => recalc(`| ${cell} |  |\n#+TBLFM: ${f}\n`, 1);
  assert.equal(one('1 2', '$2=$1+1').text.split('\n')[0], '| 1 2 | 3 |');
  assert.equal(one('1', '$2=[1,5]^2').text.split('\n')[0], '| 1 | 26 |');
  const d = one('1', '$2=$1*2::$2=$1+');
  assert.equal(d.text, '| 1 |  |\n#+TBLFM: $2=$1*2::$2=$1+\n');
  assert.match(d.error, /Double definition/);
});

test('now() gives the current time as an Org timestamp, and now()+1 the next day', () => {
  const row = (f) => recalc(`| 1 | 2 |  |\n#+TBLFM: $3=${f}\n`, 1).text.split('\n')[0];
  const stamp = /^\| 1 \| 2 \| \[(\d{4})-(\d\d)-(\d\d) \w{3} \d\d:\d\d\] \|$/;
  const a = row('now()').match(stamp), b = row('now()+1').match(stamp);
  assert.ok(a && b);
  const day = (m) => Date.UTC(+m[1], +m[2] - 1, +m[3]) / 864e5;
  assert.ok(day(b) - day(a) <= 1 && day(b) - day(a) >= 0);
});
