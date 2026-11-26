// The agenda prefix format and category icons, against Emacs 30.1 results (the real clock's "now" line is left out of both).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { agenda, todoList, tagsView, searchView } from '../core/agenda.js';
import { parseAgendaSettings, formatPrefix, phoneCells, phoneColumns } from '../core/prefix.js';

const F = JSON.parse(readFileSync(new URL('./fixtures/emacs-prefix.json', import.meta.url), 'utf8'));
const date = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const balanced = (s, at) => { let depth = 0; for (let i = at; i < s.length; i++) { if (s[i] === '"') { for (i++; s[i] !== '"'; i++) if (s[i] === '\\') i++; } else if (s[i] === '(') depth++; else if (s[i] === ')' && --depth === 0) return s.slice(at, i + 1); } return s.slice(at); };
const setqs = (ev) => [...ev.matchAll(/\(setq org-agenda-(?:prefix-format|category-icon-alist)/g)].map((m) => balanced(ev, m.index)).join('\n');
const noNow = (t) => t.split('\n').filter((l) => !/(^|[^a-z])now - - /.test(l)).join('\n');

for (const [id, c] of Object.entries(F)) {
  if (!id.startsWith('pf-') || c.error) continue;
  test(`Emacs agenda prefix ${id}`, () => {
    const files = [{ category: 'oracleXXXXXX', text: F._input }];
    const prefix = parseAgendaSettings(setqs(c.eval));
    const ev = c.eval;
    const r = /org-agenda-list/.test(ev) ? agenda(files, { start: date('2026-11-30'), span: /"2026-11-30" 7/.test(ev) ? 7 : 1, today: date('2026-11-30'), prefix })
      : /org-todo-list/.test(ev) ? todoList(files, { prefix }) : /org-tags-view/.test(ev) ? tagsView(files, { match: 'home|work', prefix }) : searchView(files, { words: 'e', prefix });
    const want = noNow(c.text).replace(/^ /, '');
    assert.equal(noNow(r.text).replace(/^ /, ''), want);
  });
}

test('prefix format fields', () => {
  assert.equal(formatPrefix('%-8:c|%12c|%?-6t|', { category: 'Work' }), 'Work:   |        Work||');
  assert.equal(formatPrefix('%% %s', { label: 'Deadline:' }), '% Deadline:  ');
});

test('phone columns follow the format and trim to the entries on screen', () => {
  const es = [{ category: 'Work', clock: '', label: '' }, { category: 'VeryLongCategoryName', clock: '', label: 'Scheduled:' }];
  const cols = phoneColumns(' %i %-12:c%?-12t% s', es, []);
  assert.deepEqual(cols, [{ spec: 'c', width: 12 }, { spec: 's', width: 10 }]);
  assert.deepEqual(phoneCells(cols, es[1], []), ['VeryLongCate', 'Scheduled:']);
  const icons = parseAgendaSettings(`(setq org-agenda-category-icon-alist '(("Work" ("W"))))`).icons;
  assert.deepEqual(phoneColumns('%i%c', es, icons).map((c) => c.spec), ['i', 'c']);
});
