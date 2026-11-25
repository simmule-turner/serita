import test from 'node:test';
import assert from 'node:assert/strict';
import { holidaysOf } from '../core/holidays.js';

const solar = (y, zone) => holidaysOf(y, { which: ['solar'], zone }).filter((h) => /Equinox|Solstice|Daylight/.test(h.name)).sort((a, b) => a.m - b.m || a.d - b.d).map((h) => `${h.m}/${h.d} ${h.name}`);

// The lists Emacs 30.1 gave (conformance v0.1.26) for New York and, with the daylight rule off, for India
test('solar holidays in New York match Emacs', () => {
  assert.deepEqual(solar(2026, 'America/New_York'), ['3/8 Daylight Saving Time Begins 2:00am (EST)', '3/20 Vernal Equinox 10:44am (EDT)', '6/21 Summer Solstice 4:24am (EDT)', '9/22 Autumnal Equinox 8:04pm (EDT)', '11/1 Daylight Saving Time Ends 2:00am (EDT)', '12/21 Winter Solstice 3:49pm (EST)']);
  assert.deepEqual(solar(2027, 'America/New_York'), ['3/14 Daylight Saving Time Begins 2:00am (EST)', '3/20 Vernal Equinox 4:24pm (EDT)', '6/21 Summer Solstice 10:10am (EDT)', '9/23 Autumnal Equinox 2:00am (EDT)', '11/7 Daylight Saving Time Ends 2:00am (EDT)', '12/21 Winter Solstice 9:41pm (EST)']);
  assert.deepEqual(solar(2028, 'America/New_York'), ['3/12 Daylight Saving Time Begins 2:00am (EST)', '3/19 Vernal Equinox 10:16pm (EDT)', '6/20 Summer Solstice 4:00pm (EDT)', '9/22 Autumnal Equinox 7:44am (EDT)', '11/5 Daylight Saving Time Ends 2:00am (EDT)', '12/21 Winter Solstice 3:19am (EST)']);
});

test('solar holidays in India have no daylight saving lines', () => {
  const l = solar(2026, 'Asia/Kolkata').map((x) => x.replace(/\(.*\)/, ''));
  assert.deepEqual(l, ['3/20 Vernal Equinox 8:14pm ', '6/21 Summer Solstice 1:54pm ', '9/23 Autumnal Equinox 5:34am ', '12/22 Winter Solstice 2:19am ']);
});

test('daylight saving changes come from the zone itself', () => {
  const dst = (y, zone) => holidaysOf(y, { which: ['solar'], zone }).filter((h) => /Daylight/.test(h.name)).sort((a, b) => a.m - b.m || a.d - b.d).map((h) => `${h.m}/${h.d} ${h.name.replace('Daylight Saving Time ', '')}`);
  assert.deepEqual(dst(2026, 'Europe/London'), ['3/29 Begins 1:00am (GMT)', '10/25 Ends 2:00am (BST)']);
  assert.deepEqual(dst(2026, 'Australia/Sydney'), ['4/5 Ends 3:00am (AEDT)', '10/4 Begins 2:00am (AEST)']);
  assert.deepEqual(dst(2026, 'UTC'), []);
});

// Emacs 30.1 (conformance v0.1.28) listed the minute of every equinox and solstice from 2000 to 2060 in UTC; the published method is within a minute of it
import { readFileSync } from 'node:fs';
test('equinox and solstice minutes, 2000 to 2060, are within a minute of Emacs', () => {
  const rows = JSON.parse(readFileSync(new URL('./fixtures/emacs-solar-years.json', import.meta.url)));
  let exact = 0;
  for (const [y, , , text] of rows) {
    const mine = holidaysOf(y, { which: ['solar'], zone: 'UTC' }).find((h) => text.startsWith(h.name.split(' ').slice(0, 2).join(' ')));
    const min = (t) => { const m = /(\d+):(\d\d)(am|pm)/.exec(t); return (Number(m[1]) % 12 + (m[3] === 'pm' ? 12 : 0)) * 60 + Number(m[2]); };
    const diff = Math.abs(min(mine.name) - min(text));
    assert.ok(diff <= 1, `${y} ${text} against ${mine.name}`);
    if (diff === 0) exact++;
  }
  assert.ok(exact / rows.length > 0.75, `${exact} of ${rows.length} exact`);
});
