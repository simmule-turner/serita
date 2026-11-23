// Refile and archive, against results Emacs 30.1 gave (conformance v0.1.20).
import test from 'node:test';
import assert from 'node:assert/strict';
import { archiveSubtree, archiveToSibling, listTargets, parseRefileSettings, refile, toggleArchiveTag } from '../core/refile.js';

const T = '* A\n** A1\n*** A1a\n** A2\n* B\nbody b\n** B1\n* C :x:\n';
const NOW = new Date(Date.UTC(2026, 10, 22, 18, 54));
const targets = (init, text = T) => listTargets([{ name: 'f.org', text }], parseRefileSettings(init), { current: 'f.org' });
const at = (text, title) => text.split('\n').findIndex((l) => new RegExp(`^\\*+ ${title}`).test(l));
const find = (ts, label) => ts.find((t) => t.label === label);

test('targets by level, depth and outline path', () => {
  assert.deepEqual(targets('(setq org-refile-targets \'((nil :level . 1)))').map((t) => t.label), ['A', 'B', 'C']);
  assert.deepEqual(targets('(setq org-refile-targets \'((nil :maxlevel . 2)))').map((t) => t.label), ['A', 'A1', 'A2', 'B', 'B1', 'C']);
  assert.deepEqual(targets('(setq org-refile-targets \'((nil :maxlevel . 3)) org-refile-use-outline-path t)').map((t) => t.label), ['A', 'A/A1', 'A/A1/A1a', 'A/A2', 'B', 'B/B1', 'C']);
  assert.deepEqual(targets('(setq org-refile-targets \'((nil :tag . "x")))').map((t) => t.label), ['C']);
});

test('refile moves the subtree to the end of the target, or after its body in reverse order', () => {
  const ts = targets('(setq org-refile-targets \'((nil :maxlevel . 2)))');
  assert.equal(refile(T, at(T, 'A2'), find(ts, 'B')).text, '* A\n** A1\n*** A1a\n* B\nbody b\n** B1\n** A2\n* C :x:\n');
  assert.equal(refile(T, at(T, 'B1'), find(ts, 'A1')).text, '* A\n** A1\n*** A1a\n*** B1\n** A2\n* B\nbody b\n* C :x:\n');
  assert.equal(refile(T, at(T, 'A2'), find(ts, 'B'), { reverse: true }).text, '* A\n** A1\n*** A1a\n* B\nbody b\n** A2\n** B1\n* C :x:\n');
  const top = targets('(setq org-refile-targets \'((nil :level . 1)))');
  assert.equal(refile(T, at(T, 'A2'), find(top, 'C')).text, '* A\n** A1\n*** A1a\n* B\nbody b\n** B1\n* C :x:\n** A2\n');
  assert.equal(refile('* A\n* B\nlast', 1, find(targets('(setq org-refile-targets \'((nil :maxlevel . 1)))', '* A\n* B\nlast'), 'A')).text, '* A\n** B\nlast\n');
});

test('refile to a place inside the tree is an error, and copy keeps the original', () => {
  const ts = targets('(setq org-refile-targets \'((nil :maxlevel . 2)))');
  assert.throws(() => refile(T, at(T, 'A'), find(ts, 'A1')), /Cannot refile to position inside the tree or region/);
  assert.equal(refile(T, at(T, 'A2'), find(ts, 'B'), { copy: true }).text, '* A\n** A1\n*** A1a\n** A2\n* B\nbody b\n** B1\n** A2\n* C :x:\n');
});

test('archive to the default file, to a heading in the same file, and to a heading in the file', () => {
  const o = { fileName: '/tmp/f.org', category: 'f', now: NOW, archiveText: null };
  const props = (olp) => `:PROPERTIES:\n:ARCHIVE_TIME: 2026-11-22 Sun 18:54\n:ARCHIVE_FILE: /tmp/f.org\n${olp ? `:ARCHIVE_OLPATH: ${olp}\n` : ''}:ARCHIVE_CATEGORY: f\n:END:\n`;
  const a = archiveSubtree(T, at(T, 'A'), { ...o, location: '%s_archive::' });
  assert.equal(a.archive.text, `#    -*- mode: org -*-\n\n\nArchived entries from file /tmp/f.org\n\n\n* A\n${props()}** A1\n*** A1a\n** A2\n`);
  assert.equal(a.message, 'Subtree archived in file: /tmp/f.org_archive');
  const s = archiveSubtree(T, at(T, 'A2'), { ...o, location: '::* Archived' });
  assert.equal(s.text, '* A\n** A1\n*** A1a\n* B\nbody b\n** B1\n* C :x:\n\n* Archived\n\n** A2\n' + props('A'));
  assert.equal(s.message, 'Subtree archived under heading: * Archived');
  const d = archiveSubtree(T, at(T, 'A2'), { ...o, location: '/tmp/f.org_archive::* Done' });
  assert.equal(d.archive.text, `#    -*- mode: org -*-\n\n\nArchived entries from file /tmp/f.org\n\n\n* Done\n\n** A2\n${props('A')}`);
  const second = archiveSubtree(T, at(T, 'B'), { ...o, location: '%s_archive::', archiveText: a.archive.text });
  assert.ok(second.archive.text.includes('** A2\n\n* B\n'));
});

test('archive tag and archive sibling', () => {
  const t = toggleArchiveTag(T, at(T, 'A2'), -77);
  assert.equal(t.text, '* A\n** A1\n*** A1a\n** A2                                                               :ARCHIVE:\n* B\nbody b\n** B1\n* C :x:\n');
  assert.equal(t.message, 'Subtree archived');
  assert.equal(toggleArchiveTag(t.text, at(t.text, 'A2'), -77).text, T);
  assert.equal(archiveToSibling(T, at(T, 'A2'), { now: NOW, column: -77 }).text,
    '* A\n** A1\n*** A1a\n** Archive                                                          :ARCHIVE:\n*** A2\n:PROPERTIES:\n:ARCHIVE_TIME: 2026-11-22 Sun 18:54\n:END:\n* B\nbody b\n** B1\n* C :x:\n');
});

// Conformance v0.1.22
test('archive records the TODO word, inherited tags and the entry\'s own category, and keeps an existing drawer', () => {
  const o = { fileName: '/tmp/f.org', category: 'f', now: NOW, archiveText: null, location: '%s_archive::' };
  const kid = '* P :work:home:\n** TODO Kid :own:\n* B\n';
  const a = archiveSubtree(kid, 1, o);
  assert.equal(a.text, '* P :work:home:\n* B\n');
  assert.equal(a.archive.text, '#    -*- mode: org -*-\n\n\nArchived entries from file /tmp/f.org\n\n\n* TODO Kid                                                              :own:\n:PROPERTIES:\n:ARCHIVE_TIME: 2026-11-22 Sun 18:54\n:ARCHIVE_FILE: /tmp/f.org\n:ARCHIVE_OLPATH: P\n:ARCHIVE_CATEGORY: f\n:ARCHIVE_TODO: TODO\n:ARCHIVE_ITAGS: work home\n:END:\n');
  const keep = archiveSubtree('* A\n:PROPERTIES:\n:ID: 1\n:CATEGORY: own\n:END:\ntext\n* B\n', 0, o).archive.text;
  assert.ok(keep.endsWith('* A\n:PROPERTIES:\n:ID: 1\n:CATEGORY: own\n:ARCHIVE_TIME: 2026-11-22 Sun 18:54\n:ARCHIVE_FILE: /tmp/f.org\n:ARCHIVE_CATEGORY: own\n:END:\ntext\n'));
  const plan = archiveSubtree('* TODO A :t:\nSCHEDULED: <2026-12-01 Tue>\ntext\n* B\n', 0, o).archive.text;
  assert.ok(plan.includes('* TODO A :t:\nSCHEDULED: <2026-12-01 Tue>\n:PROPERTIES:'));
});

test('refiling to another level realigns tags; archive to sibling reuses an Archive heading and works at the top level', () => {
  const r = refile('* TODO A :t:\nSCHEDULED: <2026-12-01 Tue>\nbody\n* B\n', 0, { line: 3, level: 1 }).text;
  assert.equal(r.split('\n')[1].length, 77);
  assert.equal(archiveToSibling('* P\n** A1\n** Archive :ARCHIVE:\n*** Old\n** A2\n', 4, { now: NOW, column: 0 }).text, '* P\n** A1\n** Archive :ARCHIVE:\n*** Old\n*** A2\n:PROPERTIES:\n:ARCHIVE_TIME: 2026-11-22 Sun 18:54\n:END:\n');
  assert.equal(archiveToSibling('* A\n* B\n', 1, { now: NOW, column: -77 }).text, `* A\n* Archive${' '.repeat(59)}:ARCHIVE:\n** B\n:PROPERTIES:\n:ARCHIVE_TIME: 2026-11-22 Sun 18:54\n:END:\n`);
});
