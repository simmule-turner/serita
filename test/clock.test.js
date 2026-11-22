// Clocking: the Emacs 30.1 results for the ck-* cases (the times in them are when the oracle ran).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { clockIn, clockOut, cancelClock, openClock, inClockedEntry } from '../core/clock.js';

const cases = JSON.parse(readFileSync(new URL('./fixtures/emacs-clock.json', import.meta.url), 'utf8'));
const get = (id) => cases.find((c) => c.id === id);
const nowIn = (c) => { const [, y, mo, d, h, mi] = /\[(\d{4})-(\d\d)-(\d\d) \w+ (\d\d):(\d\d)\]/.exec(c.text); return new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi)); };

for (const id of ['ck-in', 'ck-in-body', 'ck-in-logbook', 'ck-in-no-todo', 'ck-in-plan', 'ck-in-props', 'ck-in-plan-props']) {
  test(`Emacs clock in: ${id}`, () => {
    const c = get(id);
    assert.equal(clockIn(c.input, 0, nowIn(c)).text, c.text);
  });
}

test('Emacs clock in then out writes the span and the duration', () => {
  const c = get('ck-in-out');
  const now = nowIn(c);
  const a = clockIn(c.input, 0, now);
  const o = openClock(a.text);
  const r = clockOut(a.text, o.clockLine, o.start, now);
  assert.equal(r.text, c.text);
  assert.equal(r.duration, '0:00');
  assert.equal(r.stopped, '[2026-11-22 Sun 17:13]');
  assert.equal(openClock(r.text), null);
});

test('Emacs cancel removes the clock and the drawer it made', () => {
  const c = get('ck-cancel');
  const a = clockIn(c.input, 0, new Date(Date.UTC(2026, 10, 22, 17, 19)));
  assert.equal(cancelClock(a.text, openClock(a.text).clockLine).text, c.text);
});

test('Emacs clocking in elsewhere stops the running clock first', () => {
  const c = get('ck-switch');
  const now = nowIn(c);
  let t = clockIn(c.input, 0, now).text;
  const o = openClock(t);
  t = clockOut(t, o.clockLine, o.start, now).text;
  t = clockIn(t, 4, now).text;
  assert.equal(t, c.text);
});

test('a clock that ran an hour and a half says so', () => {
  const t = clockIn('* A\n', 0, new Date(Date.UTC(2026, 10, 22, 9, 0))).text;
  const o = openClock(t);
  assert.equal(clockOut(t, o.clockLine, o.start, new Date(Date.UTC(2026, 10, 22, 10, 30))).text, '* A\n:LOGBOOK:\nCLOCK: [2026-11-22 Sun 09:00]--[2026-11-22 Sun 10:30] =>  1:30\n:END:\n');
});

test('Emacs: clocking in inside the clocked entry (its children too) changes nothing, but a parent is not inside a child', () => {
  const t = '* A\n** B\n* C\n';
  assert.equal(inClockedEntry(t, 0, 0), true);
  assert.equal(inClockedEntry(t, 0, 1), true);
  assert.equal(inClockedEntry(t, 0, 2), false);
  assert.equal(inClockedEntry(t, 1, 0), false);
});
