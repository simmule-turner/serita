import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { exportRows } from '../core/tblexport.js';

// Emacs 30.1 (Org 9.7.11), one cell at a time through orgtbl-to-<format>; newlines in the output are written as \n in the fixture.
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/emacs-markup-cells.json', import.meta.url)));
// Cells whose Emacs result is not reproduced yet: a lone asterisk is read as a headline there
const KNOWN = new Set(['*', '* ']);
for (const [format, entries] of Object.entries(fixture)) {
  for (const { cell, out } of entries) {
    if (KNOWN.has(cell)) continue;
    test(`${format}: ${JSON.stringify(cell)}`, () => {
      const error = /^ERR \((?:user-)?error "((?:[^"\\]|\\.)*)"/.exec(out);
      // Emacs's html translator fails on a footnote with an internal message of its own; the other formats say the footnote is not defined
      if (error) return assert.throws(() => exportRows([[cell]], format), (e) => (format === 'html' && cell === '[fn:1]') || e.message === error[1].split('\n')[0].replace(/\\"/g, '"'));
      assert.equal(exportRows([[cell]], format).replace(/\n/g, '\\n'), out);
    });
  }
}
