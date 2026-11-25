// Refile and archive, against results Emacs 30.1 gave (conformance v0.1.20).
import test from 'node:test';
import assert from 'node:assert/strict';
import { archiveSubtree, archiveToSibling, listTargets, newChild, parseRefileSettings, refile, toggleArchiveTag } from '../core/refile.js';

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

// Emacs results, conformance v0.1.23: org-archive-mark-done and org-archive-save-context-info.
test('archive marks a TODO heading done and saves only the context asked for', () => {
  const o = { fileName: '/tmp/f.org', category: 'f', now: NOW, archiveText: null, location: '%s_archive::' };
  const BIG = '* P :work:\n** TODO Kid :own:\nSCHEDULED: <2026-12-01 Tue>\ntext\n* B\n';
  const kid = BIG.split('\n').findIndex((l) => /Kid/.test(l));
  const body = (r) => r.archive.text.replace(/^[^]*?from file [^\n]*\n\n\n/, '');
  assert.match(body(archiveSubtree(BIG, kid, { ...o, markDone: true })), /^\* DONE Kid +:own:\nSCHEDULED: <2026-12-01 Tue>\n:PROPERTIES:[^]*:ARCHIVE_TODO: TODO\n/);
  assert.match(body(archiveSubtree(BIG, kid, { ...o, markDone: null })), /^\* TODO Kid/);
  assert.match(body(archiveSubtree('#+TODO: TODO | DONE CANCELLED\n* TODO A\n* B\n', 1, { ...o, markDone: 'CANCELLED' })), /^\* CANCELLED A\n:PROPERTIES:[^]*:ARCHIVE_TODO: TODO\n/);
  assert.match(body(archiveSubtree('* DONE A\nCLOSED: [2026-11-01 Sun 10:00]\n* B\n', 0, { ...o, markDone: 'DONE' })), /^\* DONE A\nCLOSED: \[2026-11-01 Sun 10:00\]\n:PROPERTIES:/);
  const props = (info) => body(archiveSubtree(BIG, kid, { ...o, contextInfo: info })).match(/:ARCHIVE_\w+:/g) ?? [];
  assert.deepEqual(props(['time']), [':ARCHIVE_TIME:']);
  assert.deepEqual(props([]), []);
  assert.deepEqual(props(['file', 'todo', 'itags']), [':ARCHIVE_FILE:', ':ARCHIVE_TODO:', ':ARCHIVE_ITAGS:']);
  assert.deepEqual(props(['olpath', 'category']), [':ARCHIVE_OLPATH:', ':ARCHIVE_CATEGORY:']);
});

// Emacs results, conformance v0.1.24: a new heading under a target gets a blank line before it.
test('a new child heading goes at the end of the target subtree', () => {
  const T2 = '* A\n** A1\n* B\n';
  const ts = targets('(setq org-refile-targets \'((nil :maxlevel . 1)))', T2);
  const r = newChild(T2, find(ts, 'B'), 'Newkid');
  assert.equal(r.text, '* A\n** A1\n* B\n\n** Newkid\n');
  assert.equal(r.line, 4);
  assert.equal(newChild('* A\n** A1\n* B', find(ts, 'A'), 'N').text, '* A\n** A1\n\n** N\n* B');
});

import { readFileSync } from 'node:fs';
import { RefileCache, checkTarget, STALE_TARGET } from '../core/refile.js';
{
  const C = JSON.parse(readFileSync(new URL('./fixtures/emacs-cookies.json', import.meta.url)));
  const targets = (text, s) => listTargets([{ name: 'a.org', text }], parseRefileSettings(s), { current: 'a.org' });
  const labels = (l) => l.map((t) => t.label);
  const T2 = '(setq org-refile-targets \'((nil :maxlevel . 2)) org-refile-use-cache t)';
  test('Emacs refile cache: the first listing and a listing after an edit', () => {
    const c = new RefileCache();
    const s = parseRefileSettings(T2);
    const first = c.get(s, 'a.org', () => targets(C['rc-stale'].input, T2));
    assert.equal(`T ${JSON.stringify(labels(first)).replace(/"/g, '\\"').replace(/^\[/, '(').replace(/\]$/, ')').replace(/,/g, ' ')}`.replace(/\\"/g, '"'), C['rc-stale'].texts[2].replace(/\\"/g, '"'));
    const again = c.get(s, 'a.org', () => targets(`${C['rc-stale'].input}* Three\n`, T2));
    assert.deepEqual(labels(again), ['One', 'Sub', 'Two']);
    c.clear();
    assert.deepEqual(labels(c.get(s, 'a.org', () => targets(`${C['rc-stale'].input}* Three\n`, T2))), ['One', 'Sub', 'Two', 'Three']);
  });
  test('Emacs refile cache: off, other settings and another buffer list afresh', () => {
    const c = new RefileCache();
    const off = parseRefileSettings(T2.replace(' t)', ' nil)'));
    c.get(off, 'a.org', () => targets('* One\n', T2));
    assert.deepEqual(labels(c.get(off, 'a.org', () => targets('* One\n* Three\n', T2))), ['One', 'Three']);
    const on = parseRefileSettings(T2);
    c.get(on, 'a.org', () => targets('* One\n', T2));
    assert.deepEqual(labels(c.get(parseRefileSettings(T2.replace('2)', '1)')), 'a.org', () => targets('* Q\n', T2))), ['Q']);
    c.get(on, 'a.org', () => targets('* One\n', T2));
    assert.deepEqual(labels(c.get(on, 'b.org', () => targets('* Z\n', T2))), ['Z']);
  });
  test('Emacs refile cache: a target whose heading changed is stale', () => {
    const t = targets(C['rc-pos'].input, T2)[0];
    checkTarget(t, C['rc-pos'].input);
    assert.throws(() => checkTarget(t, C['rc-pos-stale'].text), { message: STALE_TARGET });
    assert.equal(C['rc-pos-stale'].texts[2], `ERR ${STALE_TARGET}`);
  });
}
