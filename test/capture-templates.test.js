// Capture with the author's own templates.el (functions as targets, :prepare-finalize, %^T), replayed from Emacs 30.1 results.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseTemplates, promptsOf, expand, place } from '../core/capture.js';

const read = (f) => readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8');
const cases = JSON.parse(read('emacs-capture-templates.json'));
const user = parseTemplates(read('user-templates.el'));
const stamp = (active) => (active ? '<2026-11-27 Fri 10:30>' : '[2026-11-27 Fri 10:30]');

for (const c of cases) {
  test(`Emacs capture templates ${c.id}`, () => {
    const [d, t] = c.now.split(' ');
    const [Y, M, D] = d.split('-').map(Number); const [h, mi] = t.split(':').map(Number);
    const now = new Date(Date.UTC(Y, M - 1, D, h, mi));
    const [x] = c.custom ? parseTemplates(`(setq org-capture-templates '(("x" "X" ${c.custom.type} ${c.custom.target.includes('file+headline') ? '(file+headline "f.org" "L")' : '(file "f.org")'} ${JSON.stringify(c.custom.tpl)} ${c.custom.opts})))`) : [user.find((u) => u.key === c.tpl)];
    let n = 0;
    const answers = promptsOf(x.template).map((p) => (p.date ? stamp(p.date.active) : c.answers[n++] ?? ''));
    const e = expand(x.template, { answers, now });
    let captured = e.text.slice(0, e.caret) + c.typed + e.text.slice(e.caret);
    if (x.opts.prepare) captured = x.lisp.call(x.opts.prepare, captured).text;
    if (c.error) { assert.throws(() => place(c.input, x, captured)); return; }
    assert.equal(place(c.input, x, captured, { unchanged: c.typed === '' }).text, c.text);
  });
}
