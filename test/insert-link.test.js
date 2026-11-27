import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { insertPlan, applyInsert, fileAnswer } from '../core/links.js';

const cases = JSON.parse(fs.readFileSync(new URL('./fixtures/emacs-insert-link.json', import.meta.url), 'utf8'));

for (const c of cases) {
  test(`insert link ${c.id} matches Emacs`, () => {
    const plan = insertPlan(c.input, c.line, c.col, c.region);
    let [link, desc] = c.answers;
    if (c.prefix) { link = fileAnswer(link, { absolute: c.prefix === '16', dir: c.dir }); }
    const r = applyInsert(c.input, plan, { link, desc, dir: c.dir, keepAbsolute: c.prefix === '16' });
    if (c.error) { assert.equal(r.error, c.error); assert.equal(r.text ?? c.input, c.text); return; }
    assert.equal(r.text, c.text);
    assert.equal(r.offset, c.point);
    const first = c.prompts.find((p) => p[0] === 'read-string' && p[1] === 'Description: ');
    if (first && !c.id.startsWith('ij-stored')) assert.equal(plan.desc, first[2]);
  });
}
