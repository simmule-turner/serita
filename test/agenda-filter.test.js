// Agenda filters, against what Emacs 30.1 showed (conformance v0.1.23 and v0.1.24).
import test from 'node:test';
import assert from 'node:assert/strict';
import { agenda, todoList } from '../core/agenda.js';
import { parseSigned, parseEffort, noFilter } from '../core/agenda-filter.js';

const TEXT = '#+TODO: TODO NEXT | DONE\n* TODO [#A] Pay rent :home:bills:\nSCHEDULED: <2026-11-30 Mon>\n:PROPERTIES:\n:Effort: 0:30\n:END:\n* TODO Report :work:\nDEADLINE: <2026-12-02 Wed>\n:PROPERTIES:\n:Effort: 2:00\n:END:\n* NEXT Call Bob :work:phone:\nSCHEDULED: <2026-12-01 Tue 14:30>\n:PROPERTIES:\n:CATEGORY: calls\n:END:\n* Meeting\n<2026-12-01 Tue 10:00-11:00>\n* TODO Water plants\nSCHEDULED: <2026-11-30 Mon +1w>\n';
const files = [{ name: 'f.org', category: 'f', text: TEXT }];
const D = (y, m, d) => new Date(Date.UTC(y, m - 1, d));
const shown = (filter) => agenda(files, { start: D(2026, 11, 30), span: 'week', today: D(2026, 11, 30), now: '09:00', filter }).days.flatMap((d) => d.entries.map((e) => e.title));
const make = (o) => ({ ...noFilter(), ...o });

test('filter by tag keeps entries with every + tag and none of the - tags', () => {
  assert.deepEqual(shown(make({ tags: parseSigned('+work') })), ['Report', 'Call Bob', 'Report']);
  assert.deepEqual(shown(make({ tags: parseSigned('-work') })), ['Pay rent', 'Water plants', 'Meeting']);
  assert.deepEqual(shown(make({ tags: parseSigned('+work +phone') })), ['Call Bob']);
});

test('filter by category and by regexp', () => {
  assert.deepEqual(shown(make({ category: parseSigned('+calls') })), ['Call Bob']);
  assert.equal(shown(make({ category: parseSigned('-calls') })).includes('Call Bob'), false);
  assert.deepEqual(shown(make({ regexp: parseSigned('+rent') })), ['Pay rent']);
  assert.equal(shown(make({ regexp: parseSigned('-rent') })).includes('Pay rent'), false);
});

test('filter by effort: entries without one stay only for >', () => {
  assert.deepEqual(shown(make({ effort: parseEffort('<1:00') })), ['Pay rent']);
  assert.deepEqual(shown(make({ effort: parseEffort('=0:30') })), ['Pay rent']);
  assert.deepEqual(shown(make({ effort: parseEffort('>1:00') })), ['Water plants', 'Report', 'Meeting', 'Call Bob', 'Report']);
  assert.throws(() => parseEffort('<abc'), /Invalid duration format/);
});

test('the TODO list takes the same filter', () => {
  assert.deepEqual(todoList(files, { filter: make({ tags: parseSigned('+work') }) }).entries.map((e) => e.title), ['Report', 'Call Bob']);
});
