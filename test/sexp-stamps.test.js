// Timestamps in a headline and <%%(sexp)> timestamps in the agenda, against Emacs 30.1 (conformance v0.1.82: ts-*).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { agenda } from '../core/agenda.js';

const F = JSON.parse(fs.readFileSync(new URL('./fixtures/emacs-sexp-stamps.json', import.meta.url)));
const date = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };

for (const c of F) {
  test(`Emacs agenda ${c.id}`, () => {
    const r = agenda([{ category: 'oracleXXXXXX', text: c.input }], { start: date('2026-11-23'), span: 7, today: date('2026-11-26'), timeGrid: false });
    assert.equal(r.text.replace(/oracleXXXXXX/g, 'CAT').trimEnd(), c.text);
  });
}

test('a timestamp in the headline shows the heading at its time, without the stamp', () => {
  const r = agenda([{ category: 'cal', text: '* 2026\n** Vacation <2026-11-25 Wed 16:00>\n' }], { start: date('2026-11-23'), span: 7, today: date('2026-11-26'), timeGrid: false });
  assert.match(r.text, /Wednesday {2}25 November 2026\n  cal: +16:00\.{6} Vacation \n/);
});
