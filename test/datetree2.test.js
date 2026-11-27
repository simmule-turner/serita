import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseTemplates, place } from '../core/capture.js';

// Emacs 30.1 (conformance v0.1.68, wk-* and tm-*): week trees file under the ISO year; :tree-type month stops at the month.
const cases = JSON.parse(fs.readFileSync(new URL('./fixtures/emacs-datetree2.json', import.meta.url)));
for (const c of cases) {
  test(c.id, () => {
    const [y, m, d] = c.date;
    const target = c.tree === 'week' ? '(file+weektree "x.org")' : '(file+datetree "x.org")';
    const opt = c.tree === 'month' ? ' :tree-type month' : '';
    const tpl = parseTemplates(`(setq org-capture-templates '(("k" "Desc" entry ${target} "* %?\\n"${opt})))`)[0];
    const date = new Date(Date.UTC(y, m - 1, d, 10, 0));
    assert.equal(place(c.input, tpl, '* new\n', { date }).text, c.expect);
  });
}
