import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as T from '../core/table.js';
import { exportRows } from '../core/tblexport.js';
import { copyRectangle, pasteRectangle, rotateMark } from '../core/tblcmd.js';

// Each case is a question put to Emacs 30.1 (Org 9.7.11); the fixture holds its answers.
const F = JSON.parse(fs.readFileSync(new URL('./fixtures/emacs-table-transfer.json', import.meta.url), 'utf8'));

test('Emacs table export: orgtbl-to-* on the rows of a table', () => {
  for (const c of F.export) assert.equal(exportRows(T.toLisp(c.input, 0), c.format, c.options), c.want, c.id);
});

test('Emacs table import: the text goes in at the cursor and becomes a table', () => {
  for (const c of F.import) {
    if (c.error) { assert.throws(() => T.importText(c.input, c.input.length, c.imported), c.id); continue; }
    assert.equal(T.importText(c.input, c.input.length, c.imported, c.sep === 'comma' ? ',' : 'guess').text, c.want, c.id);
  }
});

test('Emacs convert region: separators', () => {
  for (const c of F.convert) assert.equal(T.convertRegion(c.input, c.from, c.to, c.sep).text, c.want, c.id);
});

const P = (l, c) => ({ line: l - 1, col: c });
const RECT = {
  'rr-copy': (t) => { const c = copyRectangle(t, P(3, 2), P(4, 6)); return pasteRectangle(c.text, 4, 2, c.clip).text; },
  'rr-cut': (t) => { const c = copyRectangle(t, P(3, 2), P(4, 6), true); return pasteRectangle(c.text, 2, 10, c.clip).text; },
  'rr-field': (t) => { const c = copyRectangle(t, P(3, 2), P(3, 2)); return pasteRectangle(c.text, 4, 10, c.clip).text; },
  'rr-edge': (t) => { const c = copyRectangle(t, P(3, 2), P(4, 6)); return pasteRectangle(c.text, 2, 14, c.clip).text; },
  'rr-bottom': (t) => { const c = copyRectangle(t, P(3, 2), P(4, 6)); return pasteRectangle(c.text, 4, 2, c.clip).text; },
  'rr-rule': (t) => { const c = copyRectangle(t, P(1, 2), P(4, 6)); return pasteRectangle(c.text, 4, 2, c.clip).text; },
  'rr-copy-only': (t) => copyRectangle(t, P(3, 2), P(4, 6)).text,
  'rr-formula': (t) => { const c = copyRectangle(t, P(1, 2), P(2, 2)); return pasteRectangle(c.text, 0, 6, c.clip).text; },
};

test('Emacs table rectangles: copy, cut and paste cells', () => {
  for (const c of F.rect) assert.equal(RECT[c.id](c.input), c.want, c.id);
  assert.equal(pasteRectangle('| a |\n', 0, 2, null).error, 'First cut/copy a region to paste!');
});

test('Emacs org-table-rotate-recalc-marks: blank to #, to *, and back', () => {
  for (const c of F.mark) assert.equal(rotateMark(rotateMark(c.input, 3).text, 3).text, c.want, c.id);
});
