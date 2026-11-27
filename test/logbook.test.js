import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { addLogEntry, dropClosed, setClosed } from '../core/timestamp.js';

const cases = Object.fromEntries(JSON.parse(fs.readFileSync(new URL('./fixtures/emacs-logging.json', import.meta.url), 'utf8')).map((c) => [c.id, c]));
const NOW = new Date(Date.UTC(2026, 10, 26, 9, 30));
const STAMP = '[2026-11-26 Thu 09:30]';
const at = (id) => { const c = cases[id]; return { c, line: c.line - 1 }; };

test('CLOSED stamps as Emacs sets and drops them (lg-done-time, lg-undone-time)', () => {
  const a = at('lg-done-time');
  assert.equal(setClosed(a.c.input.replace('* TODO a', '* DONE a'), a.line, NOW), a.c.output);
  const u = at('lg-undone-time');
  assert.equal(dropClosed(u.c.input.replace('* DONE c', '* TODO c'), 2), u.c.output);
});

test('a closing note goes under the CLOSED line, in a drawer when asked (lg-done-note, lg-drawer, lg-drawer-name, lg-empty-note)', () => {
  const base = (id) => setClosed(cases[id].input.replace('* TODO a', '* DONE a'), 0, NOW);
  const heading = `CLOSING NOTE ${STAMP}`;
  assert.equal(addLogEntry(base('lg-done-note'), 0, { heading, note: 'a note', bare: true }), cases['lg-done-note'].output);
  assert.equal(addLogEntry(base('lg-drawer'), 0, { heading, note: 'a note', drawer: 'LOGBOOK', bare: true }), cases['lg-drawer'].output);
  assert.equal(addLogEntry(base('lg-drawer-name'), 0, { heading, note: 'a note', drawer: 'LOG', bare: true }), cases['lg-drawer-name'].output);
  assert.equal(addLogEntry(base('lg-empty-note'), 0, { heading, note: '', bare: true }), cases['lg-empty-note'].output);
});

test('notes: newest first, at the end of the text no line end (lg-note-cmd, lg-note-twice, lg-reschedule-note)', () => {
  const head = (n) => `Note taken on ${STAMP}`;
  assert.equal(addLogEntry(cases['lg-note-cmd'].input, 0, { heading: head(), note: 'n', bare: true }), cases['lg-note-cmd'].output);
  let t = cases['lg-note-twice'].input;
  t = addLogEntry(t, 0, { heading: head(), note: 'n1', drawer: 'LOGBOOK', bare: true });
  t = addLogEntry(t, 0, { heading: head(), note: 'n2', drawer: 'LOGBOOK', bare: true });
  assert.equal(t, cases['lg-note-twice'].output);
  const r = cases['lg-reschedule-note'];
  const sched = r.input.replace('<2026-11-20 Fri>', '<2026-12-01 Tue>');
  assert.equal(addLogEntry(sched, 0, { heading: `Rescheduled from "[2026-11-20 Fri]" on ${STAMP}`, note: 'why', bare: true }), r.output);
});
