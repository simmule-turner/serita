import test from 'node:test';
import assert from 'node:assert/strict';
import { agendaLines, diaryEntries, parseDiary } from '../core/diary.js';
import { agenda } from '../core/agenda.js';

// Every expectation below is what Emacs 30.1 (Org 9.7.11) listed in conformance v0.1.33.
const day = (text, d = 23, n = 3, extra = {}) => agenda([], { start: new Date(Date.UTC(2026, 10, d)), span: n, today: new Date(Date.UTC(2026, 10, 1)), timeGrid: false, diary: { text, style: 'american' }, ...extra })
  .days.map((x) => x.entries.map((e) => [e.clock, e.title].filter(Boolean).join(' ')));

test('continuation lines join the entry with "; " and a time leaves the text', () => {
  assert.deepEqual(day('11/23/2026 Project review at 10:00am\n    Location: Room 4B\n    Bring slides\n\n11/24/2026 Next\n'), [['10:00...... Project review at ; Location: Room 4B; Bring slides'], ['Next'], []]);
});

test('a date alone with events indented beneath it gives one line for each', () => {
  assert.deepEqual(day('11/24/2026\n    9:00am Team standup\n    2:00pm Dentist appointment\n'), [[], [' 9:00...... Team standup', '14:00...... Dentist appointment'], []]);
  assert.deepEqual(agendaLines('\n    9:00am Team standup\n    2:00pm Dentist appointment').map((l) => l.text), ['Team standup', 'Dentist appointment']);
});

test('tabs and any indentation continue an entry; a blank line or a comment ends it', () => {
  assert.deepEqual(day('11/23/2026 First\n\tTabbed\n  Two spaces\n   Three\nNov 24 Second\n'), [['First; Tabbed; Two spaces; Three'], ['Second'], []]);
  assert.deepEqual(day('11/23/2026 First\n    kept\n\n    dropped after blank\nunindented comment\n    dropped after comment\n11/24/2026 Second\n'), [['First; kept'], ['Second'], []]);
});

test('times in the text: 10:00am, 2pm-3:30pm, none', () => {
  assert.deepEqual(day('11/23/2026 10:00am Meeting\n11/23/2026 2pm-3:30pm Call\n11/23/2026 No time\n'), [['10:00...... Meeting', '14:00-15:30 Call', 'No time'], [], []]);
});

test('a sexp may span indented lines, and an indented line after a bare sexp is its text', () => {
  assert.deepEqual(day('%%(and (diary-date 11 23 2026)\n    (diary-date 11 23 2026)) Multi-line sexp\n'), [['Multi-line sexp'], [], []]);
  assert.deepEqual(day('%%(diary-date 11 23 2026)\n    Only a continuation\n'), [['Only a continuation'], [], []]);
});

test('& entries show in the agenda but are marked quiet for the calendar', () => {
  const text = '&11/23/2026 Quiet\n11/23/2026 Marked\n';
  assert.deepEqual(day(text), [['Quiet', 'Marked'], [], []]);
  assert.deepEqual(diaryEntries(text, { y: 2026, m: 11, d: 23 }, 1).map((e) => [e.text, !!e.quiet]), [['Quiet', true], ['Marked', false]]);
  assert.deepEqual(parseDiary('&%%(diary-float t 4 4) Quiet thanksgiving\n').map((e) => e.quiet), [true]);
});

test('an anniversary text with a format Emacs rejects shows nothing', () => {
  assert.deepEqual(day('%%(diary-anniversary 11 23 2000) Anna (%t)\n    Cake\n'), [[], [], []]);
  assert.deepEqual(day('%%(diary-anniversary 11 23 2000) Anna (%d)\n'), [['Anna (26)'], [], []]);
});
