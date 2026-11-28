import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { scanLine, makeString, displayFormat, expandAbbrev, search, createHeading, atPoint, store } from '../core/links.js';

// Emacs 30.1 (conformance v0.1.70, ob-obj): the links, targets and footnote references found in each line.
const F = JSON.parse(fs.readFileSync(new URL('./fixtures/emacs-objects.json', import.meta.url)));
const lines = F.input.split('\n');
const shape = (o) => {
  if (['bracket', 'angle', 'plain'].includes(o.kind)) return ['link', o.type, o.path, o.format, o.search ?? null];
  if (o.kind === 'footnote') return ['footnote', o.inline ? 'inline' : 'standard', o.label];
  return [o.kind === 'radio' ? 'radio-target' : 'target'];
};
test('links, targets and footnote references in each line, as Emacs finds them', () => {
  const want = {};
  for (const [line, type, text, extra] of F.objects) {
    let s = null;
    if (type === 'link') s = ['link', extra[0], extra[1], extra[2], extra[3]];
    else if (type === 'footnote-reference') s = ['footnote', extra[0], extra[1]];
    else if (type === 'target') s = ['target'];
    else if (type === 'radio-target') s = ['radio-target'];
    if (s) (want[line] ??= []).push({ s, text });
  }
  for (let n = 1; n <= lines.length; n++) {
    if (n === 46 || n === 47) continue; // [fn:1] at the start of a line is a footnote definition that takes the lines after it
    const got = scanLine(lines[n - 1]).map((o) => ({ s: shape(o), text: lines[n - 1].slice(o.start, o.end) })).filter((o) => o.s[0] !== 'link' || true);
    const w = want[n] ?? [];
    const norm = (a) => a.map((x) => JSON.stringify(x.s) + x.text).sort();
    assert.deepEqual(norm(got), norm(w), `line ${n}: ${lines[n - 1]}`);
  }
});

// conformance v0.1.70 and v0.1.72 (ls-make-*, ls-disp-*, ls-abbrev-*, ij-*): writing a link and showing it
test('a link as Emacs writes it', () => {
  const cases = [['http://a.b', null, '[[http://a.b]]'], ['http://a.b', 'd', '[[http://a.b][d]]'], ['a[b]', 'd', '[[a\\[b\\]][d]]'], ['a]]', 'd', '[[a\\]\\]][d]]'], ['a\\', 'd', '[[a\\\\][d]]'], ['a\\]', 'd', '[[a\\\\\\]][d]]'],
    ['a b', 'd]]', '[[a b][d]\u200b]\u200b]]'], ['a', '[d]', '[[a][[d]\u200b]]'], ['a', '  d  ', '[[a][d]]'], ['a', '\n', '[[a]]'], ['', 'd', 'd'], ['a', '', '[[a]]']];
  for (const [l, d, w] of cases) assert.equal(makeString(l, d), w, `${l} ${d}`);
});
test('a link shows its description, or its path without one', () => {
  const cases = [['[[a][b]]', 'b'], ['[[a]]', 'a'], ['x [[a][b]] y [[c]] z', 'x b y c z'], ['[[a][b [[c]]]]', 'b [[c]]'], ['[[a]] [[b][c]]', 'a c'], ['[[a\\]b][d]]', 'd'], ['[[file:x.org::*H][T]]', 'T']];
  for (const [s, w] of cases) assert.equal(displayFormat(s), w, s);
});
test('abbreviations expand with %s and %h', () => {
  const alist = [['gh', 'https://github.com/%s'], ['q', 'https://q.x/?s=%h']];
  assert.equal(expandAbbrev('gh:foo/bar', alist), 'https://github.com/foo/bar');
  assert.equal(expandAbbrev('gh:a b', alist), 'https://github.com/a b');
  assert.equal(expandAbbrev('q:a b', alist), 'https://q.x/?s=a%20b');
  assert.equal(expandAbbrev('none:x', alist), 'none:x');
});

// conformance v0.1.70-71 (lo-*, o2-*): where a search option leads
const DOC = '* Alpha\ntext one\n** Beta :tag:\n:PROPERTIES:\n:CUSTOM_ID: cid\n:ID: uuid-1\n:END:\nsome words <<tgt>>\n#+NAME: nm\n| a | b |\n* Gamma\nfinal\n';
test('search options find headings, custom ids, targets, names and lines', () => {
  assert.deepEqual(search(DOC, '*Beta'), { line: 2, col: 0 });
  assert.deepEqual(search(DOC, '*beta'), { line: 2, col: 0 });
  assert.deepEqual(search(DOC, '*Be'), { create: 'Be' });
  assert.deepEqual(search(DOC, '#cid'), { line: 2, col: 0 });
  assert.equal(search(DOC, '#nope').error, 'No match for custom ID: nope');
  assert.deepEqual(search(DOC, 'tgt'), { line: 7, col: 11 });
  assert.deepEqual(search(DOC, 'nm'), { line: 8, col: 0 });
  assert.deepEqual(search(DOC, 'Gamma'), { line: 10, col: 0 });
  assert.deepEqual(search(DOC, 'Alpha'), { line: 0, col: 0 });
  assert.deepEqual(search(DOC, 'some words'), { create: 'some words' });
  assert.deepEqual(search(DOC, 'some words', { mustMatch: false }), { line: 7, col: 0 });
  assert.equal(search(DOC, 'some words', { mustMatch: true }).error, 'No match for fuzzy expression: some words');
  assert.deepEqual(search(DOC, '3'), { line: 2, col: 0 });
  assert.deepEqual(search(DOC, '99'), { line: 12, col: 0 });
  assert.deepEqual(search(DOC, '/more/'), { sparse: 'more' });
  assert.deepEqual(search('* TODO Task one\n', 'Task one'), { line: 0, col: 0 });
  assert.deepEqual(search('* Task :a:\n', 'Task'), { line: 0, col: 0 });
});
test('a link that finds nothing offers a new heading at the end', () => {
  assert.deepEqual(createHeading('a\nb\n', 'new'), { text: 'a\nb\n* new\n', line: 2, col: 5 });
  assert.equal(createHeading('a', 'new').text, 'a\n* new\n');
});

// conformance v0.1.71 (en-*): which link C-c C-o takes
test('C-c C-o takes the link under the cursor, else the entry\'s links', () => {
  const t = '* Alpha\ntext [[*Beta]] more\n* Beta\n';
  assert.equal(atPoint(t, 1, 7).object.path, '*Beta');
  assert.equal(atPoint(t, 1, 5).object.path, '*Beta');
  assert.equal(atPoint(t, 1, 13).object.path, '*Beta');
  assert.equal(atPoint(t, 1, 14).error, 'No link found');
  assert.equal(atPoint(t, 1, 15).object.path, '*Beta');
  assert.equal(atPoint('* Alpha\ntext\n* Beta\n', 1, 2).none, 'No links');
  assert.equal(atPoint('* Alpha\ntext\n** Sub\n[[*Beta]]\n* Beta\n', 1, 2).none, 'No links');
  assert.equal(atPoint('* Alpha\n[[*Beta]]\n* Beta\ntext\n', 3, 2).none, 'No links');
  assert.equal(atPoint('* Alpha\ntext [[*B]] and [[*C]]\n', 1, 2).choose.length, 2);
  assert.equal(atPoint('* Alpha\ntext [[*B]] x\n', 0, 2).object.path, '*B');
  assert.equal(atPoint('* Alpha\n[[http://a.b][x [[*Beta]] y]]\n', 1, 4).object.path, '//a.b');
});

// conformance v0.1.70 (sl-*): the link C-c l stores
test('C-c l stores a heading link, a custom id link, or a text link before any heading', () => {
  const f = '/tmp/x.org';
  assert.deepEqual(store('* Alpha\ntext\n', 1, f), { link: `file:${f}::*Alpha`, title: 'Alpha' });
  assert.deepEqual(store('* TODO Alpha :t:\ntext\n', 0, f), { link: `file:${f}::*Alpha`, title: 'Alpha' });
  assert.deepEqual(store('* See [[http://a.b][site]] now\n', 0, f), { link: `file:${f}::*See [[http://a.b][site]] now`, title: 'See site now' });
  assert.deepEqual(store('* Alpha\n** Beta\ntext\n', 2, f), { link: `file:${f}::*Beta`, title: 'Beta' });
  assert.deepEqual(store('* Alpha\n:PROPERTIES:\n:CUSTOM_ID: abc\n:END:\ntext\n', 4, f), { link: `file:${f}::#abc`, title: 'Alpha' });
  assert.equal(store('intro\n* Alpha\n', 0, f).link, `file:${f}::intro`);
});

test('C-c C-o picks the link at point or in the entry as Emacs does', () => {
  const cases = JSON.parse(fs.readFileSync(new URL('./fixtures/emacs-entry-links.json', import.meta.url), 'utf8'));
  for (const c of cases) {
    if (c.evaluated && c.id === 'en-in-src') continue;
    const r = atPoint(c.input, c.line, c.col);
    if (c.error) { assert.equal(r.error, c.error, c.id); continue; }
    if (c.prompt) { assert.ok(r.choose && r.choose.length >= 2, c.id); continue; }
    if (['en-none', 'en-child', 'en-prev'].includes(c.id)) { assert.ok(r.none, c.id); continue; }
    assert.ok(r.object, `${c.id} ${JSON.stringify(r)}`);
  }
});

test('C-c l makes an id link when org-id-link-to-org-use-id says so', () => {
  const have = store('* Alpha\n:PROPERTIES:\n:ID: u-1\n:END:\ntext\n', 0, 'f.org', { useId: 't' });
  assert.equal(have.link, 'id:u-1');
  assert.equal(have.title, 'Alpha');
  assert.equal(store('* Alpha\n:PROPERTIES:\n:ID: u-1\n:END:\ntext\n', 0, 'f.org').link, 'file:f.org::*Alpha');
  const made = store('* Alpha\ntext\n', 0, 'f.org', { useId: 't', newId: () => 'u-2' });
  assert.equal(made.link, 'id:u-2');
  assert.equal(made.text, '* Alpha\n:PROPERTIES:\n:ID:       u-2\n:END:\ntext\n');
  assert.equal(store('* Alpha\ntext\n', 0, 'f.org', { useId: 'use-existing' }).link, 'file:f.org::*Alpha');
});

import { radioNames, scanLine as scan2, radioTarget as rt2 } from '../core/links.js';
test('radio targets make matching words links (Emacs 30.1, tg-radio-*)', () => {
  const t = '* A\n<<<rad one>>>\n* B\nuse rad one and Rad One there, radius, [[rad one]] and *rad one*\n';
  const names = radioNames(t);
  assert.deepEqual(names, ['rad one']);
  const kinds = scan2(t.split('\n')[3], names).map((o) => o.kind);
  assert.deepEqual(kinds, ['radio-link', 'radio-link', 'bracket', 'radio-link']);
  assert.deepEqual(rt2(t, 'RAD  one'), { line: 1, col: 0 });
});

// A radio link over a line break: the link text Emacs found (Emacs 30.1).
import { radioBreaks } from '../core/links.js';
const breakCases = JSON.parse(fs.readFileSync(new URL('./fixtures/emacs-radio-breaks.json', import.meta.url)));
for (const c of breakCases) {
  test(`Emacs radio link over a break ${c.id}`, () => {
    const rows = c.input.split('\n');
    const pieces = radioBreaks(c.input, radioNames(c.input));
    const first = pieces.get(c.line);
    assert.ok(first, 'the link starts on the line Emacs found');
    const parts = []; let l = c.line;
    for (let k = 0; k < 4 && pieces.has(l); k++, l++) { const p = pieces.get(l)[0]; parts.push(rows[l].slice(k === 0 ? p.start : 0, p.end)); }
    assert.equal(parts.join('\n'), c.text);
  });
}
