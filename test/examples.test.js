// The example files: each loads and parses, says what it claims, and the settings example covers every setting.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { analyze } from '../core/outline.js';
import { agenda } from '../core/agenda.js';
import { parseTemplates, promptsOf, expand, place } from '../core/capture.js';
import { parseRefileSettings, listTargets, archiveSubtree } from '../core/refile.js';
import { parseStringList } from '../core/lisp-list.js';
import { openClock } from '../core/clock.js';
import { isEffort } from '../core/effort.js';
import { propertiesOf } from '../core/properties.js';
import { SETTING_KEYS } from '../app/ui/config.js';

const dir = new URL('../examples/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.org')).sort();
const read = (f) => readFileSync(new URL(f, dir), 'utf8');
const date = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const block = (text, heading) => {
  const at = text.indexOf(`** ${heading}\n`);
  return /#\+begin_src emacs-lisp\n([\s\S]*?)#\+end_src/.exec(text.slice(at))[1];
};

test('there is an example for each area that is built', () => {
  for (const f of ['outline', 'dates', 'clocking', 'capture', 'refile-archive', 'weekly-review', 'project', 'search-replace', 'config', 'diary', 'contacts', 'agenda-birthdays', 'tables']) assert.ok(files.includes(`${f}.org`), `${f}.org`);
});

test('every example has a title and a license line and parses', () => {
  for (const f of files) {
    const t = read(f);
    assert.match(t, /^#\+TITLE: \S/m, `${f} title`);
    assert.match(t, /^# CC0 1\.0/m, `${f} license`);
    assert.ok(t.endsWith('\n'), `${f} ends with a newline`);
  }
});

test('every timestamp names the right weekday', () => {
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  for (const f of files) for (const m of read(f).matchAll(/[<[](\d{4})-(\d\d)-(\d\d) (\w{3})/g)) assert.equal(DAYS[date(`${m[1]}-${m[2]}-${m[3]}`).getUTCDay()], m[4], `${f}: ${m[0]}`);
});

test('the settings example names every setting the app keeps', () => {
  const t = read('config.org');
  for (const k of SETTING_KEYS) assert.ok(t.includes(k), k);
  assert.ok(t.includes('org-refile-settings') && t.includes('org-log-into-drawer'));
});

test('the settings example forms are ones the app accepts', () => {
  const t = read('config.org');
  assert.deepEqual(parseStringList(/setq org-agenda-files '(\([^)]*\))/.exec(block(t, 'Agenda files'))[1]), ['capture.org', 'weekly-review.org', 'project.org']);
  assert.equal(parseTemplates(block(t, 'Capture templates')).length, 4);
  assert.equal(parseRefileSettings(block(t, 'Refile targets')).outline, true);
});

test('each capture template files into capture.org', () => {
  const tpls = parseTemplates(block(read('config.org'), 'Capture templates'));
  for (const tpl of tpls) {
    const answers = promptsOf(tpl.template).map(() => 'x');
    const e = expand(tpl.template, { answers, now: new Date(Date.UTC(2026, 10, 23, 9, 0)), link: '' });
    const r = place(read('capture.org'), tpl, e.text.replace('\n  \n', '\n'));
    assert.ok(r.text.length > read('capture.org').length, tpl.key);
  }
});

test('the weekly review shows its entries on the right days', () => {
  const r = agenda([{ category: 'review', text: read('weekly-review.org') }], { start: date('2026-11-23'), span: 'week', today: date('2026-11-23') });
  const on = (day) => r.days.find((d) => d.date.toISOString().slice(0, 10) === day)?.entries.map((e) => e.title) ?? [];
  assert.ok(on('2026-11-23').includes('Plan the week'));
  assert.ok(on('2026-11-24').includes('Team meeting'));
  assert.ok(on('2026-11-27').includes('Submit the expense report'));
  assert.ok(on('2026-11-25').includes('Water the plants'));
});

test('the clocking examples have closed clocks and valid efforts', () => {
  for (const f of ['clocking.org', 'project.org']) {
    const t = read(f);
    assert.equal(openClock(t), null, f);
    const a = analyze(t);
    for (const h of a.heads) { const e = propertiesOf(t, h.line).find(([n]) => n === 'Effort'); if (e) assert.ok(isEffort(e[1]), `${f}: ${e[1]}`); }
  }
});

test('the refile and archive example offers targets and archives a subtree', () => {
  const text = read('refile-archive.org');
  const s = parseRefileSettings(block(read('config.org'), 'Refile targets'));
  const targets = listTargets([{ name: 'refile-archive.org', text }], s, { current: 'refile-archive.org' });
  assert.ok(targets.some((t) => t.label === 'Projects/Alpha'));
  const line = text.split('\n').findIndex((l) => l === '** Call the plumber' || l.endsWith('Call the plumber'));
  const r = archiveSubtree(text, line, { fileName: 'refile-archive.org', category: 'refile-archive', location: '%s_archive::', now: new Date(Date.UTC(2026, 10, 23, 9, 0)), archiveText: null });
  assert.ok(r.archive.text.includes('* Call the plumber') && !r.text.includes('Call the plumber'));
});

test('the birthday examples work together', () => {
  const v = agenda([{ category: 'agenda', text: read('agenda-birthdays.org') }], { start: date('2026-11-23'), span: 'day', today: date('2026-11-23'), timeGrid: false, contacts: { texts: [read('contacts.org')] } });
  assert.deepEqual(v.days[0].entries.map((e) => e.title), ['Birthday: Jane Doe (36th)', 'Birthday: John Smith (0th)']);
});

test('every example is offered under Sample documents and cached for offline use', () => {
  const main = readFileSync(new URL('../app/main.js', import.meta.url), 'utf8');
  const sw = readFileSync(new URL('../sw.js', import.meta.url), 'utf8');
  for (const f of files) { const id = f.replace(/\.org$/, ''); assert.ok(main.includes(`['${id}',`), `${id} is in the sample list`); assert.ok(sw.includes(`'examples/${f}'`), `${id} is cached`); }
});
