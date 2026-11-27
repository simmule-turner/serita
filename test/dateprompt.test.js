import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseDate, timePrefill } from '../core/timestamp.js';

// Cases from Emacs 30.1 (conformance v0.1.76 dp-* and v0.1.77 dt-*, v0.1.78 dd-*): the date a prompt gives when it starts from the date already set; today was 2026-11-27.
const cases = JSON.parse(fs.readFileSync(new URL('./fixtures/emacs-dateprompt.json', import.meta.url), 'utf8'));
const day = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };

test('typed dates count from today or from the date already set, as Emacs does (dp-*)', () => {
  for (const c of cases) {
    const set = new RegExp(`${c.keyword}: <(\\d{4}-\\d\\d-\\d\\d)`).exec(c.input);
    const base = set ? day(set[1]) : day('2026-11-26');
    const r = parseDate(c.typed, base, day(c.real));
    assert.equal(r.date.toISOString().slice(0, 10), c.date, c.id);
    assert.equal(r.time ? r.date.toISOString().slice(11, 16) : null, c.time, c.id);
    if (c.id.startsWith('dd-')) assert.equal(r.until ?? null, c.until, c.id);
  }
});

const prefills = JSON.parse(fs.readFileSync(new URL('./fixtures/emacs-dateprefill.json', import.meta.url), 'utf8'));
test('a stamp with a time range starts the prompt as Emacs does (ddr-*)', () => {
  for (const c of prefills) assert.equal(timePrefill(`[2026-11-23 Mon ${c.range}]`), c.initial, c.id);
  assert.equal(timePrefill('[2026-11-23 Mon 10:30]'), '10:30');
  assert.equal(timePrefill('[2026-11-23 Mon]'), '');
});
