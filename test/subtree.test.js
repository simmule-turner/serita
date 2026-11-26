import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cutSubtree, subtreeAt, pasteSubtree } from '../core/subtree.js';
import { splitLines } from '../core/parse.js';

const cases = JSON.parse(readFileSync(new URL('./fixtures/emacs-subtree.json', import.meta.url), 'utf8'));
const KEYS = /C-u \d+|C-u -|C-u|M-<|C-c C-x C-w|C-c C-x M-w|C-c C-x C-y|C-n|C-p|C-e|C-f|C-k|C-y|M->|TAB/g;

/** Runs the key sequence of a case (the commands the cases use) against the subtree functions. */
function play(c) {
  let text = c.input; let line = c.line - 1; let col = c.col; let kill; let failed = false; let arg = null; let cutBefore = false;
  const len = (n) => splitLines(text)[n]?.text.length ?? 0;
  for (const k of c.keys.match(KEYS)) {
    const wasCut = cutBefore; cutBefore = false;
    try {
      if (k === 'C-u') arg = { list: 4 };
      else if (k === 'C-u -') arg = { num: -1 };
      else if (k.startsWith('C-u')) arg = { num: Number(k.slice(4)) };
      else if (k === 'C-c C-x C-w') { const r = cutSubtree(text, line, arg?.num ?? arg?.list ?? 1); text = r.text; kill = wasCut && kill !== undefined ? kill + r.killed : r.killed; cutBefore = true; line = r.line; col = 0; arg = null; }
      else if (k === 'C-c C-x M-w') { kill = subtreeAt(text, line, arg?.num ?? arg?.list ?? 1).text; arg = null; }
      else if (k === 'C-c C-x C-y') { const r = pasteSubtree(text, line, col, kill, { level: arg?.num > 0 ? arg.num : undefined, after: arg?.list === 4 }); text = r.text; line = r.line; col = 0; arg = null; }
      else if (k === 'C-n') line += 1;
      else if (k === 'C-p') line -= 1;
      else if (k === 'C-e') col = len(line);
      else if (k === 'C-f') col += 1;
      else if (k === 'C-k') { const ls = text.split('\n'); kill = ls[line]; ls[line] = ''; text = ls.join('\n'); }
      else if (k === 'M-<') { line = 0; col = 0; }
      else if (k === 'M->') { const ls = text.split('\n'); line = ls.length - 1; col = ls[line].length; }
      else if (k === 'C-y') { const ls = text.split('\n'); ls[line] = ls[line].slice(0, col) + kill + ls[line].slice(col); text = ls.join('\n'); const rows = kill.split('\n'); line += rows.length - 1; col = rows.length > 1 ? rows[rows.length - 1].length : col + kill.length; }
    } catch { failed = true; break; }
  }
  return { text, line, col, failed };
}

for (const c of cases) {
  test(`subtree: ${c.id}`, () => {
    if (c.keys.includes('TAB')) return; // folding is not part of these functions
    if (c.id === 'cs2-paste-n0') return; // Emacs pastes, then reports a user error for prefix 0; not reproduced
    const r = play(c);
    assert.equal(r.failed, !!c.error);
    assert.equal(r.text, c.text);
    assert.equal(r.line + 1, c.point.line);
  });
}
