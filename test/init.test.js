import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadInit, printLisp, resolveName } from '../core/init.js';
import { readForms } from '../core/lisp-read.js';
import { parseTemplates } from '../core/capture.js';
import { parseRefileSettings } from '../core/refile.js';
import { parseStringList } from '../core/lisp-list.js';

const dir = new URL('./fixtures/init/', import.meta.url);
const author = { 'github:org/init.el': 'init.el', 'github:org/globals.el': 'globals.el', 'github:org/holidays.el': 'holidays.el', 'github:org/templates.el': 'templates.el' };
const fromFixtures = async (n) => { if (!author[n]) throw new Error(`no such file ${n}`); return fs.readFileSync(new URL(author[n], dir), 'utf8'); };
const files = (map) => async (n) => { if (!(n in map)) throw new Error(`no such file ${n}`); return map[n]; };
const yes = async () => true;
const run = (map, file = 'local:init.el', trusted = yes) => loadInit({ file, read: files(map), trusted });

test('the author\'s init.el loads its files and sets the settings the app has', async () => {
  const r = await loadInit({ file: 'github:org/init.el', read: fromFixtures, trusted: yes });
  assert.deepEqual(r.files.map((f) => f.name), ['github:org/init.el', 'github:org/globals.el', 'github:org/holidays.el', 'github:org/templates.el']);
  assert.deepEqual(parseStringList(r.settings['org-agenda-files']), ['github:home.org', 'github:journal.org', 'github:calendar.org']);
  assert.equal(r.settings['org-contacts-files'], 'github:contacts.org');
  assert.equal(r.settings['org-agenda-include-diary'], 't');
  assert.equal(r.settings['diary-file'], 'github:diary');
  assert.equal(r.settings['org.tagsColumn'], '0');
  assert.equal(r.settings['org-startup-indented'], 't');
  assert.equal(r.settings['holiday-local-holidays'], '(holiday-fixed 3 14 "Pi Day") (holiday-fixed 6 19 "Juneteenth")');
  assert.equal(parseRefileSettings(r.settings['org-refile-settings']).targets.length, 2);
  assert.equal(r.report.filter((x) => x.kind === 'error').length, 0);
});

test('settings the app does not use yet are kept and reported, not dropped', async () => {
  const r = await loadInit({ file: 'github:org/init.el', read: fromFixtures, trusted: yes });
  const kept = r.report.filter((x) => x.kind === 'kept').map((x) => x.message.split(' ')[0]);
  for (const n of ['org-xx-extra-menu', 'org-weather-format', 'org-babel-load-languages']) assert.ok(kept.includes(n), n);
  assert.ok(!kept.includes('holiday-hebrew-holidays'));
});

test('capture templates: add-to-list puts the newest first, and the functions come along', async () => {
  const r = await loadInit({ file: 'github:org/init.el', read: fromFixtures, trusted: yes });
  const t = parseTemplates(r.settings['org-capture-templates']);
  assert.deepEqual(t.map((x) => x.key), ['w', 'm', 't', 'c', 'j', 'v', 'a']);
  assert.ok(t[0].lisp.has('my-olp-target') && t[0].lisp.has('my-year-heading'));
});

test('a form that fails is reported with its file and line, and the rest still runs', async () => {
  const r = await run({ 'local:init.el': '(setq org-tags-column -60)\n\n(no-such-function 1)\n(setq diary-file "d")\n(setq diary-file' });
  assert.equal(r.settings['org.tagsColumn'], '-60');
  assert.equal(r.settings['diary-file'], 'd');
  const errs = r.report.filter((x) => x.kind === 'error');
  assert.deepEqual(errs.map((x) => [x.file, x.line, x.message]), [['local:init.el', 3, 'Not supported: no-such-function'], ['local:init.el', 5, 'A list is not closed']]);
});

test('a file that is not trusted does not run, and says so', async () => {
  const r = await run({ 'local:init.el': '(load "b.el")\n(setq diary-file "d")', 'local:b.el': '(setq org-tags-column 5)' }, 'local:init.el', async (n) => n !== 'local:b.el');
  assert.equal(r.settings['diary-file'], 'd');
  assert.equal(r.settings['org.tagsColumn'], undefined);
  assert.deepEqual(r.report.map((x) => [x.kind, x.file]), [['untrusted', 'local:b.el']]);
});

test('trust is asked by name and content hash', async () => {
  const asked = [];
  await run({ 'local:init.el': '(setq org-tags-column 5)' }, 'local:init.el', async (n, h, text) => { asked.push([n, h.length, text]); return true; });
  assert.deepEqual(asked, [['local:init.el', 64, '(setq org-tags-column 5)']]);
});

test('load: a bare name is beside the loading file, .el is tried first, a file that loads itself is reported', async () => {
  assert.equal(resolveName('b.el', 'github:org/init.el'), 'github:org/b.el');
  assert.equal(resolveName('local:b.el', 'github:org/init.el'), 'local:b.el');
  assert.equal(resolveName('b', 'local:init.el'), 'local:b');
  const r = await run({ 'local:org/init.el': '(load "b")', 'local:org/b.el': '(setq org-tags-column 7)(load "local:org/b.el")' }, 'local:org/init.el');
  assert.equal(r.settings['org.tagsColumn'], '7');
  assert.deepEqual(r.report.map((x) => x.message), ['Loading itself again']);
});

test('holiday categories: nil turns one off, all three on is the default', async () => {
  assert.equal((await run({ 'local:init.el': '(setq holiday-christian-holidays nil)' })).settings['calendar-holidays'], 'general solar');
  assert.equal((await run({ 'local:init.el': '(setq holiday-solar-holidays nil holiday-general-holidays nil holiday-christian-holidays nil)' })).settings['calendar-holidays'], 'nil');
  assert.equal((await run({ 'local:init.el': '(setq holiday-solar-holidays t)' })).settings['calendar-holidays'], '');
});

test('values: wrong types are reported against the variable; defvar does not override; comments inside setq are fine', async () => {
  const r = await run({ 'local:init.el': '(setq org-tags-column "x"\n ;org-agenda-files nil\n diary-file "f")\n(defvar diary-file "g")\n(defvar org-contacts-birthday-property "BDAY")' });
  assert.equal(r.settings['diary-file'], 'f');
  assert.equal(r.settings['org-contacts-birthday-property'], 'BDAY');
  assert.deepEqual(r.report.map((x) => x.message), ['org-tags-column: Expected an integer']);
});

test('printLisp gives text the reader reads back', () => {
  const src = `'(("a\\"b" 1 -2.5 nil t) (x :k . 3) 'q)`;
  const form = readForms(src)[0].quote;
  assert.deepEqual(readForms(`'${printLisp(form)}`)[0].quote, form);
});
