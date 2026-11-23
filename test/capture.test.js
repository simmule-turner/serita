// Capture: the templates, their escapes and where the text goes, replayed from Emacs 30.1 results (the stamps there read 2026-11-22 18:26).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readForms, isSym } from '../core/lisp-read.js';
import { parseTemplates, promptsOf, expand, place } from '../core/capture.js';

const cases = JSON.parse(readFileSync(new URL('./fixtures/emacs-capture.json', import.meta.url), 'utf8'));
const now = new Date(Date.UTC(2026, 10, 22, 18, 26));

for (const c of cases) {
  test(`Emacs capture ${c.id}`, () => {
    const [tpl] = parseTemplates(`(setq org-capture-templates '(${c.tpl}))`);
    const e = expand(tpl.template, { answers: c.answers, now, link: '[[file:FILE::*Existing][Existing]]' });
    const captured = tpl.opts.immediate ? e.text : e.text.slice(0, e.caret) + c.typed + e.text.slice(e.caret);
    if (c.error) { assert.throws(() => place(c.input, tpl, captured), { message: c.error }); return; }
    assert.equal(place(c.input, tpl, captured).text, c.text);
  });
}

test('prompts: a default and a choice list follow after |', () => {
  assert.deepEqual(promptsOf('%^{Title|Dflt} %^{Pick|a|b|c} %^{Plain}'), [
    { prompt: 'Title', default: 'Dflt', choices: [] }, { prompt: 'Pick', default: '', choices: ['a', 'b', 'c'] }, { prompt: 'Plain', default: '', choices: [] }]);
});

test('an empty answer takes the default', () => {
  assert.equal(expand('* %^{Title|Dflt}', { answers: [''], now }).text, '* Dflt');
});

test('the reader reads lists, strings, keywords and quotes', () => {
  const [form] = readForms('(a "b\\n" :c 1 t nil \'(d)) ; note');
  assert.equal(isSym(form[0], 'a'), true);
  assert.equal(form[1], 'b\n');
  assert.equal(form[3], 1);
  assert.equal(form[4], true);
  assert.equal(form[5], null);
  assert.deepEqual(form[6], { quote: [{ sym: 'd' }] });
});

test('add-to-list and setq both give templates; unsupported targets are named', () => {
  const t = parseTemplates('(add-to-list \'org-capture-templates \'("a" "A" entry (file "f.org") "* %?"))\n(add-to-list \'org-capture-templates \'("b" "B" plain (file "f.org") "%?"))');
  assert.deepEqual(t.map((x) => x.key), ['a', 'b']);
  assert.throws(() => parseTemplates('(setq org-capture-templates \'(("a" "A" entry (function foo) "* %?")))'), /not supported yet/);
});
