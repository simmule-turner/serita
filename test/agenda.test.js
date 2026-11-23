// The agenda views. The cases are Emacs 30.1 results: the whole text of the agenda buffer (the file's category was a temporary name).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { agenda, todoList, tagsView, searchView, weekOf } from '../core/agenda.js';

const cases = JSON.parse(readFileSync(new URL('./fixtures/emacs-agenda.json', import.meta.url), 'utf8'));
const date = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };

for (const c of cases) {
  test(`Emacs agenda ${c.id}`, () => {
    const files = [{ category: 'oracleXXXXXX', text: c.input }];
    const r = c.view === 'agenda' ? agenda(files, { start: date(c.start), span: c.span, today: date(c.today ?? '2026-11-30'), warn: c.warn })
      : c.view === 'todo' ? todoList(files, { keyword: c.arg }) : c.view === 'search' ? searchView(files, { words: c.arg })
        : tagsView(files, { match: c.arg, todoOnly: c.view === 'tagstodo' });
    assert.equal(r.text, c.text);
  });
}

test('ISO week numbers', () => {
  assert.equal(weekOf(date('2026-11-30')), 49);
  assert.equal(weekOf(date('2026-01-05')), 2);
});

test('a short category is padded to the same column', () => {
  const r = todoList([{ category: 'work', text: '* TODO A\n' }]);
  assert.equal(r.text.split('\n')[2], '  work:       TODO A');
});

// The time grid (Emacs 30.1 results; the clock there read 18:14 on the day of the run, so that is the time the grid's "now" line gets).
const grid = JSON.parse(readFileSync(new URL('./fixtures/emacs-timegrid.json', import.meta.url), 'utf8'));
for (const c of grid) {
  test(`Emacs agenda time grid ${c.id}`, () => {
    const files = [{ category: 'oracleXXXXXX', text: c.input }];
    assert.equal(agenda(files, { start: date(c.start), span: c.span, today: date(c.today), warn: c.warn, now: c.now }).text, c.text);
  });
}

test('the time grid can be turned off', () => {
  const files = [{ name: 'f.org', text: '* TODO A\nSCHEDULED: <2026-11-30 Mon 10:00>\n' }];
  const o = { start: new Date(Date.UTC(2026, 10, 30)), span: 1, today: new Date(Date.UTC(2026, 10, 30)), now: '09:00' };
  assert.match(agenda(files, o).text, /\.{6} -{16}/);
  assert.doesNotMatch(agenda(files, { ...o, timeGrid: false }).text, /-{16}/);
});

test('diary entries show on their days with the category Diary', () => {
  const o = { start: new Date(Date.UTC(2026, 10, 30)), span: 1, today: new Date(Date.UTC(2026, 10, 30)), now: null };
  const r = agenda([], { ...o, diary: { text: 'Nov 30, 2026 Last day\nMonday Standup\n%%(diary-anniversary 11 20 1990) Anna (%d)\n', style: 'american' } });
  assert.deepEqual(r.days[0].entries.map((e) => [e.category, e.title]), [['Diary', 'Last day'], ['Diary', 'Standup']]);
  assert.match(r.text, /^ {2}Diary: {6}Last day$/m);
});

// Emacs 30.1 (conformance v0.1.27) listed the holidays among the Diary lines of the week of December 21, 2026
test('holidays show as Diary lines, with a solar time as the line time', () => {
  const v = agenda([], { start: new Date(Date.UTC(2026, 11, 21)), span: 'week', today: new Date(Date.UTC(2026, 10, 30)), now: null, timeGrid: false, holidays: { which: ['christian', 'solar'], zone: 'America/New_York' } });
  const lines = v.days.flatMap((d) => d.entries.map((e) => `${d.date.toISOString().slice(0, 10)} ${e.category}: ${[e.label, e.title].filter(Boolean).join(' ')}`));
  assert.deepEqual(lines, ['2026-12-21 Diary: 15:49...... Winter Solstice (EST)', '2026-12-25 Diary: Christmas']);
});
