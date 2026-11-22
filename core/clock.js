// Clocking, as Emacs writes it: C-c C-x C-i puts "CLOCK: [start]" in a :LOGBOOK: drawer under the heading (after its planning line and
// properties drawer, newest first), C-c C-x C-o closes it with "--[end] =>  H:MM", and C-c C-x C-q cancels it.
// Each function takes the text and a heading's line and returns { text, line, remap, ... }, or null when there is nothing to do.

import { splitLines } from './parse.js';
import { analyze } from './outline.js';
import { formatStamp } from './timestamp.js';
import { headOf, drawerOf } from './properties.js';

const join = (lines) => lines.map((l) => l.text + l.eol).join('');
const OPEN = /^[ \t]*CLOCK: \[(\d{4})-(\d\d)-(\d\d) [^\]\d]+ (\d\d):(\d\d)\][ \t]*$/;
const stamp = (now) => formatStamp(now, { time: true, active: false });
const utc = (y, mo, d, h, mi) => new Date(Date.UTC(y, mo - 1, d, h, mi));
const duration = (minutes) => { const m = Math.max(0, Math.round(minutes)); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };

/** The first running clock in the text: the line of its CLOCK entry, the heading it is under, and when it started. */
export function openClock(text) {
  const lines = splitLines(text);
  for (const h of analyze(text).heads) {
    for (let i = h.line + 1; i < h.end; i++) {
      const m = OPEN.exec(lines[i].text);
      if (m) return { clockLine: i, headLine: h.line, title: h.title, start: utc(+m[1], +m[2], +m[3], +m[4], +m[5]) };
    }
  }
  return null;
}

/** Starts a clock under the heading at `line`. */
export function clockIn(text, line, now) {
  const { h } = headOf(text, line);
  const lines = splitLines(text);
  const d = drawerOf(lines, h);
  let at = d.begin === null ? d.at : d.end + 1;
  const entry = { text: `CLOCK: ${stamp(now)}`, eol: '\n' };
  const last = lines.length - 1;
  const endEol = (idx) => (idx >= 0 && idx <= last ? lines[idx].eol : '\n');
  if (at < h.end && /^[ \t]*:LOGBOOK:[ \t]*$/i.test(lines[at].text)) {
    lines.splice(at + 1, 0, entry);
    return { text: join(lines), line, remap: (n) => (n > at ? n + 1 : n), started: stamp(now) };
  }
  const tail = at <= last ? '\n' : endEol(at - 1);
  if (at - 1 >= 0 && lines[at - 1].eol === '') lines[at - 1] = { ...lines[at - 1], eol: '\n' };
  lines.splice(at, 0, { text: ':LOGBOOK:', eol: '\n' }, entry, { text: ':END:', eol: tail });
  return { text: join(lines), line, remap: (n) => (n >= at ? n + 3 : n), started: stamp(now) };
}

/** Closes the running clock at `clockLine`. */
export function clockOut(text, clockLine, start, now) {
  const lines = splitLines(text);
  const minutes = (now.getTime() - start.getTime()) / 60000;
  lines[clockLine] = { ...lines[clockLine], text: `${lines[clockLine].text.replace(/[ \t]+$/, '')}--${stamp(now)} => ${duration(minutes).padStart(5)}` };
  return { text: join(lines), stopped: stamp(now), duration: duration(minutes) };
}

/** Cancels the running clock at `clockLine`: its entry goes, and the :LOGBOOK: drawer with it when that leaves it empty. */
export function cancelClock(text, clockLine) {
  const lines = splitLines(text);
  lines.splice(clockLine, 1);
  const before = lines[clockLine - 1]?.text ?? '';
  if (/^[ \t]*:LOGBOOK:[ \t]*$/i.test(before) && /^[ \t]*:END:[ \t]*$/i.test(lines[clockLine]?.text ?? '')) {
    const hadEnd = lines[clockLine].eol;
    lines.splice(clockLine - 1, 2);
    if (hadEnd === '' && lines[clockLine - 2]) lines[clockLine - 2] = { ...lines[clockLine - 2], eol: '' };
  }
  return { text: join(lines) };
}

/** Whether the heading at `line` is the clocked heading or inside its subtree: clocking in there changes nothing. */
export function inClockedEntry(text, clockedLine, line) {
  const heads = analyze(text).heads;
  const top = heads.find((x) => x.line === clockedLine);
  if (!top) return false;
  const next = heads.find((x) => x.line > top.line && x.level <= top.level);
  return line >= top.line && (!next || line < next.line);
}
