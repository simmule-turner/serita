// Plain lists against Emacs 30.1 (conformance v0.1.73, li-*): new items, bullets, numbering, toggles, checkboxes, sorting, moving and indenting.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as L from '../core/lists.js';
import * as oe from '../core/outline-edit.js';

const F = JSON.parse(readFileSync(new URL('./fixtures/emacs-lists.json', import.meta.url), 'utf8'));
const mv = (d) => (t, l) => oe.moveItem(t, l, d);
const ind = (d, w) => (t, l) => oe.indentItem(t, l, d, w);
/** A region case: the cursor is at its end, `n` lines below where the case starts. */
const reg = (n, f) => (t, l) => f(t, l + n, 0, [l, l + n]);
const T = {
  'li-mup': mv(-1), 'li-mup-ord': mv(-1), 'li-mdown': mv(1), 'li-mdown-last': mv(1), 'li-mdown-sub': mv(1),
  'li-indent': ind(1), 'li-indent-ord': ind(1), 'li-outdent': ind(-1), 'li-outdent-ord': ind(-1), 'li-ms-right': ind(1, true), 'li-ms-left': ind(-1, true),
  'li-tc-cookie': (t, l) => oe.toggleCheckbox(t, l), 'li-tc-partial': (t, l) => oe.toggleCheckbox(t, l, { lenient: true }), 'li-tc-pct': (t, l) => oe.toggleCheckbox(t, l),
  'li-tc-cookie2': (t, l) => oe.toggleCheckbox(oe.toggleCheckbox(t, l).text, l + 1),
  'li-repair': (t, l, c) => L.repair(t, l, c), 'li-align': (t, l, c) => L.repair(t, l, c), 'li-cc-ord': (t, l, c) => L.repair(t, l, c),
  'li-heading': L.toggleHeading, 'li-heading-text': L.toggleHeading, 'li-heading-back': L.toggleHeading,
  'li-rm-item': (t, l, c) => L.toggleItem(t, l, c), 'li-mk-item': (t, l, c) => L.toggleItem(t, l, c), 'li-mk-item-c4': (t, l, c) => L.toggleItem(t, l, c),
  'li-mk-item-region': reg(2, (t, l, c, r) => L.toggleItem(t, l, c, { region: r })),
  'li-cminus-text': L.ctrlCMinus, 'li-cminus-heading': L.ctrlCMinus, 'li-cminus-blank': L.ctrlCMinus, 'li-cminus-ord': L.ctrlCMinus,
  'li-cminus-region': reg(3, (t, l, c, r) => L.ctrlCMinus(t, l, c, { region: r })),
  'li-cbullet': (t, l, c) => L.ctrlCMinus(t, l, c), 'li-cbullet-prev': (t, l, c) => L.ctrlCMinus(t, l, c, { which: 'previous' }),
  'li-cbullet-arg': (t, l, c) => L.ctrlCMinus(t, l, c, { which: 2 }), 'li-cbullet-whole': L.ctrlCMinus,
  'li-tc-add': (t, l, c) => L.boxCommand(t, l, c, { list: 4 }), 'li-tc-ord': (t, l, c) => L.boxCommand(t, l, c, { list: 4 }),
  'li-tc-text': (t, l, c) => L.boxCommand(t, l, c, { list: 4 }), 'li-tc-remove': (t, l, c) => L.boxCommand(t, l, c, { list: 16 }),
  'li-tc-add-region': reg(3, (t, l, c, r) => L.boxCommand(t, l, c, { list: 4, region: r })),
  'li-cc-c4': (t, l, c) => L.boxCommand(t, l, c, { list: 4 }), 'li-cc-c16': (t, l, c) => L.boxCommand(t, l, c, { list: 16 }),
};
for (let k = 1; k <= 4; k++) T[`li-cminus-${k}`] = (t, l, c) => { let r = { text: t, line: l, col: c }; for (let j = 0; j < k; j++) r = L.ctrlCMinus(r.text, l, r.col); return r; };
for (const id of ['li-mret-end', 'li-mret-mid', 'li-mret-bol', 'li-mret-empty', 'li-mret-ord', 'li-mret-ord-paren', 'li-mret-box', 'li-mret-box-mid', 'li-mret-nested', 'li-mret-desc', 'li-mret-multi', 'li-mret-multi-b', 'li-ord-start', 'li-ord-cookie']) T[id] = (t, l, c) => L.insertItem(t, l, c);
for (const id of ['li-msret', 'li-msret-box']) T[id] = (t, l, c) => L.insertItem(t, l, c, { box: true });
for (const [id, k] of [['li-sort-a', 'a'], ['li-sort-A', 'A'], ['li-sort-n', 'n'], ['li-sort-t', 't'], ['li-sort-x', 'x'], ['li-sort-ord', 'a'], ['li-sort-nested', 'a'], ['li-sort-ci', 'a'], ['li-sort-prompt', 'a']]) T[id] = (t, l) => L.sortList(t, l, k);

for (const [id, fn] of Object.entries(T)) {
  test(`Emacs lists: ${id}`, () => {
    const c = F[id];
    let got;
    try { got = fn(c.input, c.line - 1, c.col); } catch (e) { got = { error: e.message }; }
    if (c.error) { assert.ok(got.error !== undefined, 'an error'); return; }
    assert.equal(got.error, undefined);
    assert.equal(got.text, c.text);
    if (got.line !== undefined) assert.equal(got.line + 1, c.pt[0]);
    if (got.col !== undefined) assert.equal(got.col, c.pt[1]);
  });
}
