import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTemplates, place } from '../core/capture.js';
import { clockCapture, clockIn, clockOut, openClock } from '../core/clock.js';

// Emacs 30.1 (conformance v0.1.63, ci-*): the clock lines of a capture with :clock-in
const T = (opts, type = 'entry', text = '* TODO %?\n') => parseTemplates(`(setq org-capture-templates '(("k" "Desc" ${type} (file+headline "x.org" "List") "${text.replace(/\n/g, '\\n')}" ${opts})))`)[0];
const at = new Date(Date.UTC(2026, 10, 26, 19, 31));

test(':clock-in on an entry: a closed clock under the new heading', () => {
  const tpl = T(':clock-in t');
  const r = place('* List\n* Other\n', tpl, '* TODO new\n');
  assert.equal(r.clockLine, 1);
  assert.equal(clockCapture(r.text, r.clockLine, at, at, false).text, '* List\n** TODO new\n:LOGBOOK:\nCLOCK: [2026-11-26 Thu 19:31]--[2026-11-26 Thu 19:31] =>  0:00\n:END:\n* Other\n');
});

test(':clock-keep leaves the clock running', () => {
  const tpl = T(':clock-in t :clock-keep t');
  const r = place('* List\n* Other\n', tpl, '* TODO new\n');
  assert.equal(clockCapture(r.text, r.clockLine, at, at, true).text, '* List\n** TODO new\n:LOGBOOK:\nCLOCK: [2026-11-26 Thu 19:31]\n:END:\n* Other\n');
});

test(':clock-in on an item clocks the heading it went under', () => {
  const tpl = T(':clock-in t', 'item', '- %?');
  const r = place('* List\n* Other\n', tpl, '- new\n');
  assert.equal(clockCapture(r.text, r.clockLine, at, at, false).text, '* List\n:LOGBOOK:\nCLOCK: [2026-11-26 Thu 19:31]--[2026-11-26 Thu 19:31] =>  0:00\n:END:\n- new\n* Other\n');
});

test('a clock running elsewhere is closed when the capture clocks in, and resumed with :clock-resume', () => {
  let text = clockIn('* List\n* Other\n', 1, at).text;
  const c = openClock(text);
  text = clockOut(text, c.clockLine, c.start, at).text;
  const r = place(text, T(':clock-in t :clock-resume t'), '* TODO new\n');
  text = clockCapture(r.text, r.clockLine, at, at, false).text;
  text = clockIn(text, 5, at).text;
  assert.equal(text, '* List\n** TODO new\n:LOGBOOK:\nCLOCK: [2026-11-26 Thu 19:31]--[2026-11-26 Thu 19:31] =>  0:00\n:END:\n* Other\n:LOGBOOK:\nCLOCK: [2026-11-26 Thu 19:31]\nCLOCK: [2026-11-26 Thu 19:31]--[2026-11-26 Thu 19:31] =>  0:00\n:END:\n');
});
