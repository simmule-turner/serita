// Timestamps, scheduling and repeating tasks. The cases are Emacs 30.1 results (the date there was 2026-11-22 12:21).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { shiftStamp, parseDate, formatStamp, setPlanning, insertStamp, completeRepeat } from '../core/timestamp.js';

const cases = JSON.parse(readFileSync(new URL('./fixtures/emacs-dates.json', import.meta.url), 'utf8'));
const get = (id) => cases.find((c) => c.id === id);
const now = new Date(Date.UTC(2026, 10, 22, 12, 21));
const today = new Date(Date.UTC(2026, 10, 22));

for (const id of ['ts-up-day', 'ts-down-day', 'ts-up-month', 'ts-up-year', 'ts-up-weekday', 'ts-up-time', 'ts-range', 'ts-up-minute']) {
  test(`Emacs S-arrow on a timestamp: ${id}`, () => {
    const c = get(id);
    const r = shiftStamp(c.input, c.offset, c.keys === 'S-<down>' ? -1 : 1);
    assert.equal(r.text, c.text);
  });
}

test('two S-up on the day cross the month end', () => {
  const c = get('ts-month-end');
  const a = shiftStamp(c.input, c.offset, 1);
  assert.equal(shiftStamp(a.text, c.offset, 1).text, c.text);
});

test('the closing bracket toggles active and inactive, and says so', () => {
  const r = shiftStamp('<2026-11-30 Mon>', 15, 1);
  assert.equal(r.text, '[2026-11-30 Mon]');
  assert.equal(r.said, 'Timestamp is now inactive');
  assert.equal(shiftStamp(r.text, 15, 1).said, 'Timestamp is now active');
});

test('off a timestamp there is nothing to shift', () => assert.equal(shiftStamp('* A\n', 1, 1), null));

for (const [id, kw, typed] of [['ts-schedule', 'SCHEDULED', '2026-12-01'], ['ts-schedule-time', 'SCHEDULED', '2026-12-01 14:30'], ['ts-schedule-replace', 'SCHEDULED', '2026-12-01'], ['ts-deadline', 'DEADLINE', '2026-12-01'], ['ts-deadline-both', 'DEADLINE', '2026-12-25']]) {
  test(`Emacs ${kw.toLowerCase()}: ${id}`, () => {
    const c = get(id);
    const d = parseDate(typed, today);
    assert.equal(setPlanning(c.input, 0, kw, formatStamp(d.date, { time: d.time })).text, c.text);
  });
}

test('Emacs C-c . and C-c ! insert a stamp at the cursor', () => {
  for (const [id, active] of [['ts-insert', true], ['ts-insert-inactive', false]]) {
    const c = get(id);
    const d = parseDate('2026-12-01', today);
    assert.equal(insertStamp(c.input, c.offset, formatStamp(d.date, { active })).text, c.text);
  }
});

for (const [id, from] of [['ts-repeat-done', '+1w'], ['ts-repeat-done-day', '+1d'], ['ts-repeat-plus-plus', '++1w'], ['ts-repeat-dot', '.+1w']]) {
  test(`Emacs repeating task ${from}`, () => {
    const c = get(id);
    const r = completeRepeat({ text: c.input, line: 0, from: 'TODO', to: 'DONE', reopen: 'TODO', now });
    // The recorded text starts with a stray "d" typed into the buffer, and Emacs left no newline after the log line at the end of the buffer.
    assert.equal(r.text.trimEnd(), c.text.slice(1).trimEnd());
  });
}

test('typed dates: ISO, relative and with a time', () => {
  assert.equal(formatStamp(parseDate('+3d', today).date), '<2026-11-25 Wed>');
  assert.equal(formatStamp(parseDate('tomorrow 9:05', today).date, { time: true }), '<2026-11-23 Mon 09:05>');
  assert.equal(formatStamp(parseDate('', today).date), '<2026-11-22 Sun>');
  assert.throws(() => parseDate('soon', today));
});

test('a heading with nothing that repeats is left alone', () => {
  assert.equal(completeRepeat({ text: '* TODO A\nSCHEDULED: <2026-11-30 Mon>\n', line: 0, from: 'TODO', to: 'DONE', reopen: 'TODO', now }), null);
});

test('Emacs typed date forms: month names, am/pm and a time range', () => {
  const f = (s) => { const d = parseDate(s, today); return formatStamp(d.date, { time: d.time, until: d.until }); };
  assert.equal(f('dec 3 2026'), '<2026-12-03 Thu>');
  assert.equal(f('3 dec 2026'), '<2026-12-03 Thu>');
  assert.equal(f('2026-12-03 2pm'), '<2026-12-03 Thu 14:00>');
  assert.equal(f('2026-12-03 9:05pm'), '<2026-12-03 Thu 21:05>');
  assert.equal(f('2026-12-03 10:00-11:30'), '<2026-12-03 Thu 10:00-11:30>');
  assert.equal(f('2026-12-1'), '<2026-12-01 Tue>');
});

const rep = JSON.parse(readFileSync(new URL('./fixtures/emacs-repeat.json', import.meta.url), 'utf8'));
const repNow = new Date(Date.UTC(2026, 10, 22, 16, 9));

for (const c of rep.filter((x) => x.id.startsWith('br-') || x.id === 'ts-body-repeat')) {
  test(`Emacs finishing a repeating task: ${c.id}`, () => {
    const r = completeRepeat({ text: c.input, line: 0, from: 'TODO', to: 'DONE', reopen: 'TODO', now: repNow });
    // Emacs left no newline after a log line at the end of the buffer.
    if (r === null) assert.equal(c.text, c.input.replace('* TODO', '* DONE'));
    else assert.equal(r.text.trimEnd(), c.text.trimEnd());
  });
}

for (const c of rep.filter((x) => /^ts-(rep|sleft|sright|min|hour|open|inactive)/.test(x.id) && x.id !== 'ts-body-repeat')) {
  test(`Emacs S-arrow on a timestamp: ${c.id}`, () => {
    const lines = c.input.split('\n');
    const offset = lines.slice(0, c.line - 1).reduce((n, l) => n + l.length + 1, 0) + c.col;
    const sideways = /left|right/.test(c.keys);
    const r = shiftStamp(c.input, offset, /up|right/.test(c.keys) ? 1 : -1, { sideways });
    assert.equal(r.text, c.text);
    if (c.messages.length) assert.equal(r.said, c.messages[0]);
  });
}

const stampKeys = JSON.parse(readFileSync(new URL('./fixtures/emacs-stamp-keys.json', import.meta.url), 'utf8'));
for (const c of stampKeys) {
  test(`Emacs S-arrow on a timestamp part: ${c.id}`, () => {
    const lines = c.input.split('\n');
    const offset = lines.slice(0, c.line - 1).reduce((n, l) => n + l.length + 1, 0) + c.col;
    const r = shiftStamp(c.input, offset, /up|right/.test(c.keys) ? 1 : -1, { sideways: /left|right/.test(c.keys) });
    assert.equal(r.text, c.text);
  });
}
