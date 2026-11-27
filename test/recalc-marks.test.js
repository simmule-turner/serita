import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { recalculate, recalculateBuffer, iterateBuffer, autoRecalc } from '../core/tblcmd.js';
import * as table from '../core/table.js';

// Emacs 30.1 (conformance v0.1.68 and v0.1.69, mk-*, lm-*, nm-* and ff-*): which rows a recalculation reaches when the first column has marks.
const cases = JSON.parse(fs.readFileSync(new URL('./fixtures/emacs-recalc-marks.json', import.meta.url)));
for (const c of cases) {
  test(c.id, () => {
    const { input: t, line, col, keys } = c;
    let r;
    if (keys === 'C-c *') r = recalculate(t, line, 'row');
    else if (keys === 'C-u C-c *') r = recalculate(t, line, 'all');
    else if (keys === 'C-u C-u C-c *') r = recalculate(t, line, 'iterate');
    else if (c.id === 'mk-buffer') r = recalculateBuffer(t);
    else if (c.id === 'mk-iterate') r = iterateBuffer(t);
    else if (/-tblfm$/.test(c.id) && keys === 'C-c C-c') r = recalculate(t, line, 'line');
    else if (c.id === 'mk-ccc-tblfm') r = recalculate(t, line, 'line');
    else if (/^nm-ccc$/.test(c.id)) r = { text: table.align(t, line, col).text };
    else {
      const a = autoRecalc(t, line);
      r = { text: keys === 'TAB' ? table.nextField(a.text, line, col).text : keys === 'RET' ? table.nextRow(a.text, line, col).text : table.align(a.text, line, col).text, message: a.message };
    }
    assert.equal(r.text.trim(), c.expect.replace(/\n--[\s\S]*$/, '').trim(), c.id);
  });
}
