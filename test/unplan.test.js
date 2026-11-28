// Removing a schedule or a deadline and the log line it leaves, against Emacs 30.1 (conformance v0.1.81: ds-*).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { removePlanning, addLogEntry, formatHeading, planningStamp } from '../core/timestamp.js';

const F = JSON.parse(fs.readFileSync(new URL('./fixtures/emacs-unplan.json', import.meta.url)));
const now = new Date(Date.UTC(2026, 10, 26, 9, 30));

for (const c of F) {
  test(`Emacs ${c.id}`, () => {
    const sched = c.id.includes('unsched');
    const kw = sched ? 'SCHEDULED' : 'DEADLINE';
    const input = `* TODO a\n${kw}: <2026-11-20 Fri>\n`;
    const old = planningStamp(input, 0, kw);
    const r = removePlanning(input, 0, kw);
    const heading = formatHeading(sched ? 'delschedule' : 'deldeadline', { old, now });
    const out = addLogEntry(r.text, 0, { heading, note: c.id.endsWith('note') ? 'why' : undefined, bare: true });
    assert.equal(out, c.buffer);
  });
}

test('removePlanning keeps the other planning stamps', () => {
  const t = '* TODO a\nDEADLINE: <2026-11-22 Sun> SCHEDULED: <2026-11-20 Fri>\n';
  assert.equal(removePlanning(t, 0, 'SCHEDULED').text, '* TODO a\nDEADLINE: <2026-11-22 Sun>\n');
  assert.equal(removePlanning('* TODO a\n', 0, 'SCHEDULED').text, '* TODO a\n');
});
