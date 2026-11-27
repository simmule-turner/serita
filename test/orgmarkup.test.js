import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { exportRows } from '../core/tblexport.js';

// Emacs 30.1 (Org 9.7.11) output for a table of special characters and markup in each format.
for (const format of ['latex', 'html', 'texinfo', 'unicode']) {
  test(`table markup in ${format} matches Emacs`, () => {
    const j = JSON.parse(fs.readFileSync(new URL(`./fixtures/emacs-xs-${format}.json`, import.meta.url)));
    const [input, expected] = j.text.split('\n\n--\n');
    const rows = input.split('\n').filter(Boolean).map((l) => (l.startsWith('|-') ? 'hline' : l.slice(1, -1).split('|').map((c) => c.trim())));
    assert.equal(exportRows(rows, format), expected);
  });
}
