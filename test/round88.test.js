// What Emacs 30.1 / Org 9.7.11 did in conformance v0.1.88: scripts and entities as drawn, the date type of C-c / b, a and D, %u and %U in log
// headings, CLOSED when a schedule or deadline is set.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pretty } from '../core/pretty.js';
import { dateSparse } from '../core/sparse.js';
import { analyze } from '../core/outline.js';
import { formatHeading, user, dropClosed, setPlanning } from '../core/timestamp.js';

const F = JSON.parse(fs.readFileSync(new URL('./fixtures/emacs-round88.json', import.meta.url)));

/** The characters Emacs hides and the ones it raises (+) or lowers (-), from the pieces `pretty` draws. */
function marks(text, how) {
  const hidden = new Set();
  const raise = new Map();
  let at = 0;
  const walk = (parts, base, r) => {
    for (const p of parts) {
      if (p.text !== undefined) { at += p.text.length; continue; }
      if (p.entity !== undefined) { at += p.raw.length; continue; }
      const start = at;
      const braced = p.raw[1] === '{';
      hidden.add(start);
      at += 1;
      if (braced) { hidden.add(at); at += 1; }
      const mark = p.sub ? '-0.3' : '0.3';
      const from = at;
      walk(p.parts, 0, mark);
      for (let k = from; k < at; k++) raise.set(k, mark);
      if (braced) { hidden.add(at); raise.set(at, mark); raise.set(start + 1, mark); at += 1; }
    }
  };
  walk(pretty(text, how), 0, null);
  return { hidden, raise };
}

for (const [name, how] of [['dsp-t', { entities: true, scripts: true, braces: false }], ['dsp-brace', { entities: true, scripts: true, braces: true }], ['dsp-nil', { entities: true, scripts: true, braces: true }]]) {
  test(`Emacs ${name}: which characters are hidden and raised`, () => {
    const c = F.display[name];
    const hidden = new Set();
    const raise = new Map();
    let end = c.input.length;
    c.runs.forEach(([from, r, inv], k) => {
      const to = c.runs[k + 1]?.[0] ?? end;
      for (let i = from; i < to; i++) { if (inv) hidden.add(i); if (r) raise.set(i, r); }
    });
    // Emacs draws \alpha and \rarr as one composed character each; they are not hidden or raised, so compare the script characters only
    const mine = marks(c.input, how);
    const upto = c.input.indexOf('\\alpha');
    assert.deepEqual([...mine.hidden].filter((i) => i < upto).sort((a, b) => a - b), [...hidden].filter((i) => i < upto).sort((a, b) => a - b));
    assert.deepEqual([...mine.raise].filter(([i]) => i < upto).sort((a, b) => a[0] - b[0]), [...raise].filter(([i]) => i < upto).sort((a, b) => a[0] - b[0]));
  });
}

test('Emacs dsp-nohide: with scripts off nothing is hidden or raised, and entities still draw', () => {
  const p = pretty(F.display['dsp-nohide'].input, { entities: true, scripts: false, braces: false });
  assert.deepEqual(p.map((x) => x.entity ?? x.text), ['x_{1} ', 'α']);
});

test('a name that is not an entity stays as typed', () => {
  assert.deepEqual(pretty('\\notanentity and \\alphabet', { entities: true, scripts: true, braces: false }).map((x) => x.text), ['\\notanentity and \\alphabet']);
});

const S = '* TODO a\nSCHEDULED: <2026-11-20 Fri>\n* b\nDEADLINE: <2026-11-22 Sun>\n* c\nSCHEDULED: <2026-11-18 Wed> DEADLINE: <2026-11-24 Tue>\n';
for (const [id, type] of [['sp2-b', null], ['sp2-cb', 'all'], ['sp2-ccb', 'scheduled'], ['sp2-cccb', 'deadline']]) {
  test(`Emacs ${id}: C-c / b with the date type ${type ?? 'scheduled/deadline'}`, () => {
    const c = F.sparse[id];
    const r = dateSparse(S, analyze(S), { mode: 'before', from: '2026-11-21', type });
    const n = Number(/^(\d+) entries before/.exec(c.msg)[1]);
    assert.equal(r.count, n);
  });
}

test('Emacs us2: %u is the login name and %U the full name', () => {
  const was = { ...user };
  Object.assign(user, { login: 'bob', full: 'Bob Smith' });
  try {
    const now = new Date(Date.UTC(2026, 10, 26, 9, 30));
    assert.equal(`- ${formatHeading('state', { state: 'WAIT', now }, { state: 'State %s by %u (%U)' })}`, F.us['us2-both'].split('\n')[2]);
    assert.equal(`- ${formatHeading('state', { now }, { state: '%u' })}`, F.us['us2-u'].split('\n')[2]);
    assert.equal(`- ${formatHeading('state', { now }, { state: '%U' })}`, F.us['us2-big'].split('\n')[2]);
  } finally { Object.assign(user, was); }
});

test('Emacs cl-*: setting a schedule or a deadline drops CLOSED, whatever the keyword', () => {
  for (const [id, input, kw] of [['cl-dead-closed-add', '* DONE a\nCLOSED: [2026-11-19 Thu 10:00]\n', 'DEADLINE'], ['cl-sched-closed-add', '* DONE a\nCLOSED: [2026-11-19 Thu 10:00]\n', 'SCHEDULED'], ['cl-sched-closed-nokw', '* a\nCLOSED: [2026-11-19 Thu 10:00]\n', 'SCHEDULED'], ['cl-sched-closed-todo', '* TODO a\nCLOSED: [2026-11-19 Thu 10:00]\n', 'SCHEDULED']]) {
    const got = setPlanning(dropClosed(input, 0), 0, kw, '<2026-12-01 Tue>').text;
    assert.equal(got, F.closed[id].replace(/\n$/, '') + '\n', id);
  }
});

// Conformance v0.1.89
const G = JSON.parse(fs.readFileSync(new URL('./fixtures/emacs-round89.json', import.meta.url)));
const BODY = '* a\nSCHEDULED: <2026-11-20 Fri>\nsee <2026-11-19 Thu> here\n* b\n[2026-11-18 Wed] inactive\n* c <2026-11-17 Tue>\n* d\nCLOSED: [2026-11-10 Tue]\n* e\n<2026-11-30 Mon> and <2026-11-05 Thu>\n';
import { hiddenLines } from '../core/outline.js';
import { deadlineSparse } from '../core/sparse.js';
const shown = (text, folds) => { const a = analyze(text); const hid = hiddenLines(a.foldables, folds); return text.split('\n').map((_, i) => i + 1).filter((n) => !hid.has(n - 1)); };

for (const [id, mode, type] of [['sp3-allb', 'before', 'all'], ['sp3-alla', 'after', 'all'], ['sp3-dateb', 'before', null], ['sp3-schedb', 'before', 'scheduled']]) {
  test(`Emacs ${id}: the date type counts what Emacs counted`, () => {
    const r = dateSparse(BODY, analyze(BODY), { mode, from: '2026-11-21', type });
    assert.equal(r.count, Number(/^(\d+)/.exec(G.sp3[id].msg)[1]));
    assert.deepEqual(shown(BODY, r.folds).filter((n) => n <= 10), G.sp3[id].visible.filter((n) => n <= 10));
  });
}

const DL = '* TODO a\nDEADLINE: <2026-11-27 Fri>\n* TODO b\nDEADLINE: <2026-11-29 Sun>\n* TODO c\nDEADLINE: <2026-12-05 Sat>\n* TODO d\nDEADLINE: <2026-12-20 Sun>\n* DONE e\nDEADLINE: <2026-11-25 Wed>\n* TODO f\nDEADLINE: <2026-11-26 Thu -3d>\n* TODO g\nDEADLINE: <2026-11-24 Tue>\n';
for (const [id, days] of [['dd-3', 3], ['dd-20', 20], ['dd-0', 0], ['dd-neg', -3], ['dd-none', 14]]) {
  test(`Emacs ${id}: C-c / d within ${days} days`, () => {
    const r = deadlineSparse(DL, analyze(DL), { days, today: '2026-11-26' });
    assert.equal(r.count, Number(/^(\d+)/.exec(G.dd[id].msg)[1]));
    assert.deepEqual(shown(DL, r.folds).filter((n) => n <= 14), G.dd[id].visible.filter((n) => n <= 14));
  });
}

// Conformance v0.1.90: the deadline window does not depend on the hour, and is N + 2 days
const H = JSON.parse(fs.readFileSync(new URL('./fixtures/emacs-round90.json', import.meta.url)));
const WIN = '* TODO a\nDEADLINE: <2026-11-26 Thu>\n* TODO b\nDEADLINE: <2026-11-27 Fri>\n* TODO c\nDEADLINE: <2026-11-28 Sat>\n* TODO d\nDEADLINE: <2026-11-29 Sun>\n';
const EDGE = '* TODO a\nDEADLINE: <2026-12-10 Thu>\n* TODO b\nDEADLINE: <2026-12-11 Fri>\n* TODO c\nDEADLINE: <2026-12-12 Sat>\n';
for (const [id, text, days] of [['dw-0-0005', WIN, 0], ['dw-0-2355', WIN, 0], ['dw-1-0930', WIN, 1], ['dw-2-2355', WIN, 2], ['dw-def-0930', EDGE, 14], ['dw-def-2355', EDGE, 14], ['dw-cu', WIN, 100000]]) {
  test(`Emacs ${id}: deadlines within ${days} days`, () => {
    const r = deadlineSparse(text, analyze(text), { days, today: '2026-11-26' });
    assert.equal(r.count, Number(/^(\d+)/.exec(H[id].msg)[1]));
    const last = text.split('\n').length - 1;
    assert.deepEqual(shown(text, r.folds).filter((n) => n <= last), H[id].visible.filter((n) => n <= last));
  });
}
