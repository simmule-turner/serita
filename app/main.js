// Screen wiring: toolbar, tabs, editor, mode line, message line, Find, and the bottom panels.
// What happens to buffers and files lives in ui/session.js; this file only draws and listens.

import { createBrowserInterface } from './interface/browser.js';
import { createSession } from './ui/session.js';
import { createConfig } from './ui/config.js';
import { createProviders } from './ui/providers.js';
import { search } from './ui/find.js';
import { createRecent } from './ui/recent.js';
import { children, parentDir } from './storage/browse.js';
import { formatName, parseName } from '../core/names.js';
import { formatSize } from '../core/bytes.js';
import { VERSION } from './version.js';
import { h, kept } from './ui/dom.js';
import { analyze, contents, cycle, cycleGlobal, diff, ellipsisLines, hiddenLines, reveal, startupFolds, startupIndent } from '../core/outline.js';
import { backwardChar, backwardWord, forwardChar, forwardWord, lineEnd as endOfLine, lineStart as startOfLine, moveVertical } from '../core/motion.js';
import { DEFAULT_TAGS_COLUMN, changeLevel, cycleTodo, todoTarget, indentItem, insertHeadingAfter, insertHeadingHere, moveItem, moveSubtree, setPriority, setTags, setTitle, stepPriority, toggleCheckbox, updateCookieAt } from '../core/outline-edit.js';
import { parseStringList, formatStringList } from '../core/lisp-list.js';
import { clockIn, clockOut, cancelClock, openClock, inClockedEntry } from '../core/clock.js';
import { parseTemplates, promptsOf, expand, place } from '../core/capture.js';
import { bodyOf, setBody } from '../core/body.js';
import { MONTH_NAMES, monthGrid, stepMonth, stepTime } from '../core/calendar.js';
import { archiveSubtree, ARCHIVE_CONTEXT, checkTarget, newChild, archiveToSibling, listTargets, parseRefileSettings, RefileCache, refile, refileMessage, toggleArchiveTag } from '../core/refile.js';
import { isEffort } from '../core/effort.js';
import { deleteProperty, propertiesOf, propertyNames, setProperty } from '../core/properties.js';
import { DEFAULT_FORMATS, parseAgendaSettings, phoneCells, phoneColumns } from '../core/prefix.js';
import { NONE as NO_ARG, argLabel, argValue, pressDigit, pressU } from '../core/universal.js';
import { agenda, searchView, tagsView, todoList } from '../core/agenda.js';
import { filterActive, filterLabel, noFilter, parseEffort, parseSigned } from '../core/agenda-filter.js';
import { holidayList } from '../core/holidays.js';
import { startReplace } from '../core/replace.js';
import { sparseTree } from '../core/sparse.js';
import { completeRepeat, formatStamp, insertStamp, parseDate, setPlanning, shiftStamp, stampAt } from '../core/timestamp.js';
import { createMinibuffer } from './ui/minibuffer.js';
import { duplicateLine, indentLine, killLine, killWholeLine, lineInfo, lineStart, moveLine } from '../core/lines.js';
import { createKillRing } from '../core/killring.js';
import * as table from '../core/table.js';
import * as tblcmd from '../core/tblcmd.js';
import { lineAt, project, toFull, toShown, touchedFold } from '../core/projection.js';
import { renderOutline } from './ui/outline-view.js';
import { TEXT_KEYS, chordOf, createKeymap } from './ui/keys.js';
import { createHistory } from './ui/history.js';
import { createKeyRow } from './ui/keyrow.js';
import { followViewport } from './ui/viewport.js';
import { askVersion, watchUpdates } from './ui/update.js';
import { exportSettings, importSettings, inspectSettingsFile, settingsFileName, SettingsFileError } from '../core/settings-file.js';

const $ = (id) => document.getElementById(id);

/** Puts the given content in a panel, leaving out anything empty. */
/** Set by the x on a sheet: the sheets that would open next to continue the chain do not. Cleared by the next tap or key. */
let dismissed = false;
for (const ev of ['pointerdown', 'keydown']) document.addEventListener(ev, () => { dismissed = false; }, true);

function put(sheet, ...kids) {
  let all = kept(kids);
  const head = all[0]?.tagName === 'H2' ? h('div', { class: 'head' }, all[0], h('button', { class: 'dismiss', 'aria-label': 'Dismiss', onclick: () => sheet.dismiss?.() }, '×')) : null;
  if (head) all = all.slice(1);
  // The buttons at the bottom stay put; only what is above them scrolls. A row holding just Cancel is left out: the x says the same.
  let row = all[all.length - 1]?.classList?.contains('row') ? all.pop() : null;
  if (row && row.children.length === 1 && row.textContent === 'Cancel' && head) row = null;
  sheet.replaceChildren(...[head, h('div', { class: 'body' }, ...all), row].filter(Boolean));
  for (const b of sheet.querySelectorAll('button')) if (b.textContent === 'Cancel') b.classList.add('cancel');
}

const config = createConfig(localStorage);
const { providers, rebuild } = await createProviders({ config, indexedDB, env: window, isOnline: () => navigator.onLine });
const app = createBrowserInterface({ providers, env: window });
const session = createSession({ app });
const recent = createRecent(localStorage);

const editor = $('editor');
let shownId = null;
const places = createHistory(); // where Back returns to
let cur = null;        // what the views show now: { id, a (the outline), proj (the Text view's projection) }
let pendingSel = null; // where the cursor goes after the next render, in the real text

const setting = (k) => config.settings()[k];
const viewMode = () => (setting('view.mode') === 'outline' ? 'outline' : 'text');
const emacsKeys = () => setting('view.emacsKeys') === 'true';
const hideStars = () => setting('org-hide-leading-stars') === 't';
const wrapCells = () => setting('org-table-widget-wrap-columns') === 't';
/** C-c } and C-c { are on for this session only, as Emacs's are for the buffer. */
let tableNumbers = false;
let formulaDebug = false;
const zebraRows = () => setting('org-table-widget-zebra-stripe') === 't';
/** The share of the screen width a table may use, from 0.3 to 1; 1 unless set. */
const widthFraction = () => { const f = Number(setting('org-table-widget-max-width-fraction')); return f >= 0.3 && f <= 1 ? f : 1; };
const indentSetting = () => setting('org-startup-indented') === 't';
const indentOverride = new Map(); // buffer id to the person's toggle of org-indent-mode, kept until the app closes
/** org-indent-mode for a buffer: the person's toggle, else what #+STARTUP says, else org-startup-indented. */
const indentOn = (b) => indentOverride.get(b.id) ?? startupIndent(b.text) ?? indentSetting();
const setView = (mode) => config.update({ settings: { 'view.mode': mode } });
const toolRowOn = (mode) => (mode === 'text' ? setting('view.toolRowText') !== 'false' : setting('view.toolRowOutline') === 'true');
const THEMES = ['system', 'light', 'dark'];
const theme = () => (THEMES.includes(setting('view.theme')) ? setting('view.theme') : 'system');
const FONTS = { monospace: 'ui-monospace, Menlo, Consolas, monospace', 'sans-serif': 'system-ui, sans-serif', serif: 'ui-serif, Georgia, serif', system: 'system-ui, sans-serif' };
const fontChoice = () => setting('view.font') ?? 'monospace';
const fontFamily = () => FONTS[fontChoice()] ?? `"${fontChoice().replace(/["\\]/g, '')}", monospace`;
const paragraphSpacing = () => Math.min(32, Math.max(0, Number(setting('view.paragraphSpacing') ?? 10) || 0));
const tagsColumn = () => { const n = Number(setting('org.tagsColumn')); return Number.isInteger(n) && setting('org.tagsColumn') !== undefined && setting('org.tagsColumn') !== '' ? n : DEFAULT_TAGS_COLUMN; };
const keyLogOn = () => setting('view.keyLog') === 'true';
const beepOn = () => setting('view.beep') !== 'false';
/** org-log-into-drawer: the drawer's name, or null for none. org-log-repeat: on (time) unless set off. */
const logDrawer = () => setting('org-log-into-drawer') || null;
const logRepeatMode = () => (setting('org-log-repeat') === 'nil' ? 'off' : setting('org-log-repeat') === 'note' ? 'note' : 'time');
const logRepeatOn = () => logRepeatMode() !== 'off';
const restoreOn = () => setting('session.restore') !== 'false';
const lineNumbers = () => setting('view.lineNumbers') === 'true';
const wrapOn = () => setting('view.wrap') !== 'false';
const TEXT_SIZES = { min: 12, max: 32, normal: 18 };
const fontSize = () => Math.min(TEXT_SIZES.max, Math.max(TEXT_SIZES.min, Number(setting('view.fontSize')) || TEXT_SIZES.normal));

function message(text, isError = false) {
  const el = $('message');
  el.textContent = text;
  el.classList.toggle('error', isError);
}
// The short tone Emacs gives for an error, a quit or an undefined key. Browsers play sound only after a tap or key press, which has always happened here.
let audio = null;
function beep() {
  if (!beepOn()) return;
  try {
    audio ??= new AudioContext();
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.frequency.value = 440;
    gain.gain.value = 0.15;
    osc.connect(gain).connect(audio.destination);
    osc.start();
    osc.stop(audio.currentTime + 0.12);
  } catch (e) { console.error(e); }
}
const failure = (e) => message(e?.message ?? String(e), true);

// ---- Panels ---------------------------------------------------------------------------

/**
 * A panel that rises from the bottom over a dimmed screen. `build(sheet, close)` fills it.
 * Resolves with whatever `close` is given; a tap outside, or Escape, closes it with undefined.
 */
function panel(build) {
  return new Promise((resolve) => {
    if (dismissed) { resolve(undefined); return; }
    const scrim = h('div', { class: 'scrim' });
    const sheet = h('div', { class: 'sheet', role: 'dialog' });
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(undefined); } };
    function close(value) {
      scrim.remove(); sheet.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(value);
    }
    sheet.dismiss = () => { dismissed = true; close(undefined); };
    scrim.addEventListener('click', () => close(undefined));
    // Pressing a button in a panel leaves focus where it was, so an open keyboard and the cursor stay as they are.
    const keepFocus = (e) => { if (e.target.closest('button')) e.preventDefault(); };
    sheet.addEventListener('pointerdown', keepFocus);
    sheet.addEventListener('mousedown', keepFocus);
    document.addEventListener('keydown', onKey, true);
    $('layer').append(scrim, sheet);
    build(sheet, close);
  });
}

/** A list of choices. Items are { label, value, meta? }. */
function choose(title, items, { cancel = true, subtitle = null } = {}) {
  return panel((sheet, close) => {
    put(sheet, 
      title ? h('h2', {}, title) : null,
      subtitle ? h('p', {}, subtitle) : null,
      h('div', { class: 'list' }, items.map((it) => (it.group ? h('div', { class: 'group' }, it.group) : h('button', { class: `item${it.dim ? ' dim' : ''}`, onclick: () => close(it.value) },
        h('span', {}, it.label), it.meta ? h('span', { class: 'meta' }, it.meta) : null)))),
      cancel ? h('div', { class: 'row' }, h('button', { onclick: () => close(undefined) }, 'Cancel')) : null,
    );
  });
}

/** A question with buttons. Buttons are { label, value, primary? }; the last one given is not special. */
function ask(title, text, buttons) {
  return panel((sheet, close) => {
    put(sheet, h('h2', {}, title), text ? h('p', {}, text) : null,
      h('div', { class: 'row' }, buttons.map((b) => h('button', { class: b.primary ? 'primary' : '', onclick: () => close(b.value) }, b.label))));
  });
}

// ---- Tabs, editor, mode line -------------------------------------------------------------

const currentBuffer = () => session.state().buffers.find((x) => x.id === shownId);

function cursorPosition() {
  const b = currentBuffer();
  if (!cur || !b) return { line: 1, col: 0 };
  const before = b.text.slice(0, toFull(cur.proj, editor.selectionStart));
  const line = before.split('\n').length;
  return { line, col: before.length - (before.lastIndexOf('\n') + 1) };
}

const STORAGE_LABEL = { local: 'App storage', device: 'Device', github: 'GitHub', webdav: 'WebDAV' };

/** Where the window is in the text, as Emacs's mode line says it: All, Top, Bot or a percentage. */
function scrollPosition() {
  const max = editor.scrollHeight - editor.clientHeight;
  if (max <= 0) return 'All';
  if (editor.scrollTop <= 0) return 'Top';
  if (editor.scrollTop >= max - 1) return 'Bot';
  return `${Math.round((100 * editor.scrollTop) / max)}%`;
}

function renderModeLine() {
  const s = session.state();
  const b = s.buffers.find((x) => x.id === s.current);
  if (!b) { $('modeline').textContent = ''; return; }
  const { line, col } = cursorPosition();
  const where = b.name === null ? b.title : `${parseName(b.name).path} (${STORAGE_LABEL[parseName(b.name).provider]})`;
  const place = viewMode() === 'outline' ? 'Outline' : `${scrollPosition()}  L${line} C${col}`;
  $('modeline').textContent = `${b.dirty ? '**' : '--'}  ${where}  ${place}${pendingCount > 0 ? `  ${pendingCount} to send` : ''}`;
}

function render() {
  const s = session.state();
  $('tabs').replaceChildren(...s.buffers.map((b) => h('span', { class: `tab${b.id === s.current ? ' current' : ''}` },
    h('button', { class: 'title', onclick: () => { if (b.id !== shownId) leaveHere(); session.select(b.id); checkChanged(b.id); }, title: b.name ?? b.title }, b.title + (b.dirty ? ' *' : '')),
    h('button', { 'aria-label': `Close ${b.title}`, onclick: () => closeBuffer(b.id) }, '×'))));
  const shown = s.buffers.find((x) => x.id === s.current);
  const mode = viewMode();
  const before = cur && cur.id === s.current && editor.value === cur.proj.value
    ? { start: toFull(cur.proj, editor.selectionStart), end: toFull(cur.proj, editor.selectionEnd) } : null;
  shownId = s.current;
  document.documentElement.style.setProperty('--fs', `${fontSize()}px`);
  document.documentElement.style.setProperty('--ff', fontFamily());
  document.documentElement.style.setProperty('--ps', `${paragraphSpacing()}px`);
  document.documentElement.dataset.theme = theme() === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme();
  $('main').classList.toggle('nums', lineNumbers());
  $('main').classList.toggle('nowrap', !wrapOn());
  editor.wrap = wrapOn() ? 'soft' : 'off';
  editor.hidden = mode !== 'text';
  $('outline').hidden = mode !== 'outline';
  $('keyrow').hidden = !(mode === 'text' && emacsKeys() && shown);
  showBack();
  // With the key row shown, tapping the text does not raise the on-screen keyboard; the keyboard button does.
  editor.inputMode = $('keyrow').hidden || softKeyboard ? 'text' : 'none';
  editor.disabled = !shown;
  if (shown) {
    const a = analyze(shown.text);
    const proj = project(shown.text, hiddenLines(a.foldables, shown.folds), ellipsisLines(a.foldables, shown.folds), { hideStars: hideStars(), indent: indentOn(shown) });
    cur = { id: shown.id, a, proj };
    if (editor.value !== proj.value) {
      editor.value = proj.value;
      const sel = pendingSel !== null ? { start: pendingSel, end: pendingSel } : before;
      if (sel) editor.setSelectionRange(toShown(proj, sel.start), toShown(proj, sel.end));
    }
    pendingSel = null;
    if (mode === 'outline') renderOutline($('outline'), { text: shown.text, folds: shown.folds, hideStars: false, indent: false, tables: { wrap: wrapCells(), zebra: zebraRows(), fraction: widthFraction(), numbers: tableNumbers }, on: outlineOn });
    if (!$('keyrow').hidden) keyRow.layout();
  } else {
    cur = null;
    editor.value = '';
    $('outline').replaceChildren();
  }
  renderTools(mode);
  paintOverlay();
  renderModeLine();
}

// An edit of the shown text becomes an edit of the real text; a change touching a "..." opens that fold first.
editor.addEventListener('input', () => {
  hit = null;
  lastCycle = null;
  const b = currentBuffer();
  if (!b || !cur) return;
  const d = diff(cur.proj.value, editor.value);
  const open = touchedFold(cur.proj, d.from, d.to, d.insert);
  const from = toFull(cur.proj, d.from);
  pendingSel = from + d.insert.length;
  session.setText(b.id, b.text.slice(0, from) + d.insert + b.text.slice(toFull(cur.proj, d.to)));
  if (open !== null) { const folds = { ...currentBuffer().folds }; delete folds[open]; session.setFolds(b.id, folds); }
});
editor.addEventListener('click', () => { lastCycle = null; });
editor.addEventListener('scroll', () => { $('hl').scrollTop = editor.scrollTop; $('hl').scrollLeft = editor.scrollLeft; });
window.addEventListener('resize', () => paintOverlay());
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => render());

// The layer behind the text: line numbers and the search match. It lays out its lines exactly as the editor does.
let hit = null;
let marks = []; // what a sparse tree matched ({ line, from, to } in the real text), shown in the highlight color until C-c C-c
function paintOverlay() {
  const hl = $('hl');
  if (!cur || editor.hidden || (!hit && marks.length === 0 && !lineNumbers())) { hl.replaceChildren(); return; }
  hl.style.width = `${editor.clientWidth}px`;
  let at = 0;
  let number = 0;
  hl.replaceChildren(...editor.value.split('\n').map((text) => {
    const start = at;
    at += text.length + 1;
    number = start === editor.value.length && number > 0 ? number + 1 : lineAt(cur.proj, start) + 1;
    const kids = [text];
    if (hit && hit.start < at && hit.end > start) {
      const a = Math.max(hit.start, start) - start;
      const z = Math.min(hit.end, at - 1) - start;
      kids.splice(0, 1, text.slice(0, a), h('mark', {}, text.slice(a, z)), text.slice(z));
    }
    if (!hit && marks.length) {
      const real = lineAt(cur.proj, start);
      const here = marks.filter((x) => x.line === real && x.to <= text.length).sort((a, b) => a.from - b.from);
      if (here.length) {
        const out = [];
        let pos = 0;
        for (const x of here) { if (x.from < pos) continue; out.push(text.slice(pos, x.from), h('mark', {}, text.slice(x.from, x.to))); pos = x.to; }
        kids.splice(0, 1, ...out, text.slice(pos));
      }
    }
    return h('div', { class: 'hl-line', ...(lineNumbers() ? { 'data-n': String(number) } : {}) }, ...kids);
  }));
  hl.scrollTop = editor.scrollTop;
  hl.scrollLeft = editor.scrollLeft;
}
for (const ev of ['keyup', 'click', 'select', 'scroll']) editor.addEventListener(ev, renderModeLine);
session.subscribe(render);
config.onChange(() => render());

// ---- Saving ---------------------------------------------------------------------------------

async function handleSave(r, id) {
  if (r.status === 'saved') {
    const b = session.state().buffers.find((x) => x.id === id);
    recent.add(b.name);
    updatePending().catch(failure);
    message(navigator.onLine ? `Wrote ${b.name}` : `Wrote ${b.name} (offline; it will be sent when you are back online)`);
    return true;
  }
  if (r.status === 'needs-name') return saveAs(id);
  if (r.status === 'conflict') return conflict(r.conflict);
  return false;
}

async function saveBuffer(id) {
  try { return await handleSave(await session.save(id), id); } catch (e) { failure(e); return false; }
}

async function saveAs(id) {
  const b = session.state().buffers.find((x) => x.id === id);
  const picked = await browse({ mode: 'saveas', suggested: b.name ? parseName(b.name).path.replace(/^.*\//, '') : 'untitled.org', current: b.name });
  if (!picked) return false;
  try {
    let r = await session.saveAs(id, picked);
    if (r.status === 'exists') {
      // write-file asks before replacing another file
      const file = picked.replace(/^.*[:/]/, '');
      if (!(await ask('Overwrite', `File ‘${file}’ exists; overwrite?`, [{ label: 'No', value: false }, { label: 'Yes', value: true, primary: true }]))) { message('Canceled'); return false; }
      r = await session.saveAs(id, picked, { overwrite: true });
    }
    return await handleSave(r, id);
  } catch (e) { failure(e); return false; }
}

async function closeBuffer(id) {
  if (session.close(id)) return;
  const b = session.state().buffers.find((x) => x.id === id);
  const answer = await ask(`Save ${b.title}?`, 'It has changes that are not saved.', [
    { label: 'Save', value: 'save', primary: true }, { label: 'Discard', value: 'discard' }, { label: 'Cancel', value: undefined }]);
  if (answer === 'discard') session.close(id, { force: true });
  else if (answer === 'save' && await saveBuffer(id)) session.close(id, { force: true });
}

async function saveSomeBuffers() {
  const ids = session.unsavedIds();
  if (ids.length === 0) { message('(No files need saving)'); return; }
  let all = false;
  for (const id of ids) {
    if (!all) {
      const b = session.state().buffers.find((x) => x.id === id);
      const answer = await ask(`Save ${b.title}?`, null, [
        { label: 'Yes', value: 'yes', primary: true }, { label: 'No', value: 'no' }, { label: 'Save all', value: 'all' }, { label: 'Cancel', value: undefined }]);
      if (answer === undefined) return;
      if (answer === 'no') continue;
      all = answer === 'all';
    }
    if (!await saveBuffer(id)) return;
  }
}

// ---- Conflict ------------------------------------------------------------------------------------

/**
 * Asks how to settle a clash between your copy and the server's.
 * Returns 'mine', 'theirs', { merged: text }, or undefined to decide later.
 * @param {{ name: string, theirsGone: boolean, mineGone: boolean, offline: boolean, merge: () => any }} o
 */
function askClash({ name, theirsGone, mineGone, offline, merge: mergeFn }) {
  return panel((sheet, close) => {
    const first = () => {
      put(sheet,
        h('h2', {}, `${name.replace(/^.*[/:]/, '')} changed on the server`),
        h('p', {}, theirsGone ? 'The file was deleted on the server since you opened it.'
          : mineGone ? 'You deleted this file while offline, but it changed on the server.'
            : offline ? 'Someone saved a newer copy while you were offline.' : 'Someone saved a newer copy since you opened it.'),
        h('div', { class: 'row' },
          theirsGone || mineGone ? null : h('button', { onclick: () => merge() }, 'Merge'),
          mineGone ? null : h('button', { onclick: () => close('mine') }, 'Keep mine'),
          theirsGone ? null : h('button', { onclick: () => close('theirs') }, 'Use theirs'),
          h('button', { onclick: () => close(undefined) }, 'Cancel')));
    };
    const merge = () => {
      const m = mergeFn();
      if (m.clean) { close({ merged: m.text }); return; }
      const picks = [];
      const rows = m.segments.filter((x) => x.type === 'conflict').map((x, i) => {
        picks[i] = 'mine';
        const sel = h('select', { onchange: () => { picks[i] = sel.value; } },
          h('option', { value: 'mine' }, 'Keep mine'), h('option', { value: 'theirs' }, 'Use theirs'), h('option', { value: 'both' }, 'Keep both'));
        return h('div', { class: 'list' }, h('label', {}, `Conflict ${i + 1}: mine`), h('pre', {}, x.mine.join('')),
          h('label', {}, 'theirs'), h('pre', {}, x.theirs.join('')), sel);
      });
      put(sheet, h('h2', {}, 'Settle the clashes'), ...rows,
        h('div', { class: 'row' }, h('button', { onclick: () => first() }, 'Back'),
          h('button', { class: 'primary', onclick: () => close({ merged: session.resolve(m.segments, (i) => picks[i]) }) }, 'Apply')));
    };
    first();
  });
}

async function conflict(c) {
  const choice = await askClash({ name: c.name, theirsGone: c.theirs === null, mineGone: false, offline: false, merge: () => session.merge(c) });
  if (choice === undefined) return false;
  if (choice === 'mine') { session.settle(c, c.mine); return saveBuffer(c.id); }
  if (choice === 'theirs') { session.settle(c, c.theirs); message('Loaded the server copy'); return false; }
  session.settle(c, choice.merged);
  message('Merged. Save to send it.');
  return false;
}

// ---- Saves that were queued offline and clashed ---------------------------------------------------

let pendingCount = 0;

async function updatePending() {
  let n = 0;
  for (const p of ['github', 'webdav']) if (providers[p]) n += (await providers[p].pending()).length;
  pendingCount = n;
  renderModeLine();
}

async function settleQueued(p, clash) {
  const name = `${p}:${clash.path}`;
  const choice = await askClash({
    name, theirsGone: clash.theirs === null, mineGone: clash.mine === null, offline: true,
    merge: () => session.merge({ base: clash.base ?? '', mine: clash.mine, theirs: clash.theirs }),
  });
  if (choice === undefined) return false;
  if (choice === 'theirs') await providers[p].discard(clash.path);
  else {
    const r = await providers[p].resolve(clash.path, choice === 'mine' ? clash.mine : choice.merged, clash.theirsVersion);
    if (!r.ok) { message(`${name} changed on the server again; try once more`, true); return false; }
  }
  await session.refresh(name);
  message(`Settled ${name}`);
  return true;
}

async function clashList(found) {
  let left = found;
  while (left.length > 0) {
    const pick = await panel((sheet, close) => {
      put(sheet, h('h2', {}, 'Saves that could not be sent'),
        h('p', {}, 'These files changed on the server while you were offline. Choose one to settle it.'),
        h('div', { class: 'list' }, left.map((x) => h('button', { class: 'item', onclick: () => close(x) },
          h('span', {}, recentLabel(`${x.p}:${x.clash.path}`)), h('span', { class: 'meta' }, x.clash.theirs === null ? 'deleted' : 'changed')))),
        h('div', { class: 'row' }, h('button', { onclick: () => close(undefined) }, 'Decide later')));
    });
    if (!pick) return;
    if (await settleQueued(pick.p, pick.clash)) left = left.filter((x) => x !== pick);
  }
}

// ---- File browser (Open and Save as) -------------------------------------------------------------

function providerLabel(p) { return { local: 'App storage', device: 'Device files', github: 'GitHub', webdav: 'WebDAV' }[p]; }

/** @returns {Promise<string|undefined>} the chosen storage name */
function browse({ mode, suggested = '', current = null }) {
  const wanted = current ? parseName(current).provider : 'local';
  const usable = wanted in providers && !(mode === 'open' && wanted === 'device');
  let provider = usable ? wanted : 'local';
  let dir = current && usable ? parseName(current).path.replace(/[^/]*$/, '') : '';
  return panel((sheet, close) => {
    let listing = { folders: [], files: [] };
    let loadError = null;
    const nameInput = mode === 'saveas' ? h('input', { value: suggested, 'aria-label': 'File name', oninput: () => update() }) : null;
    const ok = h('button', { class: 'primary' });
    const exists = h('p', { class: 'tag', hidden: '' });
    // Typing only updates the notice and the button; drawing the sheet again would take the keyboard away.
    function update() {
      const typed = nameInput?.value.trim() ?? '';
      const there = listing.files.find((f) => f.name === typed);
      exists.hidden = !there;
      exists.textContent = there ? `${there.name} exists${there.size === null ? '' : ` (${formatSize(there.size)})`}. Saving replaces it.` : '';
      if (mode === 'saveas') ok.textContent = there ? 'Replace' : 'Save';
    }

    async function load() {
      if (provider === 'device') { listing = { folders: [], files: [] }; loadError = null; draw(); return; }
      try {
        const all = await app.storage.entries(`${provider}:${dir}`, { shallow: true });
        listing = children(all.map((e) => ({ path: parseName(e.name).path, size: e.size, folder: e.folder })), dir);
        loadError = null;
      } catch (e) { listing = { folders: [], files: [] }; loadError = e.message; }
      draw();
    }
    async function change() {
      const items = ['local', 'device', 'github', 'webdav'].map((p) => ({
        value: p, label: providerLabel(p), meta: p === 'device' ? 'picker' : p in providers ? '' : 'set up' }));
      const p = await choose('Storage', items);
      if (!p) return;
      if (p === 'device' && mode === 'open') {
        try { const path = await providers.device.pickOpen(); if (path) close(`device:${path}`); } catch (e) { loadError = e.message; draw(); }
        return;
      }
      if (!(p in providers)) { await setup(p); if (!(p in providers)) return; }
      provider = p; dir = ''; load();
    }
    function draw() {
      put(sheet, 
        h('h2', {}, mode === 'open' ? 'Open' : 'Save as'),
        h('div', { class: 'list' }, h('button', { class: 'item', onclick: change }, h('span', {}, `Storage: ${providerLabel(provider)}`), h('span', { class: 'meta' }, 'Change'))),
        provider === 'device' ? h('p', {}, 'A file dialog opens when you tap Save.') : h('div', { class: 'path' }, `${provider}:${dir}`),
        loadError ? h('p', { class: 'tag' }, loadError) : null,
        h('div', { class: 'list' },
          dir ? h('button', { class: 'item', onclick: () => { dir = parentDir(dir); load(); } }, h('span', {}, 'Up'), h('span', { class: 'meta' }, '..')) : null,
          listing.folders.map((f) => h('button', { class: 'item', onclick: () => { dir += `${f}/`; load(); } }, h('span', {}, `${f}/`), h('span', { class: 'meta' }, 'folder'))),
          listing.files.map((f) => h('button', { class: 'item', onclick: () => {
            if (mode === 'open') close(`${provider}:${dir}${f.name}`);
            else { nameInput.value = f.name; draw(); }
          } }, h('span', {}, f.name), h('span', { class: 'meta' }, formatSize(f.size))))),
        nameInput,
        exists,
        h('div', { class: 'row' }, h('button', { onclick: () => close(undefined) }, 'Cancel'),
          mode === 'saveas' ? Object.assign(ok, { onclick: async () => {
            const typed = nameInput.value.trim();
            if (!typed) return;
            if (provider !== 'device') { close(`${provider}:${dir}${typed}`); return; }
            try { const path = await providers.device.pickSave(typed); if (path) close(`device:${path}`); } catch (e) { loadError = e.message; draw(); }
          } }) : null));
      update();
    }
    load();
  });
}

// ---- Sample documents -----------------------------------------------------------------------------

const SAMPLES = [
  ['weekly-review', 'Weekly review', 'Agenda for a week'], ['outline', 'Outline and folding', 'TAB, S-TAB'], ['dates', 'Dates and repeaters', 'Schedule, deadline'],
  ['clocking', 'Clocking and effort', 'Clock in, out'], ['project', 'A project with clocking', 'Tasks and time'], ['capture', 'Capture', 'Templates and a target'],
  ['refile-archive', 'Refile and archive', 'Move and archive'], ['search-replace', 'Find and replace', 'C-s, M-%'],
  ['diary', 'Diary entries', 'Dates and sexps'], ['contacts', 'Contacts and birthdays', 'BIRTHDAY property'], ['agenda-birthdays', 'Agenda with birthdays', 'org-contacts-anniversaries'], ['tables', 'Tables', 'Align, sort, edit'], ['config', 'Settings example', 'Every setting'],
];

/** The list of examples. Returns the chosen file, or undefined. */
function askSample() {
  return panel((sheet, close) => {
    put(sheet, h('h2', {}, 'Sample documents'),
      h('p', {}, 'Open one to try Serita. It opens as a new tab and is saved only if you save it.'),
      h('div', { class: 'list' }, SAMPLES.map(([file, label, hint]) => h('button', { class: 'item', onclick: () => close(file) }, h('span', {}, label), h('span', { class: 'meta' }, `${hint} ›`)))),
      h('div', { class: 'row' }, h('button', { onclick: () => close(undefined) }, 'Start empty')));
  });
}

/** Opens an example as a new, unsaved tab. */
async function openSample(file) {
  try {
    const r = await fetch(`examples/${file}.org`);
    if (!r.ok) throw new Error(`Could not load ${file}.org`);
    session.newScratch(`${file}.org`, await r.text());
  } catch (e) { failure(e); }
}

async function openSamples() {
  const file = await askSample();
  if (file) await openSample(file);
}

// ---- Find ------------------------------------------------------------------------------------------

let finding = null;
let lastSearch = '';
const mini = createMinibuffer({ root: $('findbar'), list: $('completions'), bell: () => beep(), restoreFocus: () => { if (viewMode() === 'text') editor.focus({ preventScroll: true }); } });

/** Query replace. Text view: Emacs's own keys (y SPC n DEL ! . q RET ^), with a button for each on a touch screen. */
async function queryReplace(regexp = false) {
  if (finding || shownId === null) return;
  if (viewMode() === 'outline') setView('text');
  const lead = regexp ? 'Query replace regexp' : 'Query replace';
  const from = await mini.ask({ prompt: `${lead}:`, historyKey: 'replace-from' });
  if (from === undefined || from === '') return;
  const to = await mini.ask({ prompt: `${lead} ${from} with:`, historyKey: 'replace-to' });
  if (to === undefined) return;
  let s;
  try { s = startReplace(currentBuffer().text, { from, to, regexp, at: cursorOffset() }); } catch (e) { failure(e); return; }
  const b0 = currentBuffer();
  const finish = () => {
    mb.close();
    if (s.count === 0 && !s.match) message(`No match for ${from}`);
    else message(`Replaced ${s.count} occurrence${s.count === 1 ? '' : 's'}`);
    hit = null;
    paintOverlay();
  };
  const sync = () => {
    const b = currentBuffer();
    if (b.text !== s.text) session.apply(b.id, { text: s.text });
    if (s.done) { finish(); placeOffset(s.point); return; }
    const opened = reveal(cur.a.foldables, currentBuffer().folds, s.text.slice(0, s.match.start).split('\n').length - 1);
    if (JSON.stringify(opened) !== JSON.stringify(currentBuffer().folds)) session.setFolds(b.id, opened);
    const start = toShown(cur.proj, s.match.start);
    editor.setSelectionRange(start, start);
    showCaret(start);
    hit = { start, end: start + (s.match.end - s.match.start) };
    paintOverlay();
    renderModeLine();
  };
  const press = (key) => { s.answer(key); sync(); };
  const keys = [['y', 'y'], ['n', 'n'], ['!', '!'], ['.', '.'], ['^', '^'], ['q', 'q']];
  const mb = mini.open({
    stack: true,
    prompt: `Query replacing ${from} with ${to}: (? for help)`,
    buttons: keys.map(([label, key]) => ({ label, aria: `Answer ${label}`, onclick: () => press(key) })),
    onKey(e) {
      e.preventDefault();
      const key = e.key === 'Delete' ? 'Backspace' : e.key;
      if (e.key === 'Escape' || (e.ctrlKey && e.key === 'g')) { e.stopPropagation(); s.answer('q'); sync(); return true; }
      if ([' ', 'y', 'n', 'Backspace', '!', '.', 'q', 'Enter', '^'].includes(key)) press(key);
      return true;
    },
  });
  mb.input.readOnly = true;
  if (s.done) { finish(); return; }
  sync();
}

/** A sparse tree (C-c / r, t, T): everything folds to the top level except the matches and the headings above them. */
async function sparse(kind) {
  if (finding || shownId === null) return;
  let arg = '';
  if (kind !== 'todo') {
    const ask = {
      regexp: { prompt: 'Regexp:', title: 'Show matching lines', help: 'Shows the lines that match an Emacs regexp, and the headings above them.' },
      match: { prompt: 'Match:', title: 'Show matching headings', help: 'Tags such as work+urgent-home or work|home, then / and TODO keywords, or Effort="5h" and LEVEL=2.' },
      'todo-keyword': { prompt: 'Keyword (or KWD1|KWD2|...):', title: 'Show entries with a TODO keyword', help: 'One or more keywords, separated by |.' },
    }[kind];
    arg = await askText({ ...ask, ok: 'Show' });
    if (arg === undefined || arg === '') return;
  }
  const b = currentBuffer();
  let r;
  try { r = sparseTree(b.text, cur.a, { kind, arg }); } catch (e) { failure(e); return; }
  const at = cursorOffset();
  session.setFolds(b.id, r.folds);
  marks = r.ranges;
  hit = null;
  if (viewMode() === 'text') placeOffset(at); // the cursor stays on its text; if that is folded away it lands on the heading above
  paintOverlay();
  if (kind === 'match') return;
  message(kind === 'regexp' ? (r.lines.length ? `${r.lines.length} match${r.lines.length === 1 ? '' : 'es'}` : `No matches for ${arg}`) : `${r.lines.length} TODO ${r.lines.length === 1 ? 'entry' : 'entries'} found`);
}

function startFind(backward = false, regexp = false) {
  if (finding || shownId === null) return;
  if (viewMode() === 'outline') setView('text');
  finding = { start: toFull(cur.proj, editor.selectionStart), end: toFull(cur.proj, editor.selectionEnd), folds: currentBuffer().folds };
  let mb;
  let dir = backward;
  // The prompt as Emacs words it: I-search:, Regexp I-search:, Failing regexp I-search backward:, Wrapped I-search:
  const name = (lead = '') => `${[lead, regexp ? 'regexp' : '', 'I-search', dir ? 'backward' : ''].filter(Boolean).join(' ').replace(/^./, (c) => c.toUpperCase())}:`;
  const input = () => mb.input;
  const show = (found) => {
    const b = currentBuffer();
    const opened = reveal(cur.a.foldables, b.folds, b.text.slice(0, found.start).split('\n').length - 1);
    if (JSON.stringify(opened) !== JSON.stringify(b.folds)) session.setFolds(b.id, opened);
    const start = toShown(cur.proj, found.start);
    const m = { start, end: start + (found.end - found.start) };
    editor.setSelectionRange(m.start, m.end);
    showCaret(m.start);
    hit = m;
    paintOverlay();
    renderModeLine();
  };
  // As in Emacs, a search that runs out of matches fails first; asking again in the same direction goes on from the other end.
  let failing = false;
  let current = null; // the match shown now; typing goes on from it
  let currentQuery = ''; // the text that found it
  const origin = toFull(cur.proj, editor.selectionStart);
  const go = (backward, from, wrap = false) => {
    const q = input().value;
    if (q === '') { mb.setPrompt(name()); return; }
    let m;
    try { m = search(currentBuffer().text, q, { from, backward, wrap, regexp }); } catch { m = null; }
    if (!m) { failing = true; mb.setPrompt(name('failing'), true); beep(); return; }
    failing = false;
    current = m;
    currentQuery = q;
    lastSearch = q;
    mb.setPrompt(m.wrapped ? name('wrapped') : name());
    show(m);
  };
  const end = (restore) => {
    if (restore) {
      if (JSON.stringify(currentBuffer().folds) !== JSON.stringify(finding.folds)) session.setFolds(shownId, finding.folds);
      editor.setSelectionRange(toShown(cur.proj, finding.start), toShown(cur.proj, finding.end));
    }
    if (!restore && toFull(cur.proj, editor.selectionStart) !== finding.start) { places.push({ kind: 'place', id: shownId, offset: finding.start }); showBack(); }
    finding = null;
    hit = null;
    paintOverlay();
    mb.close();
    message('');
    renderModeLine();
  };
  const selStart = () => toFull(cur.proj, editor.selectionStart);
  const selEnd = () => toFull(cur.proj, editor.selectionEnd);
  // C-s, C-r and the buttons go to the next or previous match; the prompt names the direction last used.
  const step = (back) => {
    if (input().value === '' && lastSearch !== '') { input().value = lastSearch; dir = back; mb.setPrompt(name()); go(back, back ? selStart() : selEnd()); return; }
    const turned = back !== dir;
    dir = back;
    mb.setPrompt(name());
    if (failing && !turned) { go(back, back ? selStart() : selEnd(), true); return; }
    go(back, turned ? (back ? selEnd() : selStart()) : (back ? selStart() : selEnd()));
  };
  mb = mini.open({
    prompt: name(),
    label: 'Search',
    onInput: () => go(dir, dir ? (current ? current.start + (regexp ? 1 : input().value.length) : origin) : (current ? current.start : origin)),
    onKey(e) {
      if (e.key === 'Enter') { e.preventDefault(); end(false); return true; }
      if (e.ctrlKey && e.key === 'g' && failing) { // as in Emacs, the first C-g removes the text that fails and the search goes on
        e.preventDefault(); e.stopPropagation();
        input().value = current ? currentQuery : '';
        failing = false;
        mb.setPrompt(name());
        return true;
      }
      if (e.key === 'Escape' || (e.ctrlKey && e.key === 'g')) { e.preventDefault(); e.stopPropagation(); end(true); return true; }
      if (e.ctrlKey && (e.key === 's' || e.key === 'r')) { e.preventDefault(); step(e.key === 'r'); return true; }
      if (e.altKey && e.key === 'r') { e.preventDefault(); regexp = !regexp; failing = false; mb.setPrompt(name()); go(dir, dir ? selEnd() : selStart()); return true; }
      return false;
    },
    buttons: [
      { label: '▲', aria: 'Previous match', onclick: () => step(true) },
      { label: '▼', aria: 'Next match', onclick: () => step(false) },
      { label: '✕', aria: 'Cancel search', onclick: () => end(true) },
    ],
  });
}

// ---- Setup, settings, export and import --------------------------------------------------------------

const FIELDS = {
  github: { title: 'GitHub', fields: [['github.owner', 'Owner', false], ['github.repo', 'Repository', false], ['github.branch', 'Branch (main if empty)', false]], secret: ['github.token', 'Access token'] },
  webdav: { title: 'WebDAV', fields: [['webdav.url', 'Server address', false], ['webdav.username', 'User name', false]], secret: ['webdav.password', 'Password'] },
};

async function setup(p) {
  const def = FIELDS[p];
  const cur = config.settings();
  const hasSecret = !!config.secrets()[def.secret[0]];
  await panel((sheet, close) => {
    const inputs = def.fields.map(([key, label]) => [key, h('input', { value: cur[key] ?? '', autocapitalize: 'off', spellcheck: 'false', 'aria-label': label })]);
    const secret = h('input', { type: 'password', placeholder: hasSecret ? 'Unchanged' : '', autocomplete: 'off', 'aria-label': def.secret[1] });
    put(sheet, h('h2', {}, def.title),
      ...inputs.map(([key, input], i) => h('div', {}, h('label', {}, def.fields[i][1]), input)),
      h('div', {}, h('label', {}, def.secret[1]), secret),
      h('p', {}, 'Stored in this browser, on this device only.'),
      h('div', { class: 'row' },
        h('button', { class: 'danger', onclick: async () => {
          config.update({ settings: Object.fromEntries(def.fields.map(([k]) => [k, ''])), secrets: { [def.secret[0]]: '' } });
          await rebuild(); await updatePending(); message(`${def.title} removed`); close(true);
        } }, 'Remove'),
        h('button', { onclick: () => close(undefined) }, 'Cancel'),
        h('button', { class: 'primary', onclick: async () => {
          config.update({ settings: Object.fromEntries(inputs.map(([k, i]) => [k, i.value.trim()])), secrets: secret.value ? { [def.secret[0]]: secret.value } : {} });
          try { await rebuild(); await updatePending(); message(config[`${p}Ready`]() ? `${def.title} set up` : `${def.title} needs every field before it can be used`); } catch (e) { failure(e); }
          close(true);
        } }, 'Save')));
  });
}

function summary(p) {
  return (p === 'github' ? config.githubReady() : config.webdavReady()) ? 'Configured' : 'Not set up';
}

async function settings() {
  for (;;) {
    const what = await panel((sheet, close) => {
      put(sheet, h('h2', {}, 'Settings'),
        h('div', { class: 'list' },
          h('button', { class: 'item', onclick: () => close('github') }, h('span', {}, 'GitHub'), h('span', { class: 'meta' }, `${summary('github')} ›`)),
          h('button', { class: 'item', onclick: () => close('webdav') }, h('span', {}, 'WebDAV'), h('span', { class: 'meta' }, `${summary('webdav')} ›`)),
          h('button', { class: 'item', onclick: () => close('emacs-settings') }, h('span', {}, 'Emacs'), h('span', { class: 'meta' }, '27 settings ›')),
          h('button', { class: 'item', onclick: () => close('appearance') }, h('span', {}, 'Appearance'), h('span', { class: 'meta' }, `${theme()[0].toUpperCase()}${theme().slice(1)}, ${fontSize()}px ›`)),
          h('button', { class: 'item', onclick: () => close('restore') }, h('span', {}, 'Restore open files on start'), h('span', { class: 'meta' }, restoreOn() ? 'On ›' : 'Off ›')),
          h('button', { class: 'item', onclick: () => close('tools-text') }, h('span', {}, 'Tool row in the Text view'), h('span', { class: 'meta' }, toolRowOn('text') ? 'On ›' : 'Off ›')),
          h('button', { class: 'item', onclick: () => close('keylog') }, h('span', {}, 'Key event log'), h('span', { class: 'meta' }, keyLogOn() ? 'On ›' : 'Off ›')),
          h('button', { class: 'item', onclick: () => close('tools-outline') }, h('span', {}, 'Tool row in the Outline view'), h('span', { class: 'meta' }, toolRowOn('outline') ? 'On ›' : 'Off ›')),
          h('div', { class: 'item' }, h('span', {}, 'Settings file'),
            h('span', { class: 'btns' }, h('button', { onclick: () => close('export') }, 'Export'), h('button', { onclick: () => close('import') }, 'Import'))),
          h('p', { class: 'note' }, 'Tokens and passwords are stored on this device.'),
          h('div', { class: 'item' }, h('span', {}, 'Versions (latest/installed)'), h('span', { class: 'meta' }, `${waiting?.version ?? VERSION}/${VERSION}`))),
        waiting ? h('div', { class: 'row' }, h('button', { class: 'primary', onclick: () => { close(undefined); restart(); } }, 'Restart to update')) : null,
        h('div', { class: 'row' }, h('button', { onclick: () => close(undefined) }, 'Close')));
    });
    if (what === undefined) return;
    if (what === 'github' || what === 'webdav') await setup(what);
    else if (what === 'emacs-settings') await emacsSettings();
    else if (what === 'appearance') await appearance();
    else if (what === 'keylog') await keyLogScreen();
    else if (what === 'restore') config.update({ settings: { 'session.restore': String(!restoreOn()) } });
    else if (what === 'tools-text') config.update({ settings: { 'view.toolRowText': String(!toolRowOn('text')) } });
    else if (what === 'tools-outline') config.update({ settings: { 'view.toolRowOutline': String(!toolRowOn('outline')) } });
    else if (what === 'export') { await exportDialog(); return; }
    else { $('import-file').click(); return; }
  }
}

/** Settings, Emacs: the settings that are Emacs's own, in alphabetical order. */
async function emacsSettings() {
  let note = '';
  for (;;) {
    const what = await panel((sheet, close) => {
      const files = agendaFileNames().length;
      const item = (key, label, meta) => h('button', { class: 'item', onclick: () => close(key) }, h('span', {}, label), h('span', { class: 'meta' }, `${meta} ›`));
      put(sheet, h('h2', {}, 'Emacs'), note ? h('p', {}, note) : null,
        h('div', { class: 'list' },
          item('agenda-files', 'Agenda files', `${files} ${files === 1 ? 'file' : 'files'}`),
          item('archive', 'Archive location', archiveLocation()),
          item('archive-done', 'Archive marks done', archiveMarkDone() === null ? 'Off' : archiveMarkDone() === true ? 'On' : archiveMarkDone()),
          item('archive-context', 'Archive saves', archiveContext().length ? archiveContext().join(' ') : 'Nothing'),
          item('time-grid', 'Agenda time grid', timeGridOn() ? 'On' : 'Off'),
          item('beep', 'Beep on errors', beepOn() ? 'On' : 'Off'),
          item('capture-templates', 'Capture templates', (() => { const n = parseTemplates(captureText()).length; return `${n} ${n === 1 ? 'template' : 'templates'}`; })()),
          item('contacts-files', 'Contacts files', contactFiles().length ? `${contactFiles().length} ${contactFiles().length === 1 ? 'file' : 'files'}` : 'None'),
          item('birthday-property', 'Birthday property', contactProperty()),
          item('date-style', 'Date style', { american: 'American', european: 'European', iso: 'ISO' }[dateStyle()]),
          item('diary-file', 'Diary file', diaryFile() || 'None'),
          item('diary-on', 'Diary in the agenda', diaryOn() ? 'On' : 'Off'),
          item('emacs', 'Emacs keys', emacsKeys() ? 'On' : 'Off'),
          item('stars', 'Hide leading stars', hideStars() ? 'On' : 'Off'),
          item('indented', 'Indent files on open', indentSetting() ? 'On' : 'Off'),
          item('holidays', 'Holidays', holidayKinds().length ? holidayKinds().map((k) => HOLIDAY_KINDS.find((x) => x[0] === k)?.[1] ?? k).join(', ') : 'None'),
          item('holidays-agenda', 'Holidays in the agenda', holidaysInAgenda() ? 'On' : 'Off'),
          item('holidays-local', 'Local holidays', localHolidays() ? 'Custom' : 'None'),
          item('log-drawer', 'Log into drawer', logDrawer() ?? 'Off'),
          item('log-repeat', 'Log repeats', { time: 'Time', note: 'Note', off: 'Off' }[logRepeatMode()]),
          item('agenda-prefix', 'Agenda line format', prefixText() ? 'Custom' : 'Default'),
          item('refile', 'Refile targets', refileText() ? 'Custom' : 'Top level'),
          item('refile-new', 'Refile new headings', { nil: 'Not allowed', confirm: 'Ask', t: 'Allowed' }[refileNew()]),
          item('table-wrap', 'Wrap table cells', wrapCells() ? 'On' : 'Off'),
          item('table-width', 'Table width', `${Math.round(widthFraction() * 100)}%`),
          item('table-zebra', 'Stripe table rows', zebraRows() ? 'On' : 'Off'),
          item('tags-column', 'Tag column', String(tagsColumn()))),
        h('div', { class: 'row' }, h('button', { onclick: () => close(undefined) }, '‹ Settings')));
    });
    if (what === undefined) return;
    note = '';
    $('message').textContent = '';
    if (what === 'agenda-files') await agendaFilesDialog();
    else if (what === 'archive') await archiveLocationDialog();
    else if (what === 'contacts-files') await contactFilesDialog();
    else if (what === 'birthday-property') await birthdayPropertyDialog();
    else if (what === 'date-style') await dateStyleDialog();
    else if (what === 'holidays') await holidaysDialog();
    else if (what === 'holidays-agenda') config.update({ settings: { 'diary-show-holidays-flag': holidaysInAgenda() ? '' : 't' } });
    else if (what === 'holidays-local') await localHolidaysDialog();
    else if (what === 'diary-file') await diaryFileDialog();
    else if (what === 'diary-on') config.update({ settings: { 'org-agenda-include-diary': diaryOn() ? '' : 't' } });
    else if (what === 'time-grid') config.update({ settings: { 'org-agenda-use-time-grid': timeGridOn() ? 'nil' : '' } });
    else if (what === 'archive-done') await archiveDoneDialog();
    else if (what === 'archive-context') await archiveContextDialog();
    else if (what === 'refile-new') await refileNewDialog();
    else if (what === 'agenda-prefix') await prefixSettingsDialog();
    else if (what === 'refile') await refileSettingsDialog();
    else if (what === 'beep') config.update({ settings: { 'view.beep': String(!beepOn()) } });
    else if (what === 'capture-templates') await captureTemplatesDialog();
    else if (what === 'emacs') config.update({ settings: { 'view.emacsKeys': String(!emacsKeys()) } });
    else if (what === 'log-drawer') await logDrawerDialog();
    else if (what === 'log-repeat') await logRepeatDialog();
    else if (what === 'stars') config.update({ settings: { 'org-hide-leading-stars': hideStars() ? '' : 't' } });
    else if (what === 'indented') config.update({ settings: { 'org-startup-indented': indentSetting() ? '' : 't' } });
    else if (what === 'table-wrap') config.update({ settings: { 'org-table-widget-wrap-columns': wrapCells() ? '' : 't' } });
    else if (what === 'table-zebra') config.update({ settings: { 'org-table-widget-zebra-stripe': zebraRows() ? '' : 't' } });
    else if (what === 'table-width') await tableWidthDialog();
    else await tagsColumnDialog();
    note = $('message').classList.contains('error') ? '' : $('message').textContent;
  }
}

/** What a Reset button closes its panel with. */
const RESET = Symbol('reset');

async function tagsColumnDialog() {
  const value = await panel((sheet, close) => {
    const input = h('input', { value: String(tagsColumn()), inputmode: 'numeric', autocomplete: 'off', 'aria-label': 'Tag column' });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); close(input.value); } });
    put(sheet, h('h2', {}, 'Tag column'),
      h('p', {}, `A negative number is the column where the heading and its tags end; a positive one is the column where the tags start; 0 puts them one space after the title. The default is ${DEFAULT_TAGS_COLUMN}.`),
      input,
      h('div', { class: 'row' }, h('button', { onclick: () => close(undefined) }, '‹ Emacs'), h('button', { onclick: () => close(RESET) }, 'Reset'), h('button', { class: 'primary', onclick: () => close(input.value) }, 'Set')));
    input.focus();
  });
  if (value === undefined) return;
  if (value === RESET) { config.update({ settings: { 'org.tagsColumn': '' } }); message(`Tag column is ${DEFAULT_TAGS_COLUMN}`); return; }
  if (!/^-?\d+$/.test(value.trim())) { message('Enter a whole number', true); return; }
  config.update({ settings: { 'org.tagsColumn': String(Number(value)) } });
}

async function tableWidthDialog() {
  const value = await panel((sheet, close) => {
    const input = h('input', { value: String(Math.round(widthFraction() * 100)), inputmode: 'numeric', autocomplete: 'off', 'aria-label': 'Table width in percent' });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); close(input.value); } });
    put(sheet, h('h2', {}, 'Table width'),
      h('p', {}, 'The share of the screen width, from 30 to 100 percent, that a table in the Outline view may use before it scrolls sideways or, with Wrap table cells on, wraps. The default is 100.'),
      input,
      h('div', { class: 'row' }, h('button', { onclick: () => close(undefined) }, '‹ Emacs'), h('button', { onclick: () => close(RESET) }, 'Reset'), h('button', { class: 'primary', onclick: () => close(input.value) }, 'Set')));
    input.focus();
  });
  if (value === undefined) return;
  if (value === RESET) { config.update({ settings: { 'org-table-widget-max-width-fraction': '' } }); message('Table width is 100%'); return; }
  const n = Number(value.trim());
  if (!/^\d+$/.test(value.trim()) || n < 30 || n > 100) { message('Enter a number from 30 to 100', true); return; }
  config.update({ settings: { 'org-table-widget-max-width-fraction': String(n / 100) } });
}

/** The Appearance screen: theme, font, text size and paragraph spacing. Each change shows at once. */
async function appearance() {
  const FONT_NAMES = [['monospace', 'Monospace'], ['sans-serif', 'Sans-serif'], ['serif', 'Serif'], ['system', 'System']];
  for (;;) {
    const what = await panel((sheet, close) => {
      const choice = (label, on, value) => h('button', { class: `opt${on ? ' on' : ''}`, 'aria-pressed': String(on), onclick: () => close(value) }, label);
      const step = (label, value, down, up) => h('div', { class: 'stepper' },
        h('button', { 'aria-label': `${label} smaller`, onclick: () => close(down) }, '−'), h('span', {}, value), h('button', { 'aria-label': `${label} larger`, onclick: () => close(up) }, '+'));
      const custom = !FONT_NAMES.some(([k]) => k === fontChoice());
      put(sheet, h('h2', {}, 'Appearance'),
        h('div', { class: 'card' }, h('div', { class: 'cap' }, 'Theme'),
          h('div', { class: 'seg' }, ...THEMES.map((t) => choice(t[0].toUpperCase() + t.slice(1), theme() === t, `theme:${t}`)))),
        h('div', { class: 'card' }, h('div', { class: 'cap' }, 'Font'),
          h('div', { class: 'seg two' }, ...FONT_NAMES.map(([k, n]) => choice(n, fontChoice() === k, `font:${k}`)), choice(custom ? fontChoice() : 'Other…', custom, 'font-other')),
          h('p', {}, 'With a font that is not monospace, columns such as the tag column do not line up on screen.')),
        h('div', { class: 'card' }, h('div', { class: 'cap' }, 'Font size'), step('Font size', `${fontSize()}px`, 'size:-1', 'size:1'), h('p', {}, '12 to 32. The A− and A+ buttons change the same size.')),
        h('div', { class: 'card' }, h('div', { class: 'cap' }, 'Paragraph spacing'), step('Paragraph spacing', `${paragraphSpacing()}px`, 'space:-1', 'space:1'), h('p', {}, 'The gap between paragraphs in the Outline view, 0 to 32.')),
        h('div', { class: 'row' }, h('button', { onclick: () => close(undefined) }, '‹ Settings')));
    });
    if (what === undefined) return;
    const [kind, arg] = what.split(':');
    if (kind === 'theme') config.update({ settings: { 'view.theme': arg } });
    else if (kind === 'font') config.update({ settings: { 'view.font': arg } });
    else if (kind === 'size') setTextSize(Number(arg));
    else if (kind === 'space') config.update({ settings: { 'view.paragraphSpacing': String(Math.min(32, Math.max(0, paragraphSpacing() + Number(arg)))) } });
    else if (what === 'font-other') {
      const name = await panel((sheet, close) => {
        const input = h('input', { value: custom0(), autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Font name' });
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); close(input.value); } });
        put(sheet, h('h2', {}, 'Font name'), h('p', {}, 'The name of a font installed on this device, for example Cascadia Code.'), input,
          h('div', { class: 'row' }, h('button', { onclick: () => close(undefined) }, 'Cancel'), h('button', { class: 'primary', onclick: () => close(input.value) }, 'Use')));
        input.focus();
      });
      if (name !== undefined && name.trim() !== '') config.update({ settings: { 'view.font': name.trim() } });
    }
  }
}
const custom0 = () => (['monospace', 'sans-serif', 'serif', 'system'].includes(fontChoice()) ? '' : fontChoice());

async function exportDialog() {
  const pass = await panel((sheet, close) => {
    const input = h('input', { type: 'password', placeholder: 'Leave empty for none', autocomplete: 'new-password', 'aria-label': 'Passphrase' });
    put(sheet, h('h2', {}, 'Export settings'),
      h('p', {}, 'Saves an Org file to your downloads. It includes your tokens and passwords.'),
      h('div', {}, h('label', {}, 'Passphrase (optional)'), input),
      h('p', {}, 'Without a passphrase, the secrets are written in plain text. Keep the file private.'),
      h('div', { class: 'row' }, h('button', { onclick: () => close(undefined) }, 'Cancel'), h('button', { class: 'primary', onclick: () => close(input.value) }, 'Export')));
  });
  if (pass === undefined) return;
  try {
    const d = app.clock.now();
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const text = await exportSettings({ settings: config.settings(), secrets: config.secrets(), passphrase: pass, date });
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = h('a', { href: url, download: settingsFileName(date) });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    message(`Exported ${settingsFileName(date)}`);
  } catch (e) { failure(e); }
}

$('import-file').addEventListener('change', async (ev) => {
  const file = ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  try {
    const text = await file.text();
    const info = inspectSettingsFile(text);
    const result = await panel((sheet, close) => {
      const input = info.encrypted ? h('input', { type: 'password', autocomplete: 'off', placeholder: 'Passphrase used for export', 'aria-label': 'Passphrase' }) : null;
      const err = h('p', { class: 'tag' });
      put(sheet, h('h2', {}, 'Import settings'),
        h('p', {}, `${file.name}: ${Object.keys(info.settings).length} settings, ${info.encrypted ? 'encrypted secrets' : `${info.secretCount} secrets`}.`),
        input ? h('div', {}, h('label', {}, 'Passphrase'), input) : null,
        h('p', {}, 'Importing replaces your current settings on this device.'), err,
        h('div', { class: 'row' }, h('button', { onclick: () => close(undefined) }, 'Cancel'),
          h('button', { class: 'primary', onclick: async () => {
            try { close(await importSettings(text, { passphrase: input?.value })); }
            catch (e) { if (e instanceof SettingsFileError) err.textContent = e.message; else { close(undefined); failure(e); } }
          } }, 'Import')));
    });
    if (!result) return;
    config.replaceAll(result);
    await rebuild();
    await updatePending();
    message(`Settings imported (${Object.keys(result.settings).length + Object.keys(result.secrets).length})`);
  } catch (e) { failure(e); }
});

// ---- Toolbar -------------------------------------------------------------------------------------------

async function openNamed(name) {
  try {
    const r = await openFile(name);
    if (r.ok) recent.add(name); else message(`${name} does not exist`, true);
  } catch (e) { failure(e); }
}

const recentLabel = (name) => `${parseName(name).path} (${STORAGE_LABEL[parseName(name).provider]})`;

async function filesMenu() {
  const what = await panel((sheet, close) => {
    const row = (label, value, dim) => h('button', { class: `item${dim ? ' dim' : ''}`, onclick: () => close(value) }, h('span', {}, label));
    const draw = () => {
      const s = session.state();
      const current = s.buffers.find((x) => x.id === s.current)?.name;
      const open = new Set(s.buffers.map((x) => x.name));
      const names = recent.list();
      put(sheet, h('h2', {}, 'File'),
        h('div', { class: 'list' }, row('New', 'new'), row('Open', 'open'), row('Save', 'save'), row('Save as', 'saveas'),
          row('Save some buffers', 'some', session.unsavedIds().length === 0), row('Sample documents', 'samples')),
        names.length ? h('p', {}, 'Recently opened (long-press an entry to remove it from this list; the file is not deleted)') : null,
        names.length ? h('div', { class: 'list recent' }, names.map((n) => {
          let timer = null;
          let held = false;
          const stop = () => { clearTimeout(timer); timer = null; };
          return h('button', {
            class: `item${n === current ? ' current' : ''}`,
            onpointerdown: () => { held = false; timer = setTimeout(() => { held = true; recent.remove(n); draw(); }, 600); },
            onpointerup: stop, onpointerleave: stop, onpointercancel: stop,
            oncontextmenu: (e) => e.preventDefault(),
            onclick: () => { if (!held) close({ recent: n }); },
          }, h('span', {}, recentLabel(n)), h('span', { class: 'meta' }, n === current ? 'current' : open.has(n) ? 'open' : ''));
        })) : null,
        h('div', { class: 'row' }, names.length ? h('button', { onclick: () => { recent.clear(); draw(); } }, 'Clear recents') : null,
          h('button', { onclick: () => close(undefined) }, 'Cancel')));
    };
    draw();
  });
  if (what === undefined) return;
  if (what.recent) await openNamed(what.recent);
  else if (what === 'new') session.newScratch();
  else if (what === 'samples') await openSamples();
  else if (what === 'open') {
    // Opens where the current file is, or where the last opened or saved file was.
    const name = await browse({ mode: 'open', current: currentBuffer()?.name ?? recent.list()[0] ?? null });
    if (name) await openNamed(name);
  } else if (what === 'save') { if (shownId !== null) await saveBuffer(shownId); }
  else if (what === 'saveas') { if (shownId !== null) await saveAs(shownId); }
  else if (what === 'some') await saveSomeBuffers();
}

$('btn-files').addEventListener('click', filesMenu);
$('btn-save').addEventListener('click', () => { if (shownId !== null) saveBuffer(shownId); });
$('btn-find').addEventListener('click', () => startFind());
$('btn-view').addEventListener('click', async () => {
  const what = await choose(null, [{ label: 'Agenda', value: 'agenda' }, { label: 'Calendar', value: 'calendar' }, ...['outline', 'text'].map((v) => ({ label: v === 'outline' ? 'Outline' : 'Text', meta: viewMode() === v ? 'current' : null, value: v }))]);
  if (what === 'agenda') await agendaScreen();
  else if (what === 'calendar') await calendarScreen();
  else if (what) setView(what);
});
$('btn-menu').addEventListener('click', async () => {
  const what = await choose(null, [
    waiting ? { label: 'Restart to update', meta: `${VERSION} to ${waiting.version}`, value: 'restart' } : null,
    { label: 'Commands', value: 'commands' },
    { label: 'Capture', value: 'capture' },
    { label: 'Settings', value: 'settings' }].filter(Boolean));
  if (what === 'restart') restart();
  else if (what === 'commands') await commandPalette();
  else if (what === 'capture') await capture();
  else if (what === 'settings') await settings();
});

// ---- Capture ------------------------------------------------------------------------------------

/** org-capture-templates as the text of its init.el form; Emacs's own template when none is set. */
const DEFAULT_TEMPLATES = '(setq org-capture-templates \'(("t" "Task" entry (file+headline ".notes" "Tasks") "* TODO %?\\n  %u\\n  %a")))';
const captureText = () => config.settings()['org-capture-templates'] || DEFAULT_TEMPLATES;
const captureTemplates = () => parseTemplates(captureText());

/** The multi-line field of the capture screen, with the caret where %? was. */
function askCapture(title, target, initial, caret) {
  return panel((sheet, close) => {
    const input = h('textarea', { rows: '10', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Capture' });
    input.value = initial;
    put(sheet, h('h2', {}, title), h('p', {}, target), input,
      h('div', { class: 'row' }, h('button', { onclick: () => close(undefined) }, 'Cancel'), h('button', { class: 'primary', onclick: () => close(input.value) }, 'Save')));
    input.focus();
    input.setSelectionRange(caret, caret);
  });
}

/** Files the captured text into its target file, opening the file when it is not open. */
async function fileCapture(tpl, captured) {
  const name = tpl.target.file;
  let buffer = session.state().buffers.find((b) => b.name === name);
  if (!buffer) {
    const opened = await openFile(name);
    const id = opened.ok ? opened.id : session.createFile(name, '');
    buffer = session.state().buffers.find((b) => b.id === id);
  }
  const r = place(buffer.text, tpl, captured);
  session.apply(buffer.id, { text: r.text });
  message(`Captured to ${name}`);
}

/** C-c c: choose a template, answer its questions, edit the text, and file it. */
async function capture() {
  try {
    const templates = captureTemplates();
    const tpl = await choose('Capture', templates.map((t) => ({ label: `${t.key}  ${t.description}`, meta: `${t.target.file} ›`, value: t })));
    if (!tpl) return;
    const answers = [];
    for (const q of promptsOf(tpl.template)) {
      const a = q.choices.length ? await choose(q.prompt, q.choices.map((c) => ({ label: c, value: c }))) : await askText({ prompt: `${q.prompt}:`, title: q.prompt, value: q.default, ok: 'OK' });
      if (a === undefined) return;
      answers.push(a);
    }
    const b = currentBuffer();
    const hd = b ? enclosingHead() : null;
    const above = b ? editor.value.split('\n')[kindAtCursor().line] ?? '' : '';
    const link = b?.name ? (hd ? `[[file:${b.name}::*${hd.title}][${hd.title}]]` : above.trim() ? `[[file:${b.name}::${above.trim()}]]` : `[[file:${b.name}]]`) : '';
    const sel = viewMode() === 'text' && editor.selectionStart !== editor.selectionEnd ? editor.value.slice(editor.selectionStart, editor.selectionEnd) : '';
    const e = expand(tpl.template, { answers, now: localNow(), link, selection: sel });
    const where = tpl.target.path ? `${tpl.target.file} › ${tpl.target.path.join(' › ')}` : tpl.target.file;
    const captured = tpl.opts.immediate ? e.text : await askCapture(`Capture: ${tpl.description}`, where, e.text, e.caret);
    if (captured === undefined) return;
    await fileCapture(tpl, captured);
  } catch (e) { failure(e); }
}

/** Settings, Emacs, Capture templates: the init.el form, as text. */
async function captureTemplatesDialog() {
  for (;;) {
    const text = await panel((sheet, close) => {
      const input = h('textarea', { rows: '12', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Capture templates', style: 'font-family:monospace' });
      input.value = captureText();
      put(sheet, h('h2', {}, 'Capture templates'),
        h('p', {}, 'The templates as init.el sets them, with setq or add-to-list.'), input,
        h('div', { class: 'row' }, h('button', { onclick: () => close(undefined) }, '‹ Emacs'), h('button', { onclick: () => close(RESET) }, 'Reset'), h('button', { class: 'primary', onclick: () => close(input.value) }, 'Save')));
    });
    if (text === undefined) return;
    if (text === RESET) { config.update({ settings: { 'org-capture-templates': '' } }); message('Capture templates reset'); return; }
    try { const n = parseTemplates(text).length; config.update({ settings: { 'org-capture-templates': n ? text.trim() : '' } }); message(`${n} capture ${n === 1 ? 'template' : 'templates'}`); return; } catch (e) { message(e.message, true); }
  }
}

// ---- Refile and archive -------------------------------------------------------------------------

const DEFAULT_REFILE = '(setq org-refile-targets \'((nil :level . 1)))';
const refileCache = new RefileCache();
const prefixText = () => config.settings()['org-agenda-prefix-settings'] ?? '';
const DEFAULT_PREFIX = `(setq org-agenda-prefix-format\n      '((agenda . "${DEFAULT_FORMATS.agenda}")\n        (todo . "${DEFAULT_FORMATS.todo}")\n        (tags . "${DEFAULT_FORMATS.tags}")\n        (search . "${DEFAULT_FORMATS.search}")))\n(setq org-agenda-category-icon-alist nil)`;
const prefixOpts = () => { try { return parseAgendaSettings(prefixText() || DEFAULT_PREFIX); } catch { return parseAgendaSettings(DEFAULT_PREFIX); } };
const refileText = () => config.settings()['org-refile-settings'] ?? '';
/** org-archive-mark-done: null (nil), true (t) or a keyword. org-archive-save-context-info: the names saved. */
const archiveMarkDone = () => { const v = setting('org-archive-mark-done'); return !v || v === 'nil' ? null : v === 't' ? true : v; };
const archiveContext = () => { const v = setting('org-archive-save-context-info'); return !v ? ARCHIVE_CONTEXT : v === 'nil' ? [] : v.split(/\s+/); };
const refileNew = () => setting('org-refile-allow-creating-parent-nodes') || 'nil';
const diaryOn = () => setting('org-agenda-include-diary') === 't';
const diaryFile = () => { const v = setting('diary-file') || ''; if (!v) return ''; const p = parseName(v); return formatName(p.provider, p.path); };
const dateStyle = () => ({ european: 'european', iso: 'iso' }[setting('calendar-date-style')] ?? 'american');
const HOLIDAY_KINDS = [['general', 'General'], ['christian', 'Christian'], ['solar', 'Solar']];
const holidayKinds = () => { const v = setting('calendar-holidays'); return v === undefined || v === '' ? HOLIDAY_KINDS.map((k) => k[0]) : v === 'nil' ? [] : v.split(/\s+/); };
const contactFiles = () => (setting('org-contacts-files') || '').split(/\s+/).filter(Boolean).map((n) => { const p = parseName(n); return formatName(p.provider, p.path); });
const contactProperty = () => setting('org-contacts-birthday-property') || 'BIRTHDAY';
let contactTexts = []; // the text of the contacts files the last agenda or calendar read
const contactOpts = () => (contactTexts.length ? { texts: contactTexts, property: contactProperty() } : null);
const holidaysInAgenda = () => setting('diary-show-holidays-flag') === 't';
const localHolidays = () => setting('holiday-local-holidays') || '';
const holidayOpts = () => ({ which: holidayKinds(), localText: localHolidays() });
let diaryText = null; // { name, text, style } of the diary the last agenda or calendar read
const timeGridOn = () => setting('org-agenda-use-time-grid') !== 'nil';
const archiveLocation = () => config.settings()['org-archive-location'] || '%s_archive::';
const bufferName = (b) => b.name ?? b.title;

/** The text of a file that may be a refile or archive target: its open buffer, or the file opened. */
async function bufferFor(name) {
  let b = session.state().buffers.find((x) => x.name === name);
  if (!b) {
    const opened = await openFile(name);
    if (!opened.ok) return null;
    b = session.state().buffers.find((x) => x.id === opened.id);
  }
  return b;
}

/** C-c C-w (C-c M-w keeps the original): choose where the heading and its subtree go. */
let lastRefile = null;

/** Takes the buffer shown to the line of a heading, as visiting it does. */
async function visitLine(name, line) {
  const here = currentBuffer();
  const x = bufferName(here) === name ? here : await bufferFor(name);
  if (!x) { failure(new Error(`${name} does not exist`)); return false; }
  leaveHere();
  session.select(x.id);
  setView('text');
  // as Emacs does when it goes to a refile target: the folds that hide it open
  const b = currentBuffer();
  const opened = reveal(analyze(b.text).foldables, b.folds, Math.max(0, line));
  if (JSON.stringify(opened) !== JSON.stringify(b.folds)) session.setFolds(b.id, opened);
  placeCursor(Math.max(0, line));
  return true;
}

async function refileHere(copy0 = false, hd0 = enclosingHead()) {
  const a = arg;
  // C-0 and C-u C-u C-u clear the cache; C-u C-u goes to where the last refile put its subtree; C-u only visits the target; 3 keeps the entry
  if (!copy0 && (a?.num === 0 || a?.list === 64)) { refileCache.clear(); message('Refile cache has been cleared'); return; }
  if (!copy0 && a?.list === 16) {
    if (!lastRefile) { message('No refile location stored', true); return; }
    if (await visitLine(lastRefile.file, lastRefile.line)) message('This is the location of the last refile');
    return;
  }
  const goto = !copy0 && a?.list === 4;
  const copy = copy0 || a?.num === 3;
  let hd = hd0;
  if (!hd && !goto) { message(hd0 === null ? 'Tap a heading, then Refile' : 'Not at a heading'); return; }
  try {
    const settings = parseRefileSettings(refileText() || DEFAULT_REFILE);
    let b = currentBuffer();
    const cname = bufferName(b);
    const names = new Set([cname]);
    for (const t of settings.targets) for (const n of t.files === 'agenda' ? agendaFileNames() : t.files ?? []) names.add(n);
    const files = [];
    for (const n of names) { const x = n === cname ? b : await bufferFor(n); if (x) files.push({ name: n, text: x.text, id: x.id }); }
    const targets = refileCache.get(settings, cname, () => listTargets(files, settings, { current: cname, agenda: agendaFileNames() }));
    if (!targets.length) { message('No refile targets', true); return; }
    const rows = targets.map((x) => ({ label: x.label, meta: files.length > 1 ? x.file : null, value: x }));
    let t = await choose(goto ? 'Goto' : copy ? 'Refile (and keep) to' : 'Refile to', goto ? rows : [...rows, ...(refileNew() === 'nil' ? [] : [{ group: 'New' }, { label: 'New heading under…', value: 'new' }])]);
    if (!t) return;
    if (goto) { await visitLine(t.file, t.line); return; }
    if (t === 'new') {
      // org-refile-allow-creating-parent-nodes: the new heading is made first, at the end of the parent's subtree
      const parent = await choose('New heading under', rows.filter((x) => x.value.line >= 0));
      if (!parent) return;
      const title = await askTitle('New heading', '');
      if (title === undefined || title.trim() === '') return;
      if (refileNew() === 'confirm' && !(await ask('New heading', `Create new node "${title.trim()}"?`, [{ label: 'No', value: false }, { label: 'Yes', value: true, primary: true }]))) return;
      const home = files.find((f) => f.name === parent.file);
      const made = newChild(home.text, parent, title.trim());
      session.apply(home.id, { text: made.text });
      t = { label: `${parent.label}/${title.trim()}`, file: parent.file, line: made.line, level: parent.level + 1 };
      if (home.id === b.id) { const grew = made.text.split('\n').length - home.text.split('\n').length; if (made.line <= hd.line) hd = { ...hd, line: hd.line + grew, end: hd.end + grew }; b = currentBuffer(); }
      home.text = made.text;
    }
    const same = t.file === cname;
    if (settings.cache && t !== 'new') checkTarget(t, (files.find((f) => f.name === t.file) ?? b).text);
    const other = same ? null : files.find((f) => f.name === t.file);
    const r = refile(b.text, hd.line, t, { otherText: other?.text ?? null, reverse: settings.reverse, copy, column: tagsColumn() });
    session.apply(b.id, { text: r.text });
    if (other) session.apply(other.id, { text: r.otherText });
    lastRefile = { file: t.file, line: r.placed };
    message(refileMessage(t, t.file, copy));
  } catch (e) { failure(e); }
}

/** C-c C-x C-a: the subtree goes to the archive location, with where it came from kept in properties. */
async function archiveHere(hd = enclosingHead()) {
  if (!hd) { message('Not at a heading'); return; }
  try {
    const b = currentBuffer();
    const cname = bufferName(b);
    const loc = archiveLocation();
    if (b.name === null && loc.slice(0, loc.indexOf('::')).includes('%s')) { message('No file associated to buffer', true); return; }
    const file = loc.slice(0, loc.indexOf('::')).replace('%s', cname);
    const ab = file && file !== cname ? await (async () => { const x = session.state().buffers.find((y) => y.name === file); if (x) return x; const o = await openFile(file); return o.ok ? session.state().buffers.find((y) => y.id === o.id) : null; })() : null;
    const category = /^#\+CATEGORY:[ \t]*(\S.*?)[ \t]*$/im.exec(b.text)?.[1] ?? cname.replace(/^.*\//, '').replace(/\.[^.]*$/, '');
    const r = archiveSubtree(b.text, hd.line, { fileName: cname, category, location: loc, now: localNow(), archiveText: ab?.text ?? null, column: tagsColumn(), markDone: archiveMarkDone(), contextInfo: archiveContext() });
    session.apply(b.id, { text: r.text });
    if (r.archive) {
      if (ab) session.apply(ab.id, { text: r.archive.text });
      else { session.createFile(r.archive.file, r.archive.text); session.select(b.id); }
    }
    message(r.message);
  } catch (e) { failure(e); }
}

function archiveSibling(hd = enclosingHead()) {
  if (!hd) { message('Not at a heading'); return; }
  runEdit((t) => archiveToSibling(t, hd.line, { now: localNow(), column: tagsColumn() }));
}

function archiveTag(hd = enclosingHead()) {
  if (!hd) { message('Not at a heading'); return; }
  const m = runEdit((t) => toggleArchiveTag(t, hd.line, tagsColumn()));
  if (m) message(m.message);
}

/** Settings, Emacs, Refile targets and Archive location: the init.el forms, as text. */
async function prefixSettingsDialog() {
  for (;;) {
    const text = await panel((sheet, close) => {
      const input = h('textarea', { rows: '9', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Agenda line format', style: 'font-family:monospace' });
      input.value = prefixText() || DEFAULT_PREFIX;
      put(sheet, h('h2', {}, 'Agenda line format'),
        h('p', {}, 'org-agenda-prefix-format and org-agenda-category-icon-alist, as init.el sets them with setq.'), input,
        h('div', { class: 'row' }, h('button', { onclick: () => close(undefined) }, '‹ Emacs'), h('button', { onclick: () => close(RESET) }, 'Reset'), h('button', { class: 'primary', onclick: () => close(input.value) }, 'Save')));
    });
    if (text === undefined) return;
    if (text === RESET) { config.update({ settings: { 'org-agenda-prefix-settings': '' } }); message('Agenda line format reset'); return; }
    try { parseAgendaSettings(text); config.update({ settings: { 'org-agenda-prefix-settings': text.trim() === DEFAULT_PREFIX ? '' : text.trim() } }); message('Agenda line format set'); return; } catch (e) { message(e.message, true); }
  }
}

async function refileSettingsDialog() {
  for (;;) {
    const text = await panel((sheet, close) => {
      const input = h('textarea', { rows: '8', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Refile targets', style: 'font-family:monospace' });
      input.value = refileText() || DEFAULT_REFILE;
      put(sheet, h('h2', {}, 'Refile targets'),
        h('p', {}, 'org-refile-targets, org-refile-use-outline-path, org-refile-use-cache and org-reverse-note-order, as init.el sets them with setq.'), input,
        h('div', { class: 'row' }, h('button', { onclick: () => close(undefined) }, '‹ Emacs'), h('button', { onclick: () => close(RESET) }, 'Reset'), h('button', { class: 'primary', onclick: () => close(input.value) }, 'Save')));
    });
    if (text === undefined) return;
    if (text === RESET) { config.update({ settings: { 'org-refile-settings': '' } }); message('Refile targets reset'); return; }
    try { parseRefileSettings(text); config.update({ settings: { 'org-refile-settings': text.trim() === DEFAULT_REFILE ? '' : text.trim() } }); message('Refile targets set'); return; } catch (e) { message(e.message, true); }
  }
}

async function logDrawerDialog() {
  const value = await panel((sheet, close) => {
    const input = h('input', { value: logDrawer() ?? '', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Log into drawer', placeholder: 'LOGBOOK' });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); close(input.value); } });
    put(sheet, h('h2', {}, 'Log into drawer'),
      h('p', {}, 'The name of the drawer that holds the log line of a repeating task, such as LOGBOOK. Empty puts the line in the text, after the properties.'), input,
      h('div', { class: 'row' }, h('button', { onclick: () => close(undefined) }, '‹ Emacs'), h('button', { onclick: () => close(RESET) }, 'Reset'), h('button', { class: 'primary', onclick: () => close(input.value) }, 'Set')));
    input.focus();
  });
  if (value === undefined) return;
  const name = value === RESET ? '' : value.trim();
  if (!/^[A-Za-z0-9_-]*$/.test(name)) { message('A drawer name is letters, digits, - and _', true); return; }
  config.update({ settings: { 'org-log-into-drawer': name } });
  message(name ? `Log lines go in :${name}:` : 'Log lines go in the text');
}

async function logRepeatDialog() {
  const v = await choose('Log repeats', [{ label: 'Time', meta: 'a log line with the time', value: '' }, { label: 'Note', meta: 'asks for a note too', value: 'note' }, { label: 'Off', meta: 'nothing is recorded', value: 'nil' }]);
  if (v === undefined) return;
  config.update({ settings: { 'org-log-repeat': v } });
  message(`Log repeats: ${{ '': 'time', note: 'note', nil: 'off' }[v]}`);
}

/** A one-line setting with [‹ Emacs][Reset][Set]; `check` returns the stored text, or throws a message. */
async function lineSetting({ title, help, shown, key, check, said }) {
  const value = await panel((sheet, close) => {
    const input = h('input', { value: shown, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': title });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); close(input.value); } });
    put(sheet, h('h2', {}, title), h('p', {}, help), input,
      h('div', { class: 'row' }, h('button', { onclick: () => close(undefined) }, '‹ Emacs'), h('button', { onclick: () => close(RESET) }, 'Reset'), h('button', { class: 'primary', onclick: () => close(input.value) }, 'Set')));
    input.focus();
  });
  if (value === undefined) return;
  try {
    const stored = value === RESET ? '' : check(value.trim());
    config.update({ settings: { [key]: stored } });
    message(said(stored));
  } catch (e) { message(e.message, true); }
}

const archiveDoneDialog = () => lineSetting({ title: 'Archive marks done', key: 'org-archive-mark-done', shown: String(setting('org-archive-mark-done') || 'nil'),
  help: 'nil leaves the state alone. t marks a TODO heading with the first done keyword before it is archived; a keyword such as CANCELLED uses that one.',
  check: (v) => { if (v === 'nil' || v === '') return ''; if (v === 't' || /^[A-Z][A-Z0-9_-]*$/.test(v)) return v; throw new Error('Use nil, t or a keyword such as DONE'); },
  said: (v) => `Archive marks done: ${v || 'nil'}` });

const archiveContextDialog = () => lineSetting({ title: 'Archive saves', key: 'org-archive-save-context-info', shown: archiveContext().join(' ') || 'nil',
  help: `The properties kept on an archived entry, separated by spaces: ${ARCHIVE_CONTEXT.join(' ')}. nil saves none.`,
  check: (v) => { if (v === 'nil') return 'nil'; const names = v.split(/\s+/).filter(Boolean); const bad = names.find((n) => !ARCHIVE_CONTEXT.includes(n)); if (bad) throw new Error(`${bad} is not one of ${ARCHIVE_CONTEXT.join(' ')}`); return names.join(' ') === ARCHIVE_CONTEXT.join(' ') ? '' : names.join(' '); },
  said: (v) => `Archive saves: ${v === 'nil' ? 'nothing' : v || 'everything'}` });

async function refileNewDialog() {
  const v = await choose('Refile new headings', [{ label: 'Not allowed', value: 'nil' }, { label: 'Ask first', value: 'confirm' }, { label: 'Allowed', value: 't' }]);
  if (v === undefined) return;
  config.update({ settings: { 'org-refile-allow-creating-parent-nodes': v === 'nil' ? '' : v } });
  message(`Refile new headings: ${{ nil: 'not allowed', confirm: 'ask first', t: 'allowed' }[v]}`);
}

async function dateStyleDialog() {
  const v = await choose('Date style', [{ label: 'American', meta: 'Nov 5, 2026 and 11/5/2026', value: 'american' }, { label: 'European', meta: '5 Nov 2026 and 5/11/2026', value: 'european' }, { label: 'ISO', meta: '2026-11-05', value: 'iso' }]);
  if (v === undefined) return;
  config.update({ settings: { 'calendar-date-style': v === 'american' ? '' : v } });
  message(`Date style: ${v}`);
}

async function holidaysDialog() {
  for (;;) {
    const on = holidayKinds();
    const v = await choose('Holidays', HOLIDAY_KINDS.map(([value, label]) => ({ label, meta: on.includes(value) ? 'On' : 'Off', value })));
    if (v === undefined) return;
    const next = HOLIDAY_KINDS.map((k) => k[0]).filter((k) => (k === v ? !on.includes(k) : on.includes(k)));
    config.update({ settings: { 'calendar-holidays': next.length === HOLIDAY_KINDS.length ? '' : next.length ? next.join(' ') : 'nil' } });
  }
}

const localHolidaysDialog = () => lineSetting({ title: 'Local holidays', key: 'holiday-local-holidays', shown: localHolidays(),
  help: 'Your own holidays as Emacs forms, for example (holiday-fixed 3 14 "Pi Day") (holiday-float 11 4 4 "Fourth Thursday"). Empty means none.',
  check: (v) => v, said: (v) => (v ? 'Local holidays set' : 'No local holidays') });

const contactFilesDialog = () => lineSetting({ title: 'Contacts files', key: 'org-contacts-files', shown: contactFiles().join(' '),
  help: 'The files with your contacts, as storage names such as github:contacts.org, separated by spaces. Empty means none.',
  check: (v) => v, said: (v) => (v ? 'Contacts files set' : 'No contacts files') });

const birthdayPropertyDialog = () => lineSetting({ title: 'Birthday property', key: 'org-contacts-birthday-property', shown: contactProperty(),
  help: 'The property of a contact that holds the birthday, for use by org-contacts-anniversaries. Empty means BIRTHDAY.',
  check: (v) => v, said: (v) => `Birthday property is ${v || 'BIRTHDAY'}` });

const diaryFileDialog = () => lineSetting({ title: 'Diary file', key: 'diary-file', shown: diaryFile(),
  help: 'The file with your diary entries, as a storage name such as github:diary. Empty means none.',
  check: (v) => v, said: (v) => (v ? `Diary file is ${v}` : 'No diary file') });

async function archiveLocationDialog() {
  const value = await panel((sheet, close) => {
    const input = h('input', { value: archiveLocation(), autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Archive location' });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); close(input.value); } });
    put(sheet, h('h2', {}, 'Archive location'),
      h('p', {}, 'A file and a heading separated by ::. %s is the name of the file. The default is %s_archive::'), input,
      h('div', { class: 'row' }, h('button', { onclick: () => close(undefined) }, '‹ Emacs'), h('button', { onclick: () => close(RESET) }, 'Reset'), h('button', { class: 'primary', onclick: () => close(input.value) }, 'Set')));
    input.focus();
  });
  if (value === undefined) return;
  if (value === RESET) { config.update({ settings: { 'org-archive-location': '' } }); message('Archive location is %s_archive::'); return; }
  if (!value.includes('::')) { message('The archive location needs ::', true); return; }
  config.update({ settings: { 'org-archive-location': value === '%s_archive::' ? '' : value } });
}

// ---- The agenda ---------------------------------------------------------------------------------

const agendaState = { kind: 'agenda', span: 'week', anchor: null, match: '', words: '', keyword: null, filter: noFilter(), marking: false, marked: new Set() };
const entryKey = (e) => `${e.file}:${e.line}`;
const mondayOf = (d) => new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86400000);
/** The category Org gives a file: its name without the folder and the extension. */
const categoryOfName = (name) => parseName(name).path.replace(/^.*\//, '').replace(/\.[^.]*$/, '');

/** org-agenda-files: storage names, kept as the Lisp list that init.el would set. */
const agendaFileNames = () => parseStringList(config.settings()['org-agenda-files'] ?? '()');
const setAgendaFileNames = (names) => config.update({ settings: { 'org-agenda-files': formatStringList(names) } });

/** Puts a file first on the list (Emacs: org-agenda-file-to-front). */
function addAgendaFile(name) {
  setAgendaFileNames([name, ...agendaFileNames().filter((n) => n !== name)]);
}

/** The files the agenda covers: those on the list, taking the text of an open one from its tab. */
/** A file's saved copy at once; storage is asked afterward so the next read is current. */
function readSaved(name) {
  const r = app.storage.read(name, { cached: true });
  r.then(() => app.storage.read(name)).catch(() => {});
  return r;
}
async function agendaSources() {
  const files = [];
  const unread = [];
  for (const name of agendaFileNames()) {
    const open = session.state().buffers.find((b) => b.name === name);
    if (open) { files.push({ id: open.id, name, category: categoryOfName(name), text: open.text }); continue; }
    try {
      const r = await readSaved(name);
      if (r) files.push({ id: null, name, category: categoryOfName(name), text: r.text });
      else unread.push(`${name} (not found)`);
    } catch (e) { unread.push(`${name} (${e.message})`); }
  }
  if (unread.length) message(`Cannot read ${unread.join(', ')}`, true);
  return files;
}
/** The diary file's text when the agenda includes the diary: { name, text, style }, or null. */
async function diaryData() {
  contactTexts = [];
  for (const name of contactFiles()) {
    const open = session.state().buffers.find((b) => b.name === name);
    try {
      const r = open ? { text: open.text } : await readSaved(name);
      if (r) contactTexts.push(r.text); else message(`Cannot read ${name} (not found)`, true);
    } catch (e) { message(`Cannot read ${name} (${e.message})`, true); }
  }
  diaryText = null;
  if (!diaryOn() || !diaryFile()) return null;
  const open = session.state().buffers.find((b) => b.name === diaryFile());
  try {
    const r = open ? { text: open.text } : await readSaved(diaryFile());
    if (!r) { message(`Cannot read ${diaryFile()} (not found)`, true); return null; }
    diaryText = { name: diaryFile(), text: r.text, style: dateStyle() };
  } catch (e) { message(`Cannot read ${diaryFile()} (${e.message})`, true); }
  return diaryText;
}
const SPANS = [['day', 'Day'], ['week', 'Week'], ['fortnight', '2 weeks'], ['month', 'Month'], ['year', 'Year']];
const weekly = (span) => span === 'week' || span === 'fortnight';

/** Moves the agenda's start by one span, forward or back. */
/** The agenda goes to the span that holds today (Emacs: .). */
function agendaToday() {
  const t = todayDate();
  agendaState.anchor = agendaState.span === 'month' ? new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1)) : t;
}

function agendaMove(dir) {
  const a = agendaState.anchor;
  const sp = agendaState.span;
  agendaState.anchor = sp === 'day' ? new Date(a.getTime() + dir * 86400000)
    : sp === 'month' ? new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth() + dir, 1))
    : sp === 'year' ? new Date(Date.UTC(a.getUTCFullYear() + dir, 0, 1)) : new Date(a.getTime() + dir * (sp === 'fortnight' ? 14 : 7) * 86400000);
}

/** Opens the agenda at a view; the tags and search views ask first. */
async function openAgenda(kind) {
  if (kind === 'tags' || kind === 'search') {
    const text = await askText({ prompt: kind === 'tags' ? 'Match:' : 'Search words:', title: kind === 'tags' ? 'Show headings by tag' : 'Search headings', help: kind === 'tags' ? 'Tags such as work+urgent or work|home, then / and TODO keywords.' : 'Words that must all appear in a heading and its text.', ok: 'Show' });
    if (text === undefined || text === '') return;
    if (kind === 'tags') agendaState.match = text; else agendaState.words = text;
  }
  agendaState.kind = kind;
  agendaState.keyword = null;
  await agendaScreen();
}

/** Listeners for a mostly sideways swipe: left asks for 1 (later), right for -1 (earlier). Returns the properties to put on the element. */
function sidewaysSwipe(onSwipe) {
  let from = null;
  return {
    onpointerdown: (e) => { from = { x: e.clientX, y: e.clientY }; },
    onpointercancel: () => { from = null; },
    onpointerup: (e) => {
      if (!from) return;
      const dx = e.clientX - from.x;
      const dy = e.clientY - from.y;
      from = null;
      if (Math.abs(dx) >= 60 && Math.abs(dx) > 1.5 * Math.abs(dy)) onSwipe(dx < 0 ? 1 : -1);
    },
  };
}

/** The agenda over the agenda files: a full screen of rows for the dates, the TODO list, tags or a search. Tapping a row goes to that heading. */
async function agendaScreen(loaded = null) {
  agendaState.anchor ??= todayDate();
  let files = loaded?.files;
  try { files ??= await agendaSources(); } catch (e) { failure(e); return; }
  let diary = loaded?.diary ?? await diaryData();
  for (;;) {
    const st = agendaState;
    let view;
    try {
      view = st.kind === 'todo' ? todoList(files, { keyword: st.keyword, filter: st.filter, prefix: prefixOpts() }) : st.kind === 'tags' ? tagsView(files, { match: st.match, filter: st.filter, prefix: prefixOpts() }) : st.kind === 'search' ? searchView(files, { words: st.words, filter: st.filter, prefix: prefixOpts() })
        : agenda(files, { start: weekly(st.span) ? mondayOf(st.anchor) : st.anchor, span: st.span, today: todayDate(), now: localClock(), timeGrid: timeGridOn(), filter: st.filter, prefix: prefixOpts(), diary, holidays: holidaysInAgenda() ? holidayOpts() : null, contacts: contactOpts() });
    } catch (e) { failure(e); st.kind = 'agenda'; return; }
    let onMoveKey = null;
    const act = await panel((sheet, close) => {
      sheet.classList.add('full', 'agenda');
      if (st.kind === 'agenda') {
        // f and b move later and earlier and . goes to today, as in the Emacs agenda; a sideways swipe on the rows does the same.
        onMoveKey = (e) => {
          if (e.ctrlKey || e.metaKey || e.altKey || !['f', 'b', '.'].includes(e.key)) return;
          e.preventDefault(); e.stopPropagation();
          close(e.key === '.' ? { today: true } : { move: e.key === 'f' ? 1 : -1 });
        };
        document.addEventListener('keydown', onMoveKey, true);
      }
      const counter = h('button', { class: 'primary', onclick: () => close({ act: true }) }, '');
      const count = () => { counter.textContent = `Act on ${st.marked.size}`; counter.disabled = st.marked.size === 0; };
      const all = view.days ? view.days.flatMap((d) => d.entries) : view.entries;
      const cols = phoneColumns(prefixOpts().formats[st.kind], all, prefixOpts().icons);
      const phoneRow = (c, e) => phoneCells(c, e, prefixOpts().icons).map((t, i) => h('span', { class: `acol${c[i].spec === 't' && e.late > 0 && e.kind !== 'stamp' ? ' late' : ''}`, style: `width:${c[i].width}ch` }, t));
      const row = (e) => h('button', { class: `arow${st.marking && st.marked.has(entryKey(e)) ? ' marked' : ''}`, 'aria-pressed': st.marking ? String(st.marked.has(entryKey(e))) : null, onclick: (ev) => {
        if (!st.marking) { close({ jump: e }); return; }
        const k = entryKey(e);
        if (st.marked.has(k)) st.marked.delete(k); else st.marked.add(k);
        ev.currentTarget.classList.toggle('marked', st.marked.has(k)); ev.currentTarget.setAttribute('aria-pressed', String(st.marked.has(k))); count();
      } },
        ...phoneRow(cols, e),
        h('span', { class: 'atitle' }, [e.todo, e.priority ? `[#${e.priority}]` : null, e.title].filter(Boolean).join(' ')),
        e.tags.length ? h('span', { class: 'atags' }, `:${e.tags.join(':')}:`) : null);
      const body = st.kind === 'agenda'
        ? view.days.flatMap((d) => [h('div', { class: `aday${d.today ? ' today' : ''}` }, d.head), ...d.rows.map((r) => (r.entry ? row(r.entry) : h('div', { class: `agrid${r.text.includes(' now') ? ' now' : ''}` }, h('span', { class: 'agtime' }, r.text.trim().replace(/\.{6}.*$/, '') + (r.text.includes(' now') ? ' now' : '')), h('span', { class: 'agline' }))))])
        : view.entries.length ? view.entries.map(row) : [h('p', { class: 'aempty' }, 'No entries')];
      const nav = st.kind === 'agenda' ? [h('button', { 'aria-label': 'Earlier', onclick: () => close({ move: -1 }) }, h('span', { class: 'chev left' })), h('button', { 'aria-label': 'Later', onclick: () => close({ move: 1 }) }, h('span', { class: 'chev right' }))] : [];
      put(sheet,
        h('div', { class: 'abar' }, nav[0] ?? null, st.kind === 'agenda' ? h('button', { onclick: () => close({ today: true }) }, 'Today') : null, h('div', { class: 'atitlebar' }, `${view.title.replace(/:$/, '')}${filterActive(st.filter) ? ` ${filterLabel(st.filter)}` : ''}`), nav[1] ?? null),
        Object.assign(h('div', { class: 'abody' }, ...body), st.kind === 'agenda' ? sidewaysSwipe((dir) => close({ move: dir })) : {}),
        st.kind === 'agenda' ? h('div', { class: 'abar' }, ...SPANS.map(([v, l]) => h('button', { class: st.span === v ? 'primary' : '', onclick: () => close({ span: v }) }, l))) : null,
        h('div', { class: 'abar' },
          ...(st.marking ? [h('button', { onclick: () => close({ markAll: true }) }, 'All'), h('button', { onclick: () => close({ markNone: true }) }, 'None'), counter, h('button', { onclick: () => close({ marking: false }) }, 'Done')]
            : [h('button', { onclick: () => close({ filter: true }) }, filterActive(st.filter) ? 'Filter ●' : 'Filter'), h('button', { onclick: () => close({ marking: true }) }, 'Mark'),
              h('button', { onclick: () => close({ views: true }) }, 'Views'), h('button', { onclick: () => close(undefined) }, 'Close')])));
      count();
    });
    if (onMoveKey) document.removeEventListener('keydown', onMoveKey, true);
    if (!act) return;
    if (act.today) agendaToday();
    else if (act.move) agendaMove(act.move);
    else if (act.filter) await agendaFilterDialog(st);
    else if (act.marking !== undefined) { st.marking = act.marking; if (!act.marking) st.marked.clear(); }
    else if (act.markNone) st.marked.clear();
    else if (act.markAll) for (const e of view.days ? view.days.flatMap((d) => d.entries) : view.entries) st.marked.add(entryKey(e));
    else if (act.act) { await bulkAction(st, files, view); st.marked.clear(); st.marking = false; try { files = await agendaSources(); diary = await diaryData(); } catch (e) { failure(e); return; } }
    else if (act.span) { st.span = act.span; if (weekly(act.span)) st.anchor = mondayOf(st.anchor); }
    else if (act.views) {
      const v = await choose('Views', [{ label: 'Agenda', value: 'agenda' }, { label: 'TODO list', value: 'todo' }, { label: 'Tags', value: 'tags' }, { label: 'Search', value: 'search' }]);
      if (v === 'tags' || v === 'search') {
        const text = await askText({ prompt: v === 'tags' ? 'Match:' : 'Search words:', title: v === 'tags' ? 'Show headings by tag' : 'Search headings', help: v === 'tags' ? 'Tags such as work+urgent or work|home, then / and TODO keywords.' : 'Words that must all appear in a heading and its text.', ok: 'Show' });
        if (text === undefined || text === '') continue;
        if (v === 'tags') st.match = text; else st.words = text;
      }
      if (v) { st.kind = v; st.keyword = null; }
    } else if (act.jump) {
      await jumpTo(files, act.jump, 'agenda');
      return;
    }
  }
}

/** Opens the heading of an agenda or calendar entry in the Text view; Back returns to `from`. */
async function jumpTo(files, e, from) {
  leaveHere();
  places.push({ kind: from });
  showBack();
  const f = e.diary ? { id: session.state().buffers.find((b) => b.name === diaryFile())?.id ?? null, name: diaryFile() } : files[e.file];
  let id = f.id;
  if (id === null) {
    const opened = await openFile(f.name);
    if (!opened.ok) { failure(new Error(`${f.name} does not exist`)); return; }
    id = opened.id;
  }
  session.select(id);
  setView('text');
  placeCursor(e.line);
}

// ---- The calendar -----------------------------------------------------------------------------------

const calendarState = { y: null, m: null, day: null };
const isoOf = (d) => d.toISOString().slice(0, 10);

/** A month to look at: a dot under each day that has something in the agenda files, and the entries of the day you tap. */
async function calendarScreen() {
  const t = todayDate();
  calendarState.y ??= t.getUTCFullYear(); calendarState.m ??= t.getUTCMonth() + 1; calendarState.day ??= isoOf(t);
  let files;
  try { files = await agendaSources(); } catch (e) { failure(e); return; }
  const diary = await diaryData();
  for (;;) {
    const { y, m } = calendarState;
    const view = agenda(files, { start: new Date(Date.UTC(y, m - 1, 1)), span: 'month', today: todayDate(), now: null, timeGrid: false, diary, contacts: contactOpts() });
    const byDay = new Map(view.days.map((d) => [isoOf(d.date), d.entries]));
    const hol = new Map();
    for (const x of holidayList(y, m, holidayOpts())) { const k = `${x.y}-${String(x.m).padStart(2, '0')}-${String(x.d).padStart(2, '0')}`; hol.set(k, [...(hol.get(k) ?? []), x.name]); }
    const act = await panel((sheet, close) => {
      sheet.classList.add('full', 'calendar');
      const two = (n) => String(n).padStart(2, '0');
      const cell = (c) => {
        const iso = `${c.y}-${two(c.m)}-${two(c.d)}`;
        const here = (byDay.get(iso) ?? []).filter((e) => !e.quiet);
        const marks = [here.some((e) => e.birthday) ? 'birthday' : null, hol.has(iso) || here.some((e) => e.holiday) ? 'holiday' : null, here.some((e) => !e.birthday && !e.holiday) ? 'other' : null].filter(Boolean);
        return h('button', { class: `day${c.other ? ' other' : ''}${iso === isoOf(t) ? ' today' : ''}${iso === calendarState.day ? ' on' : ''}`, 'aria-label': iso, onclick: () => close({ day: iso }) },
          h('span', { class: 'dn' }, String(c.d)), h('span', { class: 'marks' }, ...marks.map((k) => h('i', { class: k }))));
      };
      const picked = byDay.get(calendarState.day) ?? [];
      const holidays = (hol.get(calendarState.day) ?? []).map((n) => ({ category: 'Diary', title: n, tags: [], holiday: true }));
      const cols = phoneColumns(prefixOpts().formats.agenda, [...holidays, ...picked], prefixOpts().icons);
      const phoneRow = (c, e) => phoneCells(c, e, prefixOpts().icons).map((t, i) => h('span', { class: `acol${c[i].spec === 't' && e.late > 0 && e.kind !== 'stamp' ? ' late' : ''}`, style: `width:${c[i].width}ch` }, t));
      const row = (e) => h(e.holiday ? 'div' : 'button', { class: `arow${e.holiday ? ' holiday' : ''}`, ...(e.holiday ? {} : { onclick: () => close({ jump: e }) }) },
        ...phoneRow(cols, e),
        h('span', { class: 'atitle' }, [e.todo, e.priority ? `[#${e.priority}]` : null, e.title].filter(Boolean).join(' ')),
        e.tags.length ? h('span', { class: 'atags' }, `:${e.tags.join(':')}:`) : null);
      put(sheet,
        h('div', { class: 'abar' }, h('button', { 'aria-label': 'Earlier', onclick: () => close({ move: -1 }) }, h('span', { class: 'chev left' })), h('div', { class: 'atitlebar' }, `${MONTH_NAMES[m - 1]} ${y}`), h('button', { 'aria-label': 'Later', onclick: () => close({ move: 1 }) }, h('span', { class: 'chev right' }))),
        Object.assign(h('div', { class: 'abody' },
          h('div', { class: 'cal' }, ...['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((n) => h('span', { class: 'dow' }, n)), ...monthGrid(y, m).map(cell)),
          h('div', { class: 'aday' }, calendarState.day),
          ...(picked.length || holidays.length ? [...holidays, ...picked].map(row) : [h('p', { class: 'aempty' }, 'Nothing on this day')])), sidewaysSwipe((dir) => close({ move: dir }))),
        h('div', { class: 'abar' }, h('button', { onclick: () => close({ today: true }) }, 'Today'), h('button', { onclick: () => close({ agenda: true }) }, 'Agenda'), h('button', { onclick: () => close(undefined) }, 'Close')));
    });
    if (!act) return;
    if (act.move) { const n = stepMonth(y, m, act.move); calendarState.y = n.y; calendarState.m = n.m; }
    else if (act.today) { calendarState.y = t.getUTCFullYear(); calendarState.m = t.getUTCMonth() + 1; calendarState.day = isoOf(t); }
    else if (act.day) { calendarState.day = act.day; const [yy, mm] = act.day.split('-').map(Number); calendarState.y = yy; calendarState.m = mm; }
    else if (act.agenda) { agendaState.kind = 'agenda'; agendaState.span = 'day'; agendaState.anchor = new Date(`${calendarState.day}T00:00:00Z`); await agendaScreen({ files, diary }); return; }
    else if (act.jump) { await jumpTo(files, act.jump, 'calendar'); return; }
  }
}


/** The Filter button: by tag, category, effort or regexp, typed as Emacs's / commands take them; Clear removes them all. */
async function agendaFilterDialog(st) {
  const f = st.filter;
  const v = await choose('Filter', [
    { label: 'Tag', meta: filterLabel({ ...noFilter(), tags: f.tags }) || null, value: 'tags' }, { label: 'Category', meta: filterLabel({ ...noFilter(), category: f.category }) || null, value: 'category' },
    { label: 'Effort', meta: f.effort ? `${f.effort.op}${f.effort.minutes} min` : null, value: 'effort' }, { label: 'Regexp', meta: filterLabel({ ...noFilter(), regexp: f.regexp }) || null, value: 'regexp' },
    ...(filterActive(f) ? [{ label: 'Clear all filters', value: 'clear' }] : []),
  ]);
  if (v === undefined) return;
  if (v === 'clear') { st.filter = noFilter(); return; }
  const help = { tags: 'Tags to keep (+work) or hide (-home), separated by spaces. Empty removes the tag filter.', category: 'A category to keep (+calls) or hide (-calls).',
    effort: 'An effort limit such as <1:00, >0:30 or =2:00. Empty removes it.', regexp: 'An Emacs regexp the line must match (+rent) or must not match (-rent).' }[v];
  const typed = await askText({ prompt: `${v === 'tags' ? 'Tag' : v === 'category' ? 'Category' : v === 'effort' ? 'Effort' : 'Regexp'}:`, title: `Filter by ${v === 'tags' ? 'tag' : v}`, help, ok: 'Filter' });
  if (typed === undefined) return;
  try { st.filter = { ...f, [v]: v === 'effort' ? (typed.trim() ? parseEffort(typed) : null) : parseSigned(typed) }; } catch (e) { failure(e); }
}

/** The actions on the marked entries (Emacs: B): each is done to every entry in the order marked, and the rest of the lines are kept in step. */
async function bulkAction(st, files, view) {
  const all = view.days ? view.days.flatMap((d) => d.entries) : view.entries;
  const byKey = new Map(all.map((e) => [entryKey(e), e]));
  const marked = [...st.marked].map((k) => byKey.get(k)).filter((e) => e && !e.diary && e.kind !== 'sexp');
  if (!marked.length) return;
  const words = [...new Set(files.flatMap((f) => { const a = analyze(f.text); return [...a.todo.open, ...a.todo.done]; }))];
  const what = await choose(`${marked.length} marked`, [
    { label: 'TODO state', value: 'todo' }, { label: 'Add tag', value: 'tag+' }, { label: 'Remove tag', value: 'tag-' }, { label: 'Priority', value: 'priority' },
    { label: 'Schedule', value: 'schedule' }, { label: 'Deadline', value: 'deadline' }, { label: 'Archive', value: 'archive' },
  ]);
  if (what === undefined) return;
  let edit;
  if (what === 'todo') {
    const state = await choose('TODO state', [...words.map((w) => ({ label: w, value: w })), { label: 'None', value: '' }]);
    if (state === undefined) return;
    edit = (t, l) => { let cur = t; for (let i = 0; i < 30; i++) { const hd = analyze(cur).heads.find((x) => x.line === l); if ((hd?.todo ?? '') === state) break; cur = cycleTodo(cur, l, 1, tagsColumn()).text; } return { text: cur }; };
  } else if (what === 'tag+' || what === 'tag-') {
    const typed = await askText({ prompt: 'Tag:', title: what === 'tag+' ? 'Add tag' : 'Remove tag', ok: 'Set' });
    if (typed === undefined || !typed.trim()) return;
    const tag = typed.trim();
    if (!/^[\p{L}\p{N}_@#%]+$/u.test(tag)) { message('Tags can have letters, digits and _ @ # %', true); return; }
    edit = (t, l) => { const tags = analyze(t).heads.find((x) => x.line === l).tags; return setTags(t, l, what === 'tag+' ? [...new Set([...tags, tag])] : tags.filter((x) => x !== tag), tagsColumn()); };
  } else if (what === 'priority') {
    const p = await choose('Priority', [...['A', 'B', 'C'].map((x) => ({ label: x, value: x })), { label: 'None', value: '' }]);
    if (p === undefined) return;
    edit = (t, l) => setPriority(t, l, p === '' ? null : p, tagsColumn());
  } else if (what === 'schedule' || what === 'deadline') {
    const stamp = await askStamp(what === 'schedule' ? 'SCHEDULED' : 'DEADLINE');
    if (stamp === null) return;
    edit = (t, l) => setPlanning(t, l, what === 'schedule' ? 'SCHEDULED' : 'DEADLINE', stamp);
  }
  const pending = marked.map((e) => ({ file: e.file, line: e.line }));
  let done = 0;
  const texts = files.map((f) => f.text);
  const created = [];
  for (let i = 0; i < pending.length; i++) {
    const { file, line } = pending[i];
    const before = texts[file];
    let after;
    if (what === 'archive') {
      const f = files[file];
      const loc = archiveLocation();
      const archName = loc.slice(0, loc.indexOf('::')).replace('%s', f.name);
      const r = archiveSubtree(before, line, { fileName: f.name, category: f.category, location: loc, now: localNow(), archiveText: created.find((c) => c.file === archName)?.text ?? (await bufferFor(archName))?.text ?? null, column: tagsColumn(), markDone: archiveMarkDone(), contextInfo: archiveContext() });
      after = r.text;
      if (r.archive) { const c = created.find((x) => x.file === r.archive.file); if (c) c.text = r.archive.text; else created.push({ file: r.archive.file, text: r.archive.text }); }
    } else after = edit(before, line).text;
    texts[file] = after;
    const grew = after.split('\n').length - before.split('\n').length;
    if (grew) for (let j = i + 1; j < pending.length; j++) if (pending[j].file === file && pending[j].line > line) pending[j].line += grew;
    done++;
  }
  for (const [i, f] of files.entries()) {
    if (texts[i] === f.text) continue;
    let id = f.id;
    if (id === null) { const opened = await openFile(f.name); if (!opened.ok) { failure(new Error(`${f.name} does not exist`)); continue; } id = opened.id; }
    session.apply(id, { text: texts[i] });
  }
  for (const c of created) { const b = await bufferFor(c.file); if (b) session.apply(b.id, { text: c.text }); else session.createFile(c.file, c.text); }
  message(`Acted on ${done} entries`);
}

// ---- Structure commands, the Outline view's taps, and the Emacs keys ------------------------------------

const lineOffset = (text, line) => {
  let i = 0;
  for (let n = 0; n < line; n++) {
    const j = text.indexOf('\n', i);
    if (j < 0) return text.length;
    i = j + 1;
  }
  return i;
};

/** Puts the cursor at the start (or end) of a line of the real text, in the Text view. */
function placeCursor(line, atEnd = false) {
  const b = currentBuffer();
  const at = atEnd ? Math.max(lineOffset(b.text, line), lineOffset(b.text, line + 1) - (line + 1 < b.text.split('\n').length ? 1 : 0)) : lineOffset(b.text, line);
  const p = toShown(cur.proj, at);
  editor.setSelectionRange(p, p);
  showCaret(p);
  renderModeLine();
}

/** Runs an edit on the current buffer; its folds move with the lines. */
function runEdit(fn) {
  const b = currentBuffer();
  lastCycle = null;
  try {
    const r = fn(b.text);
    if (r) session.apply(b.id, r);
    return r;
  } catch (e) { failure(e); return null; }
}

/** The line at the cursor and what it is: a heading, a list item, or neither. */
const kindAtCursor = () => {
  const line = lineAt(cur.proj, editor.selectionStart);
  return { line, kind: cur.a.heads.some((x) => x.line === line) ? 'heading' : cur.a.items.some((x) => x.line === line) ? 'item' : cur.a.drawers.some((x) => x.line === line) ? 'drawer' : null };
};


/** The table line the cursor is on and its column, or null. Table lines inside blocks are not table lines. */
const tableHere = () => {
  const line = lineAt(cur.proj, editor.selectionStart);
  const t = cur.a.nodes[line]?.type;
  if (t !== 'table-row' && t !== 'table-rule') return null;
  return { line, col: cursorOffset() - lineOffset(currentBuffer().text, line) };
};

/** Runs a table edit `fn(text, line, col)` at a line and column and puts the cursor where it says (in the Text view); an error is shown after the edit. */
function tableEditAt(line, col, fn, { place = true } = {}) {
  const text = currentBuffer().text;
  let r;
  try { r = fn(text, line, col); } catch (e) { failure(e); return; }
  if (r.text !== text) session.apply(currentBuffer().id, { text: r.text });
  lastCycle = null;
  if (place) placeOffset(lineOffset(r.text, r.line) + r.col);
  if (r.error) message(r.error, true);
}

/** The same at the cursor. */
function tableEdit(fn) {
  const at = tableHere();
  if (!at) { message('Not in table', true); return; }
  tableEditAt(at.line, at.col, fn);
}

const inTable = () => viewMode() === 'text' && tableHere() !== null;

/** C-c ^: asks how to sort, then sorts the rows of the section at the cursor. */
async function tableSort() {
  if (!tableHere()) { message('Not in table', true); return; }
  const kinds = [['a', 'Alphabetic'], ['n', 'Numeric'], ['t', 'Time'], ['f', 'With a function'], ['A', 'Alphabetic, reversed'], ['N', 'Numeric, reversed'], ['T', 'Time, reversed'], ['F', 'With a function, reversed']];
  const v = await askText({ prompt: 'Sort table:', title: 'Sort table', help: 'a, n, t or f for alphabetic, numeric, time or function order. A capital letter reverses it.', ok: 'Sort', key: /^[antfANTF]$/,
    complete: (t) => kinds.filter(([k]) => t === '' || k === t).map(([k, label]) => ({ label, value: k, hint: k })), showAll: true });
  if (v === undefined) return;
  const k = v.trim();
  if (!/^[antfANTF]$/.test(k)) { message('Invalid sorting type', true); return; }
  if (k.toLowerCase() !== 'f') { tableEdit((t, l, c) => table.sortRows(t, l, c, k)); return; }
  const options = (rows) => (t) => rows.filter(([n]) => n.startsWith(t.trim())).map(([n, d]) => ({ label: n === '' ? '(empty)' : n, value: n, hint: d }));
  const keyName = await askText({ prompt: 'Function for extracting keys:', title: 'Sort with a function', help: 'Tap one: it says how the rows will be ordered.', ok: 'Next', complete: options(table.SORT_KEY_HELP), showAll: true });
  if (keyName === undefined) return;
  const compareName = await askText({ prompt: "Function for comparing keys (empty for default `sort-subr' predicate):", title: 'Sort with a function', help: 'Leave it empty to compare numbers with < and text with string<.', ok: 'Sort', complete: options(table.SORT_COMPARE_HELP), showAll: true });
  if (compareName === undefined) return;
  let fn;
  try { fn = table.sortFunctions(keyName, compareName); } catch (e) { message(e.message, true); return; }
  tableEdit((t, l, c) => table.sortRows(t, l, c, k, fn));
}

const columnName = (n) => { let s = ''; for (let k = n + 1; k > 0; k = Math.floor((k - 1) / 26)) s = String.fromCharCode(65 + ((k - 1) % 26)) + s; return s; };

/** C-c ^ f in the Outline view: two lists, each line saying how the rows will be ordered; undefined when cancelled. */
async function chooseSortFunctions() {
  const key = await choose('Sort by', table.SORT_KEY_HELP.map(([n, d]) => ({ label: n, meta: d, value: n })));
  if (key === undefined) return undefined;
  const compare = await choose('Compare with', table.SORT_COMPARE_HELP.map(([n, d]) => ({ label: n === '' ? 'Default' : n, meta: d, value: n === '' ? 'default' : n })));
  if (compare === undefined) return undefined;
  return table.sortFunctions(key, compare === 'default' ? '' : compare);
}

// ---- Keep files offline -------------------------------------------------------------------------

/** The files kept offline, as storage names: the setting, or while it is unset the GitHub and WebDAV files that are open. */
const offlineFiles = () => {
  const v = setting('serita-offline-files');
  if (v !== undefined && v !== '') return v === 'nil' ? [] : v.split(/\s+/);
  return session.state().buffers.map((b) => b.name).filter((n) => n && /^(github|webdav):/.test(n));
};

async function offlineDialog() {
  const names = [];
  for (const p of ['github', 'webdav']) {
    if (!(p in providers)) continue;
    try { for (const e of await app.storage.entries(`${p}:`)) if (!e.folder && /\.org$/i.test(e.name)) names.push(e.name); } catch { /* a source that cannot be listed shows no files */ }
  }
  let on = new Set(offlineFiles().filter((n) => names.includes(n)));
  const state = new Map(); // name -> 'fetching' | 'saved' | 'failed'
  const save = () => config.update({ settings: { 'serita-offline-files': on.size ? [...on].join(' ') : 'nil' } });
  await panel((sheet, close) => {
    const draw = () => {
      const total = on.size;
      const done = [...on].filter((n) => state.get(n) === 'saved').length;
      const busy = [...on].some((n) => state.get(n) === 'fetching');
      const label = (n) => (!on.has(n) ? 'Off' : state.get(n) === 'fetching' ? 'On · fetching' : state.get(n) === 'saved' ? 'On · saved' : state.get(n) === 'failed' ? 'On · not saved' : 'On');
      put(sheet, h('h2', {}, 'Keep files offline'),
        h('div', { class: 'list' }, ...(names.length ? names.map((n) => h('button', { class: 'item', onclick: () => { if (on.has(n)) on.delete(n); else on.add(n); state.delete(n); save(); draw(); } }, h('span', {}, n.replace(/^[a-z]+:/, '')), h('span', { class: 'meta' }, label(n)))) : [h('p', {}, 'No Org files found. Set up GitHub or WebDAV first.')])),
        total ? h('progress', { max: total, value: done }) : null,
        total ? h('p', { class: 'meta' }, `${done} of ${total} saved`) : null,
        h('div', { class: 'row' }, h('button', { disabled: busy || !total, onclick: fetchAll }, 'Fetch now'), h('button', { onclick: () => close(undefined) }, 'Close')));
    };
    async function fetchAll() {
      for (const n of on) state.set(n, 'fetching');
      draw();
      await Promise.all([...on].map(async (n) => { try { await app.storage.read(n); state.set(n, 'saved'); } catch { state.set(n, 'failed'); } draw(); }));
    }
    draw();
  });
}

// ---- Table formulas -----------------------------------------------------------------------------

const formulaCount = (text, line) => { const n = tblcmd.formulasOf(text, line)?.length ?? 0; return n === 0 ? '' : `${n} formula${n === 1 ? '' : 's'}`; };

/** The table line (or #+TBLFM: line) the cursor is on, or null. */
const formulaHere = () => {
  const at = lineAt(cur.proj, editor.selectionStart);
  const b = currentBuffer();
  return tblcmd.formulaLines(b.text, at) ? { line: at, col: cursorOffset() - lineOffset(b.text, at) } : null;
};

/** Recalculates the table at a line in the given mode and shows what Org says. Returns false when it could not. */
async function recalculateAt(line, col, mode, { place = true } = {}) {
  let said = null;
  let opts = {};
  if (formulaDebug && mode !== 'iterate') {
    const trace = tblcmd.recalculate(currentBuffer().text, line, mode, { trace: [] }).trace ?? [];
    for (let i = 0; i < trace.length; i++) {
      if (!(await debugSheet(trace[i], i + 1, trace.length))) { opts = { trace: [], limit: i }; break; }
    }
  }
  tableEditAt(line, col, (text, l, c) => {
    const r = tblcmd.recalculate(text, l, mode, opts);
    said = r.message ?? null;
    return { text: r.text, line: l, col: c, error: r.error };
  }, { place });
  if (said) message(said);
}

/** The formula debugger's question for one field: its substitution history, then Continue or Stop (the x also stops). */
function debugSheet(rec, n, total) {
  return panel((sheet, close) => {
    put(sheet, h('h2', {}, 'Debugging formula'),
      h('p', { class: 'meta' }, `Field ${rec.field}${total > 1 ? ` · ${n} of ${total}` : ''}`),
      h('pre', { class: 'mono' }, tblcmd.historyText(rec).split('\n').slice(1).join('\n')),
      h('p', {}, 'Continue to the next field, or stop here. Stopping keeps the fields already calculated. Turn debugging off with C-c {.'),
      h('div', { class: 'row' }, h('button', { onclick: () => close(false) }, 'Stop'), h('button', { class: 'primary', onclick: () => close(true) }, 'Continue')));
  }).then((v) => v === true);
}

/** C-c * (this row), C-u C-c * (the table), C-u C-u C-c * (until stable); on a #+TBLFM: line, that line. */
function recalculateCommand() {
  const at = formulaHere();
  if (!at) { message('Not in table', true); return; }
  const onFormula = /^[ \t]*#\+TBLFM:/i.test(currentBuffer().text.split('\n')[at.line] ?? '');
  const mode = (arg?.list ?? 0) >= 16 ? 'iterate' : arg ? 'all' : onFormula ? 'whole' : 'row';
  recalculateAt(at.line, at.col, mode);
}

/** The panel for Recalculate: this row, the table, until stable, every table. True when the chain should end. */
async function recalculateSheet(line, col) {
  const v = await choose('Recalculate', [
    { label: 'This row', meta: 'C-c *', value: 'row' },
    { label: 'Whole table', meta: 'C-u C-c *', value: 'all' },
    { label: 'Whole table, until stable', meta: 'C-u C-u C-c *', value: 'iterate' },
    { label: 'All tables in the file', meta: 'recalculate-buffer-tables', value: 'buffer' }]);
  if (v === undefined) return dismissed;
  if (v === 'buffer') { recalculateBuffer(); return true; }
  recalculateAt(line, col, v, { place: false });
  return true;
}

function recalculateBuffer() {
  const b = currentBuffer();
  const r = tblcmd.recalculateBuffer(b.text);
  if (r.error) { message(r.error, true); return; }
  if (r.text !== b.text) session.apply(b.id, { text: r.text });
}

/** Asks for a formula: the expression and its flags; undefined when cancelled, RESET or an empty answer remove it. */
function formulaPrompt(lhs, value, kind) {
  const title = `${kind} formula`;
  const help = `${kind} formula ${lhs}= . Flags go after a semicolon, for example ;%.2f or ;N. Empty removes the formula.`;
  if (viewMode() === 'text') return mini.ask({ prompt: `${kind} formula ${lhs}=`, value });
  return panel((sheet, close) => {
    const input = h('input', { value, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': title });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); close(input.value); } });
    put(sheet, h('h2', {}, title), h('p', {}, help), input,
      h('div', { class: 'row' }, h('button', { onclick: () => close(undefined) }, '‹ Formulas'), h('button', { onclick: () => close(RESET) }, 'Reset'), h('button', { class: 'primary', onclick: () => close(input.value) }, 'Save')));
    input.focus();
  });
}

/** Sets the formula for lhs ('' removes it) and recalculates the table so the result shows. */
function applyFormula(line, col, lhs, body, place) {
  let said = null;
  tableEditAt(line, col, (text, l, c) => {
    const r = tblcmd.setFormula(text, l, lhs, body);
    if (r.error || !body.trim()) return { text: r.text, line: l, col: c, error: r.error };
    const f = tblcmd.recalculate(r.text, l, 'all');
    said = f.message ?? null;
    return { text: f.text, line: l, col: c, error: f.error };
  }, { place });
  if (said) message(said);
}

/** C-c ' : all of the table's formulas in one sheet. */
async function editFormulas(line) {
  const at = line === undefined ? tableHere() : { line };
  if (!at) { message('Not in table', true); return; }
  const b = currentBuffer();
  const start = tblcmd.editorText(b.text, at.line);
  const v = await panel((sheet, close) => {
    const area = h('textarea', { rows: 8, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Formulas', class: 'mono' }, start);
    put(sheet, h('h2', {}, 'Edit formulas'), area,
      h('p', {}, 'One formula per line, like $3 = $1+$2. Lines starting with # are ignored. Delete a line to remove its formula.'),
      h('div', { class: 'row' }, h('button', { onclick: () => close(undefined) }, 'Cancel'), h('button', { class: 'primary', onclick: () => close(area.value) }, 'Save')));
    area.focus();
  });
  if (v === undefined) return;
  const r = tblcmd.installFormulas(currentBuffer().text, at.line, v);
  if (r.error) { message(r.error, true); return; }
  session.apply(b.id, { text: r.text });
  message(r.message);
}

/** C-c = (the column's formula) and C-u C-c = (the field's formula) in the Text view. */
async function formulaCommand() {
  const at = tableHere();
  if (!at) { message('Not in table', true); return; }
  const b = currentBuffer();
  const info = /@(\d+)\$(\d+)/.exec(table.fieldInfo(b.text, at.line, at.col) ?? '');
  if (!info) { message('Not in table', true); return; }
  const field = !!arg;
  const lhs = field ? `@${info[1]}$${info[2]}` : `$${info[2]}`;
  const old = tblcmd.formulasOf(b.text, at.line)?.find((x) => x.lhs === lhs);
  const v = await formulaPrompt(lhs, old?.source.slice(old.lhs.length + 1) ?? '', field ? 'Field' : 'Column');
  if (v === undefined || v === RESET) { if (v === RESET) applyFormula(at.line, at.col, lhs, '', true); return; }
  applyFormula(at.line, at.col, lhs, v, true);
}

/** The Formulas sheet of a table in the Outline view: its formulas, and the two ways to add one. True when the chain should end. */
async function formulasSheet(line, j, rowNo) {
  for (;;) {
    const b = currentBuffer();
    const list = tblcmd.formulasOf(b.text, line) ?? [];
    const col = columnName(j);
    const colLhs = `$${j + 1}`;
    const fieldLhs = `@${rowNo}$${j + 1}`;
    const v = await panel((sheet, close) => {
      put(sheet, h('h2', {}, 'Formulas'),
        h('div', { class: 'list' },
          ...list.map((f) => h('button', { class: 'item', onclick: () => close(f.lhs) }, h('span', { class: 'mono' }, f.source.replace('=', ' = ')), h('span', { class: 'meta' }, /^\$[-+]?[\w<>#]+$/.test(f.lhs) ? 'column' : 'field'))),
          h('button', { class: 'item', onclick: () => close(colLhs) }, h('span', {}, `Column formula for ${col}…`), h('span', { class: 'meta' }, 'C-c =')),
          h('button', { class: 'item', onclick: () => close(fieldLhs) }, h('span', {}, `Field formula for ${col}${rowNo}…`), h('span', { class: 'meta' }, 'C-u C-c =')),
          h('button', { class: 'item', onclick: () => close('edit-all') }, h('span', {}, 'Edit all formulas…'), h('span', { class: 'meta' }, "C-c '"))),
        h('div', { class: 'row' }, h('button', { onclick: () => close(undefined) }, '‹ Cell'), h('button', { onclick: () => close('close') }, 'Close')));
    });
    if (v === 'close') return true;
    if (v === undefined) return dismissed;
    if (v === 'edit-all') { await editFormulas(line); if (dismissed) return true; continue; }
    const old = list.find((f) => f.lhs === v);
    const kind = /^\$[-+]?[\w<>#]+$/.test(v) ? 'Column' : 'Field';
    const r = await formulaPrompt(v, old ? old.source.slice(old.lhs.length + 1) : '', kind);
    if (r === undefined) { if (dismissed) return true; continue; }
    const at = table.cellCol(b.text, line, j);
    applyFormula(line, at, v, r === RESET ? '' : r, false);
  }
}

/** What a tap on a cell of a table in the Outline view opens. */
async function cellSheet(line, j) {
  for (;;) {
    const b = currentBuffer();
    const v = table.tableView(b.text, line);
    const row = v?.rows.find((r) => r.line === line);
    if (!row || row.rule) return;
    const rowNo = v.rows.filter((r) => !r.rule && r.line <= line).length;
    const value = row.cells[j] ?? '';
    const at = () => table.cellCol(currentBuffer().text, line, j);
    const run = (fn) => tableEditAt(line, at(), fn, { place: false });
    const what = await panel((sheet, close) => {
      put(sheet, h('h2', {}, `${columnName(j)}${rowNo}${value ? ` · ${value}` : ''}`),
        h('div', { class: 'list' },
          h('button', { class: 'item', onclick: () => close('edit') }, h('span', {}, 'Edit cell')),
          h('button', { class: 'item', onclick: () => close('row') }, h('span', {}, 'Row'), h('span', { class: 'meta' }, '▾')),
          h('button', { class: 'item', onclick: () => close('column') }, h('span', {}, 'Column'), h('span', { class: 'meta' }, '▾')),
          h('button', { class: 'item', onclick: () => close('sort') }, h('span', {}, 'Sort'), h('span', { class: 'meta' }, '▾')),
          h('button', { class: 'item', onclick: () => close('recalculate') }, h('span', {}, 'Recalculate'), h('span', { class: 'meta' }, '▾')),
          h('button', { class: 'item', onclick: () => close('formulas') }, h('span', {}, 'Formulas'), h('span', { class: 'meta' }, formulaCount(b.text, line)))),
        h('div', { class: 'row' }, h('button', { onclick: () => close(undefined) }, 'Close')));
    });
    if (what === undefined) return;
    if (what === 'recalculate') { if (await recalculateSheet(line, at(), 'outline')) return; continue; }
    if (what === 'formulas') { if (await formulasSheet(line, j, rowNo)) return; continue; }
    if (what === 'edit') {
      const v2 = await askText({ prompt: 'Cell:', title: `Edit ${columnName(j)}${rowNo}`, value, ok: 'Save' });
      if (v2 !== undefined) run((t, l) => table.setField(t, l, j, v2));
      continue;
    }
    const sub = {
      row: ['Row', [['Insert above', (t, l, c) => table.insertRow(t, l, c)], ['Insert below', (t, l, c) => table.insertRow(t, l, c, true)], ['Move up', (t, l, c) => table.moveRow(t, l, c, -1)], ['Move down', (t, l, c) => table.moveRow(t, l, c, 1)],
        ['Add rule below', (t, l, c) => table.insertHline(t, l, c)], ['Delete', table.deleteRow]]],
      column: ['Column', [['Insert left', table.insertColumn], ['Insert right', (t, l, c) => { const a = table.insertColumn(t, l, c); return table.moveColumn(a.text, l, table.cellCol(a.text, l, j), 1); }],
        ['Move left', (t, l, c) => table.moveColumn(t, l, c, -1)], ['Move right', (t, l, c) => table.moveColumn(t, l, c, 1)], ['Delete', table.deleteColumn]]],
      sort: ['Sort', [['Alphabetic', 'a'], ['Alphabetic, reversed', 'A'], ['Numeric', 'n'], ['Numeric, reversed', 'N'], ['Time', 't'], ['Time, reversed', 'T']].map(([l, k]) => [l, (t, ln, c) => table.sortRows(t, ln, c, k)]).concat([['With a function', 'f'], ['With a function, reversed', 'F']])],
    }[what];
    const pick = await choose(sub[0], sub[1].map(([label], i) => ({ label, value: i })));
    if (pick === undefined) { if (dismissed) return; continue; }
    const act = sub[1][pick][1];
    if (typeof act === 'string') {
      const fn = await chooseSortFunctions();
      if (!fn) return;
      run((t, ln, c) => table.sortRows(t, ln, c, act, fn));
      return;
    }
    run(act);
    return;
  }
}

/** C-c |: makes a table of the size asked for at the cursor line, or from the selected text. */
async function tableCreate() {
  const b = currentBuffer();
  if (editor.selectionStart !== editor.selectionEnd) {
    const a = toFull(cur.proj, editor.selectionStart);
    const z = toFull(cur.proj, editor.selectionEnd);
    const from = lineAt(cur.proj, editor.selectionStart);
    const endLine = lineAt(cur.proj, editor.selectionEnd);
    const to = z > a && b.text[z - 1] === '\n' ? endLine : endLine + 1; // a selection ending at the start of a line leaves that line out
    const r = table.convertRegion(b.text, from, to);
    session.apply(b.id, { text: r.text });
    placeOffset(lineOffset(r.text, r.line) + r.col);
    return;
  }
  const v = await askText({ prompt: 'Table size Columns x Rows [e.g. 5x2] (RET=5x2):', title: 'New table', help: 'Columns x Rows, for example 5x2.', ok: 'Create' });
  if (v === undefined) return;
  const m = v.trim() === '' ? [null, '5', '2'] : /^(\d+)\s*x\s*(\d+)$/.exec(v.trim());
  if (!m || Number(m[1]) < 1 || Number(m[2]) < 1) { message('Invalid size', true); return; }
  const line = lineAt(cur.proj, editor.selectionStart);
  const r = table.createTable(b.text, line, Number(m[1]), Number(m[2]), editor.selectionStart - lineOffset(b.text, line));
  session.apply(b.id, { text: r.text });
  placeOffset(lineOffset(r.text, r.line) + r.col + 2);
}

/** Runs the edit for the heading or list item at the cursor, then puts the cursor on the line it ends on. */
function editHere(onHeading, onItem, atEnd = false) {
  const { line, kind } = kindAtCursor();
  const fn = kind === 'heading' ? onHeading : kind === 'item' ? onItem : null;
  if (!fn) { message(kind === null ? 'Not at a heading or list item' : kind === 'item' ? 'Not at a heading' : 'Not at a list item'); return; }
  const r = runEdit((t) => fn(t, line));
  if (r) placeCursor(r.line, atEnd);
}

// What the last TAB left a heading in: pressing TAB again on it goes on from there, as in Emacs. Anything else forgets it.
let lastCycle = null;
function cycleHeading(line) {
  const b = currentBuffer();
  const again = lastCycle && lastCycle.id === b.id && lastCycle.line === line ? lastCycle.state : null;
  const r = cycle(cur.a.foldables, b.folds, line, again);
  if (r) { session.setFolds(b.id, r.folds); message(r.state.toUpperCase()); lastCycle = { id: b.id, line, state: r.state }; }
}

/** The heading the cursor is on or under. */
const enclosingHead = () => {
  const { line } = kindAtCursor();
  return [...cur.a.heads].reverse().find((x) => x.line <= line) ?? null;
};

/** Runs an edit of the enclosing heading. The cursor stays where it was in the text, or goes to the start of the heading's line when it was on it. */
function onEnclosingHeading(fn) {
  const hd = enclosingHead();
  if (!hd) { message('Not at a heading'); return; }
  const onHead = kindAtCursor().line === hd.line;
  const p = cursorOffset();
  const before = currentBuffer().text.length;
  const r = runEdit((t) => fn(t, hd.line));
  if (!r) return;
  if (onHead) placeCursor(r.line);
  else placeOffset(p + currentBuffer().text.length - before);
  return r;
}

/** Says what the priority of the heading at `line` is now, as Emacs does. */
function sayPriority(line) {
  const p = analyze(currentBuffer().text).heads.find((x) => x.line === line)?.priority;
  message(p ? `Priority of current item set to ${p}` : 'Priority removed');
}

/** The note asked for when a repeating task is finished (org-log-repeat note): its text, or null when cancelled. */
function askNote(from, to) {
  return panel((sheet, close) => {
    const input = h('textarea', { rows: '6', autocapitalize: 'sentences', 'aria-label': 'Note' });
    put(sheet, h('h2', {}, 'Insert note'), h('p', {}, `Insert note for state change from "${from}" to "${to}".`), input,
      h('div', { class: 'row' }, h('button', { onclick: () => close(null) }, 'Skip'), h('button', { class: 'primary', onclick: () => close(input.value) }, 'Save')));
    input.focus();
  }).then((v) => (v === undefined ? null : v));
}

/** Changes the TODO state of the enclosing heading and says the new state. */
async function todoStep(dir) {
  const a = arg;
  if (a?.list === 4) { message('Logging a state-change note is not supported', true); return; }
  const said = [];
  let same = false;
  // org-log-repeat note: when finishing a repeating task, the note is asked for first
  let note;
  if (logRepeatMode() === 'note') {
    const hd = enclosingHead();
    try {
      const t = currentBuffer().text;
      const before = analyze(t);
      const from = before.heads.find((x) => x.line === hd?.line)?.todo ?? null;
      const c = hd ? cycleTodo(t, hd.line, dir, tagsColumn()) : null;
      if (c?.state && before.todo.done.includes(c.state) && completeRepeat({ text: c.text, line: hd.line, from: from ?? '', to: c.state, reopen: before.todo.open[0], now: localNow() }))
        note = await askNote(from ?? '', c.state);
    } catch { /* the plain path reports it */ }
  }
  const r = onEnclosingHeading((t, l) => {
    const before = analyze(t);
    const from = before.heads.find((x) => x.line === l)?.todo ?? null;
    const to = todoTarget(a, before.todo, from);
    const c = cycleTodo(t, l, dir, tagsColumn(), to);
    if (to !== undefined && c.state === from) { same = true; return c; }
    if (!c.state || !before.todo.done.includes(c.state)) return c;
    // Finishing a repeating task: the date moves on and the task is open again
    const rep = completeRepeat({ text: c.text, line: l, from: from ?? '', to: c.state, reopen: before.todo.open[0], now: localNow(), drawer: logDrawer(), log: logRepeatOn(), note });
    if (!rep) return c;
    said.push(`TODO state changed to ${c.state}`, `TODO state changed to ${before.todo.open[0]}`);
    return { ...c, text: rep.text, state: null };
  });
  if (said.length) message(said.at(-1));
  else if (same) message(`TODO state was already ${r?.state ?? ''}`);
  else if (r && (r.state || a)) message(`TODO state changed to ${r.state ?? ''}`);
  if (a?.list === 16) {
    const seqs = analyze(currentBuffer().text).todo.sequences;
    const at = Math.max(0, seqs.findIndex((x) => [...x.open, ...x.done].includes(r?.state ?? null)));
    message(`Keyword-Set ${at + 1}/${seqs.length}: ${[...seqs[at].open, ...seqs[at].done].join(' ')}`);
  }
}

/** Today as the date the prompts offer: the calendar date here, kept as a UTC date. */
/** The wall-clock time now, as the UTC fields the timestamp code reads. */
const localNow = () => { const n = new Date(); return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate(), n.getHours(), n.getMinutes(), n.getSeconds())); };
const localClock = () => { const n = new Date(); return `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`; };
const todayDate = () => { const n = new Date(); return new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())); };
const dayOf = (d) => d.toISOString().slice(0, 10);

/** The date prompt of the Outline view: the typed field with a month to tap, the time, and for a new timestamp whether it is active. */
function askDateSheet({ label, base, active, canToggle }) {
  return panel((sheet, close) => {
    const two = (n) => String(n).padStart(2, '0');
    const iso = (y, m, d) => `${y}-${two(m)}-${two(d)}`;
    const input = h('input', { autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Date', placeholder: dayOf(base) });
    let shown = { y: base.getUTCFullYear(), m: base.getUTCMonth() + 1 };
    let isActive = active;
    const read = () => { try { return parseDate(input.value, base); } catch { return null; } };
    const write = (d, time, until) => { input.value = `${iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate())}${time ? ` ${two(time[0])}:${two(time[1])}${until ? `-${until}` : ''}` : ''}`; follow(); draw(); };
    const parsed = () => { const r = read(); return r && { date: r.date, time: r.time ? [r.date.getUTCHours(), r.date.getUTCMinutes()] : null, until: r.until }; };
    const follow = () => { const p = input.value.trim() === '' ? null : parsed(); if (p) shown = { y: p.date.getUTCFullYear(), m: p.date.getUTCMonth() + 1 }; };
    const title = h('span', { style: 'font-weight:500' });
    const grid = h('div', { class: 'cal' });
    const hours = h('span', {}); const minutes = h('span', {});
    const noTime = h('button', { onclick: () => { const p = parsed() ?? { date: base, time: null }; write(p.date, p.time ? null : [new Date().getHours(), Math.floor(new Date().getMinutes() / 5) * 5], null); } });
    const activeBtn = h('button', { onclick: () => { isActive = !isActive; draw(); } });
    const bump = (part, dir) => {
      const p = parsed() ?? { date: base, time: null };
      const now = p.time ?? [new Date().getHours(), Math.floor(new Date().getMinutes() / 5) * 5];
      const t = stepTime(now[0], now[1], part, dir);
      write(p.date, [t.hour, t.minute], p.until);
    };
    function draw() {
      const p = input.value.trim() === '' ? null : parsed();
      const sel = p ? iso(p.date.getUTCFullYear(), p.date.getUTCMonth() + 1, p.date.getUTCDate()) : '';
      title.textContent = `${MONTH_NAMES[shown.m - 1]} ${shown.y}`;
      grid.replaceChildren(...['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((n) => h('span', { class: 'dow' }, n)),
        ...monthGrid(shown.y, shown.m).map((c) => {
          const key = iso(c.y, c.m, c.d);
          return h('button', { class: `day${c.other ? ' other' : ''}${key === dayOf(base) ? ' today' : ''}${key === sel ? ' on' : ''}`, 'aria-label': key, 'aria-pressed': String(key === sel),
            onclick: () => write(new Date(Date.UTC(c.y, c.m - 1, c.d)), p?.time ?? null, p?.until) }, String(c.d));
        }));
      hours.textContent = p?.time ? two(p.time[0]) : '--';
      minutes.textContent = p?.time ? two(p.time[1]) : '--';
      noTime.textContent = p?.time ? 'Off' : 'On';
      activeBtn.textContent = isActive ? 'Active' : 'Inactive';
    }
    input.addEventListener('input', () => { follow(); draw(); });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); close({ typed: input.value, active: isActive }); } });
    const stepper = (part, shownEl, name) => h('div', { class: 'stepper' }, h('button', { 'aria-label': `${name} earlier`, onclick: () => bump(part, -1) }, '−'), shownEl, h('button', { 'aria-label': `${name} later`, onclick: () => bump(part, 1) }, '+'));
    put(sheet, h('h2', {}, label),
      h('p', {}, `Date+time [${dayOf(base)}]:`), input,
      h('div', { class: 'calhead' }, h('button', { 'aria-label': 'Previous month', onclick: () => { shown = stepMonth(shown.y, shown.m, -1); draw(); } }, '‹'), title,
        h('button', { 'aria-label': 'Next month', onclick: () => { shown = stepMonth(shown.y, shown.m, 1); draw(); } }, '›')),
      grid,
      h('div', { class: 'timerow' }, h('span', {}, 'Time'), h('div', { class: 'tpair' }, stepper('hour', hours, 'Hour'), h('span', {}, ':'), stepper('minute', minutes, 'Minutes'))),
      h('div', { class: 'timerow' }, h('span', {}, 'No time'), noTime),
      canToggle ? h('div', { class: 'timerow' }, h('span', {}, 'Timestamp'), activeBtn) : null,
      h('div', { class: 'row' }, h('button', { onclick: () => close(undefined) }, 'Cancel'), h('button', { onclick: () => write(base, parsed()?.time ?? null, null) }, 'Today'),
        h('button', { class: 'primary', onclick: () => close({ typed: input.value, active: isActive }) }, 'Set')));
    draw();
    // The keyboard opens only when the field is tapped, and goes away when a control below it is tapped, so the controls stay in reach.
    sheet.addEventListener('pointerdown', (e) => { if (e.target.closest('button')) input.blur(); });
  });
}

/** Asks for a date ("2026-12-01", "+3d", "tomorrow 14:30") and returns the stamp text, or null when cancelled. */
async function askStamp(label, active = true, canToggle = false) {
  const base = todayDate();
  let typed;
  if (viewMode() === 'text') typed = await mini.ask({ prompt: `${label} Date+time [${dayOf(base)}]:`, value: '', complete: null, inputMode: 'text' });
  else {
    const got = await askDateSheet({ label: label || (active ? 'Timestamp' : 'Inactive timestamp'), base, active, canToggle });
    if (got === undefined) return null;
    typed = got.typed; active = got.active;
  }
  if (typed === undefined) return null;
  try { const d = parseDate(typed, base); return formatStamp(d.date, { time: d.time, until: d.until, active }); } catch (e) { failure(e); return null; }
}

/** S-up and S-down: on a timestamp they change the part under the cursor; elsewhere they are the priority keys. */
function shiftOrPriority(dir) {
  if (viewMode() === 'text') {
    const r = shiftStamp(currentBuffer().text, cursorOffset(), -dir);
    if (r) { const b = currentBuffer(); session.apply(b.id, { text: r.text }); placeOffset(r.pos); if (r.said) message(r.said); return; }
  }
  const r = onEnclosingHeading((t, l) => stepPriority(t, l, dir, tagsColumn()));
  if (r) sayPriority(r.line);
}

/** S-left and S-right: on a timestamp they move the date a day; elsewhere they change the TODO state. */
function shiftDayOrTodo(dir) {
  if (viewMode() === 'text') {
    const r = shiftStamp(currentBuffer().text, cursorOffset(), dir, { sideways: true });
    if (r) { session.apply(currentBuffer().id, { text: r.text }); placeOffset(r.pos); return; }
  }
  todoStep(dir);
}

/** C-c C-x e: sets the Effort property of the heading. An empty answer leaves the property empty, as Emacs does. */
async function setEffort(hd = enclosingHead()) {
  if (!hd) { message('Not at a heading'); return; }
  const typed = await askText({ prompt: 'Effort:', title: 'Set effort', help: 'A duration such as 2:00, 2h, 30min or 1d 3h.', ok: 'Set' });
  if (typed === undefined) return;
  const value = typed.trim();
  if (value !== '' && !isEffort(value)) { message(`Invalid duration format: "${value}"`, true); return; }
  runEdit((t) => setProperty(t, hd.line, 'Effort', value));
  message(`Effort is now ${value}`);
}

/** The running clock, looked for in every open buffer: { buffer, clockLine, headLine, title, start } or null. */
function runningClock() {
  for (const b of session.state().buffers) {
    const o = openClock(b.text);
    if (o) return { buffer: b, ...o };
  }
  return null;
}

/** Stops the running clock and says so; returns the message text. */
function stopClock(c, now) {
  const r = clockOut(c.buffer.text, c.clockLine, c.start, now);
  session.apply(c.buffer.id, { text: r.text });
  return `Clock stopped at ${r.stopped} after ${r.duration}`;
}

/** C-c C-x C-i: clocks in on the heading at the cursor, stopping any clock running elsewhere first. */
function clockInHere(hd = enclosingHead()) {
  if (!hd) { message('Not at a heading'); return; }
  const b = currentBuffer();
  const now = localNow();
  const c = runningClock();
  if (c && c.buffer.id === b.id && inClockedEntry(b.text, c.headLine, hd.line)) { message(`Clock continues in "${c.title}"`); return; }
  let said = '';
  if (c) said = stopClock(c, now);
  const r = runEdit((t) => clockIn(t, hd.line, now));
  if (r) message(`${said ? said + '. ' : ''}Clock starts at ${r.started} - showing entire task time.`);
}

/** C-c C-x C-o: stops the running clock. */
function clockOutNow() {
  const c = runningClock();
  if (!c) { message('No active clock', true); return; }
  message(stopClock(c, localNow()));
}

/** C-c C-x C-q: drops the running clock without recording it. */
function clockCancel() {
  const c = runningClock();
  if (!c) { message('No active clock', true); return; }
  session.apply(c.buffer.id, { text: cancelClock(c.buffer.text, c.clockLine).text });
  message('Clock canceled');
}

/** C-c [ puts the current file on the agenda files; C-c ] takes it off. */
function agendaFileAdd() {
  const name = currentBuffer()?.name;
  if (!name) { message('This buffer is not visiting a file', true); return; }
  const listed = agendaFileNames().includes(name);
  addAgendaFile(name);
  message(listed ? 'File moved to front of agenda file list' : 'File added to front of agenda file list');
}
function agendaFileRemove() {
  const name = currentBuffer()?.name;
  if (!name) { message('This buffer is not visiting a file', true); return; }
  const names = agendaFileNames();
  if (!names.includes(name)) { message(`File was not in list: ${name} (not removed)`); return; }
  setAgendaFileNames(names.filter((n) => n !== name));
  message(`Removed from Org Agenda list: ${name}`);
}

/** Settings, Agenda files: the list, with Remove for each file and ways to add one. */
async function agendaFilesDialog() {
  for (;;) {
    const names = agendaFileNames();
    const act = await panel((sheet, close) => {
      put(sheet, h('h2', {}, 'Agenda files'),
        names.length ? h('div', { class: 'list' }, names.map((n) => h('div', { class: 'item' },
          h('span', {}, `${parseName(n).path} (${STORAGE_LABEL[parseName(n).provider]})`),
          h('button', { onclick: () => close({ remove: n }) }, 'Remove')))) : h('p', {}, 'No files. The agenda is empty until you add one.'),
        h('div', { class: 'row' },
          h('button', { onclick: () => close({ addCurrent: true }) }, 'Add current file'),
          h('button', { onclick: () => close({ addFile: true }) }, 'Add file…'),
          h('button', { onclick: () => close(undefined) }, 'Close')));
    });
    if (act === undefined) return;
    if (act.remove) setAgendaFileNames(names.filter((n) => n !== act.remove));
    else if (act.addCurrent) agendaFileAdd();
    else if (act.addFile) { const picked = await browse({ mode: 'open', current: currentBuffer()?.name ?? recent.list()[0] ?? null }); if (picked) addAgendaFile(picked); }
  }
}

async function planHere(keyword, label, said, hd = enclosingHead()) {
  if (!hd) { message('Not at a heading'); return; }
  const stamp = await askStamp(label);
  if (stamp === null) return;
  runEdit((t) => setPlanning(t, hd.line, keyword, stamp));
  message(`${said} ${stamp}`);
}

/** Adds a timestamp at the end of the heading's own text, as a new body line. */
async function addTimestampBody(hd) {
  const stamp = await askStamp('', true, true);
  if (stamp === null) return;
  const body = bodyOf(currentBuffer().text, hd.line);
  runEdit((t) => setBody(t, hd.line, body === '' ? stamp : `${body.replace(/\n$/, '')}\n${stamp}`));
}

async function insertTimestamp(active) {
  const stamp = await askStamp('', active, true);
  if (stamp === null) return;
  const at = cursorOffset();
  const r = runEdit((t) => insertStamp(t, at, stamp));
  if (r) placeOffset(r.pos);
}

/** Calls `fn(line)` with the line of the enclosing heading. */
function withHeading(fn) {
  const hd = enclosingHead();
  if (!hd) { message('Not at a heading'); return; }
  return fn(hd.line);
}

/** A heading after the subtree at the cursor (C-RET), or at the end of the tree above it. */
function insertHeadingAfterSubtree(atParentEnd) {
  const { line, kind } = kindAtCursor();
  if (kind === 'item') { message('Not at a heading'); return; }
  const head = [...cur.a.heads].reverse().find((x) => x.line <= line);
  if (!head) { message('Not at a heading'); return; }
  const r = runEdit((t) => insertHeadingAfter(t, head.line, '', atParentEnd));
  if (r) placeCursor(r.line, true);
}

/** The universal argument typed or tapped so far, and the one the running command sees (a command reads it before it first waits). */
let argState = NO_ARG;
let arg = null;
const ARG_KEYS = /^(universal-argument|negative-argument|argument-\d)$/;
function invoke(name) {
  if (ARG_KEYS.test(name)) return COMMANDS[name]();
  arg = argValue(argState);
  argState = NO_ARG;
  try { return COMMANDS[name](); } finally { arg = null; }
}
const echoArg = () => message(`${argLabel(argState)}-`);

/** Whole-buffer visibility with an argument: S-TAB with a number shows the headings down to that level and C-u goes back to the startup visibility; TAB's C-u cycles, C-u C-u is the startup visibility and C-u C-u C-u shows everything. */
function globalVisibility(a, fromTab) {
  const b = currentBuffer();
  const set = (folds, text) => { session.setFolds(b.id, folds); message(text); };
  if (!fromTab && a?.num > 0) { set(contents(cur.a.heads, a.num), `Content view to level: ${a.num}`); return; }
  if (!fromTab && a?.list === 4) { set(startupFolds(b.text), 'Startup visibility, plus VISIBILITY properties.'); return; }
  if (fromTab && a?.list === 16) { set(startupFolds(b.text), 'Startup visibility, plus VISIBILITY properties'); return; }
  if (fromTab && a?.list >= 64) { set({}, 'Entire buffer visible, including drawers'); return; }
  const r = cycleGlobal(cur.a.heads, b.folds);
  set(r.folds, r.state.toUpperCase());
}

const COMMANDS = {
  'universal-argument': () => { argState = pressU(argState); echoArg(); },
  'negative-argument': () => { argState = pressDigit(argState, '-'); echoArg(); },
  ...Object.fromEntries([...'0123456789'].map((d) => [`argument-${d}`, () => { argState = pressDigit(argState, d); echoArg(); }])),
  'next-line': () => vertical(1),
  'previous-line': () => vertical(-1),
  'scroll-up': () => page(1),
  'scroll-down': () => page(-1),
  'forward-char': () => moved(forwardChar(editor.value, focusPoint())),
  'backward-char': () => moved(backwardChar(editor.value, focusPoint())),
  'forward-word': () => goTo(forwardWord(editor.value, focusPoint())),
  'backward-word': () => goTo(backwardWord(editor.value, focusPoint())),
  'beginning-of-line': () => goTo(startOfLine(editor.value, focusPoint())),
  'end-of-line': () => goTo(endOfLine(editor.value, focusPoint())),
  'beginning-of-buffer': () => { leaveHere(); goTo(0); },
  'end-of-buffer': () => { leaveHere(); goTo(editor.value.length); },
  'back': () => goBack(),
  'effort': () => setEffort(),
  'capture': () => capture(),
  // In the Outline view there is no cursor, so Refile from the palette is for the argument forms; a heading is refiled from its own menu
  'refile': () => refileHere(false, viewMode() === 'outline' ? null : undefined),
  'refile-copy': () => refileHere(true),
  'refile-cache-clear': () => { refileCache.clear(); message('Refile cache has been cleared'); },
  'archive-subtree': () => archiveHere(),
  'archive-sibling': () => archiveSibling(),
  'archive-tag': () => archiveTag(),
  'clock-in': () => clockInHere(),
  'clock-out': () => clockOutNow(),
  'clock-cancel': () => clockCancel(),
  'agenda-file-add': () => agendaFileAdd(),
  'agenda-file-remove': () => agendaFileRemove(),
  'quit': () => message('Quit', true),
  'cycle': () => {
    const a = arg;
    if (a?.num !== undefined) { message('Cycling with a numeric argument is not supported', true); return; }
    // C-u TAB cycles the whole buffer; C-u C-u TAB goes back to the startup visibility and C-u C-u C-u TAB shows everything
    if (a) { globalVisibility(a, true); return; }
    if (inTable()) { tableEdit(table.nextField); return; } const { line, kind } = kindAtCursor(); if (kind === null) message('Not at a heading or list item'); else cycleHeading(line);
  },
  'indent': () => { const st = session.state(); const b = st.buffers.find((x) => x.id === st.current); if (!b) return; indentOverride.set(b.id, !indentOn(b)); render(); message(indentOn(b) ? 'Indent mode on' : 'Indent mode off'); },
  'cycle-global': () => { const a = arg; if (inTable() && !a) { tableEdit(table.previousField); return; } globalVisibility(a, false); },
  'move-up': () => inTable() ? tableEdit((t, l, c) => table.moveRow(t, l, c, -1)) : editHere((t, l) => moveSubtree(t, l, -1), (t, l) => moveItem(t, l, -1)),
  'move-down': () => inTable() ? tableEdit((t, l, c) => table.moveRow(t, l, c, 1)) : editHere((t, l) => moveSubtree(t, l, 1), (t, l) => moveItem(t, l, 1)),
  // On plain text Emacs's M-left moves a word back.
  'promote': () => inTable() ? tableEdit((t, l, c) => table.moveColumn(t, l, c, -1)) : (kindAtCursor().kind === null ? COMMANDS['backward-word']() : editHere((t, l) => changeLevel(t, l, -1, false), (t, l) => indentItem(t, l, -1, false))),
  // On plain text Emacs's M-right moves a word forward.
  'demote': () => inTable() ? tableEdit((t, l, c) => table.moveColumn(t, l, c, 1)) : (kindAtCursor().kind === null ? COMMANDS['forward-word']() : editHere((t, l) => changeLevel(t, l, 1, false), (t, l) => indentItem(t, l, 1, false))),
  'promote-subtree': () => inTable() ? tableEdit(table.deleteColumn) : editHere((t, l) => changeLevel(t, l, -1, true), (t, l) => indentItem(t, l, -1, true)),
  'demote-subtree': () => inTable() ? tableEdit(table.insertColumn) : editHere((t, l) => changeLevel(t, l, 1, true), (t, l) => indentItem(t, l, 1, true)),
  // On a heading or in its body: a new sibling heading after the subtree, as C-RET does in Emacs.
  'insert-heading': () => insertHeadingAfterSubtree(false),
  'todo': () => todoStep(1),
  'todo-next': () => shiftDayOrTodo(1),
  'todo-previous': () => shiftDayOrTodo(-1),
  'priority-up': () => shiftOrPriority(-1),
  'priority-down': () => shiftOrPriority(1),
  schedule: () => planHere('SCHEDULED', 'SCHEDULED', 'Scheduled to'),
  deadline: () => planHere('DEADLINE', 'DEADLINE', 'Deadline on'),
  'timestamp': () => insertTimestamp(true),
  'timestamp-inactive': () => insertTimestamp(false),
  'priority': () => {
    // C-u shows the priority as Org's number (A 2000, B 1000, C 0; the default B when there is none) and changes nothing
    if (arg?.list === 4) { withHeading((line) => { const p = cur.a.heads.find((x) => x.line === line).priority; message(`Priority is ${{ A: 2000, B: 1000, C: 0 }[p ?? 'B']}`); }); return; }
    withHeading(priorityDialog);
  },
  'set-property': () => withHeading(setPropertyDialog),
  'delete-property': () => withHeading(deletePropertyDialog),
  'set-tags': () => withHeading(setTagsDialog),
  'isearch-forward': () => startFind(false),
  'isearch-backward': () => startFind(true),
  'isearch-forward-regexp': () => startFind(false, true),
  'isearch-backward-regexp': () => startFind(true, true),
  'query-replace': () => queryReplace(false),
  'query-replace-regexp': () => queryReplace(true),
  'execute-command': () => commandPalette(),
  agenda: () => openAgenda('agenda'),
  'agenda-todo': () => openAgenda('todo'),
  'calendar': () => calendarScreen(),
  'agenda-tags': () => openAgenda('tags'),
  'agenda-search': () => openAgenda('search'),
  'sparse-tree-regexp': () => sparse('regexp'),
  'sparse-tree-match': () => sparse('match'),
  'sparse-tree-todo': () => sparse('todo'),
  'sparse-tree-todo-keyword': () => sparse('todo-keyword'),
  'toggle-checkbox': () => {
    if (viewMode() === 'text' && /^[ \t]*#\+TBLFM:/i.test(currentBuffer().text.split('\n')[lineAt(cur.proj, editor.selectionStart)] ?? '') && formulaHere()) { recalculateCommand(); return; }
    if (inTable()) {
      // a field that starts with = is evaluated; any other field only aligns the table
      const here = tableHere();
      const col = /\$(\d+)/.exec(table.fieldInfo(currentBuffer().text, here.line, here.col) ?? '');
      const r = col && tblcmd.evalFieldFormula(currentBuffer().text, here.line, Number(col[1]) - 1);
      if (r) { tableEditAt(here.line, here.col, () => ({ text: r.text, line: here.line, col: here.col, error: r.error })); return; }
      tableEdit(table.align); return;
    }
    if (marks.length) { marks = []; paintOverlay(); message('Temporary highlights/overlays removed from current buffer'); return; }
    const at = editor.selectionStart;
    const col = at - lineOffset(currentBuffer().text, lineAt(cur.proj, at));
    const r = runEdit((t) => updateCookieAt(t, lineAt(cur.proj, at), col) ?? toggleCheckbox(t, kindAtCursor().line));
    if (!r) message('Nothing to do here'); else if (r.col !== undefined) placeOffset(lineOffset(r.text, r.line) + r.col);
  },
  'insert-heading-here': () => {
    // C-u puts the heading after the subtree at point, C-u C-u at the end of the tree above it
    if (arg?.list) { insertHeadingAfterSubtree(arg.list >= 16); return; }
    if (inTable()) { tableEdit(table.splitField); return; } const r = runEdit((t) => insertHeadingHere(t, cursorOffset())); if (r) placeOffset(r.pos); },
  'unsent-saves': () => sendQueued(true),
  'table-next-row': () => tableEdit(table.nextRow),
  'table-copy-down': () => tableEdit(table.copyDown),
  'table-hline': () => { const above = !!arg; tableEdit((t, l, c) => table.insertHline(t, l, c, above)); },
  'table-hline-and-move': () => tableEdit(table.hlineAndMove),
  'table-delete-row': () => tableEdit(table.deleteRow),
  'table-insert-row': () => { const below = !!arg; tableEdit((t, l, c) => table.insertRow(t, l, c, below)); },
  'table-align': () => tableEdit(table.align),
  'table-sort': () => tableSort(),
  'table-blank-field': () => tableEdit(table.blankField),
  'table-sum': () => {
    const at = tableHere();
    const sum = at && table.sumColumn(currentBuffer().text, at.line, at.col);
    if (sum === null || sum === undefined) { message('Not in table', true); return; }
    killRing.kill(sum, { append: false });
    navigator.clipboard.writeText(sum).catch(() => message('Could not copy to the clipboard', true));
  },
  'table-recalculate': () => recalculateCommand(),
  'table-formula': () => formulaCommand(),
  'table-toggle-numbers': () => { if (!tableHere()) { message('Not in table', true); return; } tableNumbers = !tableNumbers; message(`Tables Row/Column numbers display turned ${tableNumbers ? 'on' : 'off'}`); render(); },
  'table-toggle-debug': () => { formulaDebug = !formulaDebug; message(`Formula debugging has been turned ${formulaDebug ? 'on' : 'off'}`); },
  'table-edit-formulas': () => editFormulas(),
  'table-recalculate-buffer': () => recalculateBuffer(),
  'keep-offline': () => offlineDialog(),
  'table-create': () => tableCreate(),
  'table-field-info': () => { const at = tableHere(); const i = at && table.fieldInfo(currentBuffer().text, at.line, at.col); message(i ?? 'Not in table', !i); },
  'table-transpose': () => tableEdit(table.transpose),
  'undo': () => stepHistory('undo'),
  'redo': () => stepHistory('redo'),
  'select-all': () => { editor.setSelectionRange(0, editor.value.length); renderModeLine(); },
  'goto-line': () => gotoLine(),
  'kill-line': () => killWith(killLine, { append: wasKill }),
  'kill-whole-line': () => killWith(killWholeLine, {}),
  'yank': () => {
    const text = killRing.get();
    if (text === undefined) { message('Kill ring is empty'); return; }
    const p = cursorOffset();
    const r = runEdit((t) => ({ text: t.slice(0, p) + text + t.slice(p) }));
    if (r) placeOffset(p + text.length);
  },
};

// ---- Lines and text ---------------------------------------------------------------------------

const killRing = createKillRing();
let lastKill = false;
let wasKill = false;

/** Where the cursor is in the real text. */
const cursorOffset = () => toFull(cur.proj, editor.selectionStart);

/** Records where the cursor is before a jump leaves it, so Back can return. */
function leaveHere() {
  if (shownId === null || !cur) return;
  places.push({ kind: 'place', id: shownId, offset: cursorOffset() });
  showBack();
}

const placeValid = (e) => e.kind === 'agenda' || e.kind === 'calendar' || session.state().buffers.some((b) => b.id === e.id);
const showBack = () => { $('back').hidden = places.peek(placeValid) === null; };

/** What the Back button says it will do. */
function backLabel(e) {
  if (e.kind === 'agenda') return 'Back to the agenda';
  if (e.kind === 'calendar') return 'Back to the calendar';
  const b = session.state().buffers.find((x) => x.id === e.id);
  return `Back to ${b.title}, line ${b.text.slice(0, e.offset).split('\n').length}`;
}

function goBack() {
  const e = places.pop(placeValid);
  showBack();
  if (!e) { message('No previous place'); return; }
  if (e.kind === 'agenda') { agendaScreen(); return; }
  if (e.kind === 'calendar') { calendarScreen(); return; }
  session.select(e.id);
  setView('text');
  placeOffset(Math.min(e.offset, currentBuffer().text.length));
}

function placeOffset(p) {
  const s = toShown(cur.proj, p);
  editor.setSelectionRange(s, s);
  showCaret(s);
  renderModeLine();
}

function stepHistory(which) {
  const p = session[which](currentBuffer().id);
  lastCycle = null;
  if (p === null) message(which === 'undo' ? 'Nothing to undo' : 'Nothing to redo');
  else if (viewMode() === 'text') placeOffset(p);
}

/** Removes text with `fn(text, cursor)` and puts what it removed on the kill ring (and the clipboard). */
function killWith(fn, { append = false }) {
  let killed = null;
  const r = runEdit((t) => { const k = fn(t, cursorOffset()); if (k) killed = k.killed; return k; });
  if (!r) { if (killed === null) message('End of buffer'); return; }
  killRing.kill(killed, { append });
  lastKill = true;
  navigator.clipboard.writeText(killRing.get()).catch(() => message('Could not copy to the clipboard', true));
  placeOffset(r.pos);
}

/**
 * One line of input. In the Text view the minibuffer asks, as Emacs does; in the Outline view a touch dialog does.
 * Resolves with the text, or undefined when cancelled.
 */
function askText({ prompt, title, help = null, value = '', complete = null, inputMode = 'text', ok = 'OK', key = null, showAll = false }) {
  if (viewMode() === 'text') return mini.ask({ prompt, value, complete, inputMode, key, showAll });
  return panel((sheet, close) => {
    const input = h('input', { inputmode: inputMode, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': title });
    input.value = value;
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); close(input.value); } });
    put(sheet, h('h2', {}, title), help ? h('p', {}, help) : null, input,
      h('div', { class: 'row' }, h('button', { onclick: () => close(undefined) }, 'Cancel'), h('button', { class: 'primary', onclick: () => close(input.value) }, ok)));
    input.focus();
  });
}

async function gotoLine() {
  const b = currentBuffer();
  const n = lineInfo(b.text, b.text.length).count;
  const value = await askText({ prompt: 'Goto line:', title: 'Go to line', help: `Enter a number from 1 to ${n}.`, inputMode: 'numeric', ok: 'Go' });
  if (value === undefined) return;
  const line = Number(value);
  if (!Number.isInteger(line) || line < 1 || line > n) { message(`Line ${value} is not between 1 and ${n}`, true); return; }
  const opened = reveal(cur.a.foldables, b.folds, line - 1);
  if (JSON.stringify(opened) !== JSON.stringify(b.folds)) session.setFolds(b.id, opened);
  leaveHere();
  placeOffset(lineStart(b.text, line));
}

async function linesMenu() {
  const b = currentBuffer();
  const { line, count } = lineInfo(b.text, cursorOffset());
  const what = await choose('Lines and text', [
    { label: 'Go to line…', meta: 'M-g g', value: 'goto-line' },
    { label: 'Select all', meta: 'C-x h', value: 'select-all' },
    { label: 'Copy all', value: 'copy-all' },
    { label: 'Duplicate line', value: 'duplicate' },
    { label: 'Delete line', meta: 'C-S-DEL', value: 'kill-whole-line' },
    { label: 'Move line up', value: 'up' },
    { label: 'Move line down', value: 'down' },
    { label: 'Indent', value: 'indent' },
    { label: 'Outdent', value: 'outdent' },
  ], { subtitle: `Line ${line} of ${count}` });
  if (!what) return;
  const edit = (fn) => { const r = runEdit((t) => fn(t, cursorOffset())); if (r) placeOffset(r.pos); else message('Nothing to do here'); };
  if (COMMANDS[what]) COMMANDS[what]();
  else if (what === 'copy-all') navigator.clipboard.writeText(b.text).then(() => message('Copied the whole text')).catch(() => message('Could not copy to the clipboard', true));
  else if (what === 'duplicate') edit(duplicateLine);
  else if (what === 'up') edit((t, p) => moveLine(t, p, -1));
  else if (what === 'down') edit((t, p) => moveLine(t, p, 1));
  else if (what === 'indent') edit((t, p) => indentLine(t, p, 2));
  else if (what === 'outdent') edit((t, p) => indentLine(t, p, -2));
}

// ---- The tool row under the tabs ----------------------------------------------------------------

function setTextSize(delta) {
  const next = Math.min(TEXT_SIZES.max, Math.max(TEXT_SIZES.min, fontSize() + delta));
  config.update({ settings: { 'view.fontSize': String(next) } });
  message(`Text size ${next}`);
}

function renderTools(mode) {
  // Like the key row, these never take focus, so pressing one neither raises nor lowers the on-screen keyboard.
  const keep = (e) => e.preventDefault();
  const tool = (label, title, onclick, on = null) => h('button', {
    'aria-label': title, title, class: `tool${on ? ' on' : ''}`, ...(on === null ? {} : { 'aria-pressed': String(on) }), onclick,
    onpointerdown: keep, onmousedown: keep,
  }, label);
  const text = mode === 'text';
  $('tools').hidden = currentBuffer() === undefined || !toolRowOn(mode);
  $('tools').replaceChildren(...kept([
    tool('↶', 'Undo', () => COMMANDS.undo()),
    tool('↷', 'Redo', () => COMMANDS.redo()),
    text ? tool('#', 'Line numbers', () => config.update({ settings: { 'view.lineNumbers': String(!lineNumbers()) } }), lineNumbers()) : null,
    text ? tool('⏎', 'Wrap lines', () => config.update({ settings: { 'view.wrap': String(!wrapOn()) } }), wrapOn()) : null,
    tool('A−', 'Smaller text', () => setTextSize(-1)),
    tool('A+', 'Larger text', () => setTextSize(1)),
    text ? tool('Line', 'Lines and text', linesMenu) : null,
  ]));
}

/** A popup with a text field for a heading's title. Resolves with the text, or undefined when cancelled. */
function askTitle(title, initial) {
  return panel((sheet, close) => {
    const input = h('textarea', { rows: '4', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Title' });
    input.value = initial;
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); close(input.value); } });
    put(sheet, h('h2', {}, title), input,
      h('div', { class: 'row' }, h('button', { onclick: () => close(undefined) }, 'Cancel'), h('button', { onclick: () => close(input.value) }, 'OK')));
    input.focus();
  });
}

/** The text under a heading in a multi-line field; Enter starts a new line. */
function askBody(title, initial) {
  return panel((sheet, close) => {
    const input = h('textarea', { rows: '10', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Body' });
    input.value = initial;
    put(sheet, h('h2', {}, `Edit body: ${title}`), input,
      h('div', { class: 'row' }, h('button', { onclick: () => close(undefined) }, 'Cancel'), h('button', { class: 'primary', onclick: () => close(input.value) }, 'Save')));
    input.focus();
  });
}

async function setTagsDialog(line) {
  const hd = cur.a.heads.find((x) => x.line === line);
  const value = await askText({ prompt: 'Tags:', title: 'Tags', help: 'Separate tags with a colon, for example work:home.', value: hd.tags.join(':'), ok: 'Set' });
  if (value === undefined) return;
  const tags = value.split(':').map((s) => s.trim()).filter(Boolean);
  if (tags.some((t) => !/^[\p{L}\p{N}_@#%]+$/u.test(t))) { message('Tags can have letters, digits and _ @ # %', true); return; }
  runEdit((t) => setTags(t, line, tags, tagsColumn()));
}

async function priorityDialog(line) {
  const hd = cur.a.heads.find((x) => x.line === line);
  const value = viewMode() === 'text'
    ? await mini.ask({ prompt: 'Priority A-C, SPC to remove:', value: '' })
    : await choose('Priority', [...['A', 'B', 'C'].map((p) => ({ label: p, meta: hd.priority === p ? 'current' : null, value: p })), { label: 'None', value: '' }]);
  if (value === undefined) return;
  const p = value.trim().toUpperCase();
  if (p !== '' && !/^[A-C]$/.test(p)) { message('Priority must be A, B or C', true); beep(); return; }
  if (runEdit((t) => setPriority(t, line, p === '' ? null : p, tagsColumn()))) sayPriority(line);
}

/** The commands or names that contain every word typed, anywhere. */
const matchWords = (typed, ...fields) => {
  const hay = fields.join(' ').toLowerCase();
  return typed.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
};

async function setPropertyDialog(line) {
  const names = propertyNames(currentBuffer().text);
  const name = await askText({ prompt: 'Property:', title: 'Set property', help: 'The name of the property, for example Effort.', ok: 'Next',
    complete: (t) => names.filter((n) => matchWords(t, n)).map((n) => ({ label: n, value: n })) });
  if (name === undefined) return;
  const old = propertiesOf(currentBuffer().text, line).find(([n]) => n === name)?.[1] ?? '';
  const value = await askText({ prompt: `${name} value:`, title: name, value: old, ok: 'Set' });
  if (value === undefined) return;
  const r = runEdit((t) => setProperty(t, line, name, value));
  if (r?.drawer != null) { const b = currentBuffer(); session.setFolds(b.id, { ...b.folds, [r.drawer]: 'all' }); }
}

async function deletePropertyDialog(line) {
  const names = propertiesOf(currentBuffer().text, line).map(([n]) => n);
  const name = await askText({ prompt: 'Property:', title: 'Delete property', ok: 'Delete',
    complete: (t) => names.filter((n) => matchWords(t, n)).map((n) => ({ label: n, value: n })) });
  if (name !== undefined) runEdit((t) => deleteProperty(t, line, name));
}

async function headingActions(line) {
  const b = currentBuffer();
  const hd = cur.a.heads.find((x) => x.line === line);
  let next = null;
  try { next = cycleTodo(b.text, line).state; } catch { /* the heading is gone */ }
  const own = b.text.split('\n')[line + 1] ?? '';
  const planned = (k) => new RegExp(`${k}:\\s*([<[][^>\\]]*[>\\]])`).exec(/^\s*(?:CLOSED|DEADLINE|SCHEDULED):/.test(own) ? own : '')?.[1] ?? null;
  const effort = propertiesOf(b.text, line).find(([n]) => n === 'Effort')?.[1] || null;
  // What is set shows as a chip with its value; what is not set is under Add.
  const fields = [
    { value: 'todo', label: 'State', now: hd.todo, set: 'TODO state', meta: `${hd.todo ?? 'none'} to ${next ?? 'none'}` },
    { value: 'priority', label: 'Priority', now: hd.priority ? `[#${hd.priority}]` : null, set: 'Priority' },
    { value: 'schedule', label: 'Scheduled', now: planned('SCHEDULED'), set: 'Scheduled' },
    { value: 'deadline', label: 'Deadline', now: planned('DEADLINE'), set: 'Deadline' },
    { value: 'tags', label: 'Tags', now: hd.tags.length ? `:${hd.tags.join(':')}:` : null, set: 'Tags' },
    { value: 'effort', label: 'Effort', now: effort, set: 'Effort' },
  ];
  const what = await panel((sheet, close) => {
    put(sheet,
      h('h2', {}, hd.title || '(empty heading)'),
      h('div', { class: 'chips' }, [
        ...fields.filter((f) => f.now).map((f) => h('button', { class: 'chip', onclick: () => close(f.value) }, h('small', {}, f.label), f.now)),
        h('button', { class: 'chip add', onclick: () => close('add') }, '+ Add'),
      ]),
      h('div', { class: 'list' }, [
        h('div', { class: 'group' }, 'Text'),
        ...[['Edit title', 'edit'], ['Edit body', 'body']].map(([l, v]) => h('button', { class: 'item', onclick: () => close(v) }, h('span', {}, l))),
        h('div', { class: 'group' }, 'Structure'),
        ...[['Insert heading below', 'insert'], ['Archive', 'archive'], ['Refile', 'refile'], ['Move up', 'move-up'], ['Move down', 'move-down'],
          ['Promote', 'promote', hd.level > 1 ? `to level ${hd.level - 1}` : null], ['Demote', 'demote', `to level ${hd.level + 1}`], ['Promote subtree', 'promote-subtree'], ['Demote subtree', 'demote-subtree']]
          .map(([l, v, m]) => h('button', { class: 'item', onclick: () => close(v) }, h('span', {}, l), m ? h('span', { class: 'meta' }, m) : null)),
      ]),
      h('p', { class: 'note' }, 'Tap a chip to change it. + Add lists what is not set.'),
    );
  });
  if (what === 'add') {
    const more = await choose('Add', [
      ...fields.filter((f) => !f.now).map((f) => ({ label: f.set, value: f.value })),
      { label: 'Property', value: 'property' }, { label: 'Clock in', value: 'clock-in' }, { label: 'Timestamp', value: 'timestamp' },
    ]);
    if (more === undefined) return;
    return headingDo(more, hd, line, next);
  }
  return headingDo(what, hd, line, next);
}

async function headingDo(what, hd, line, next) {
  const b = currentBuffer();
  const run = {
    todo: () => (t, l) => cycleTodo(t, l, 1, tagsColumn()), promote: () => (t, l) => changeLevel(t, l, -1, false), demote: () => (t, l) => changeLevel(t, l, 1, false),
    'promote-subtree': () => (t, l) => changeLevel(t, l, -1, true), 'demote-subtree': () => (t, l) => changeLevel(t, l, 1, true),
    'move-up': () => (t, l) => moveSubtree(t, l, -1), 'move-down': () => (t, l) => moveSubtree(t, l, 1),
  };
  if (what === undefined) return;
  if (run[what]) runEdit((t) => run[what]()(t, line));
  else if (what === 'tags') await setTagsDialog(line);
  else if (what === 'priority') await priorityDialog(line);
  else if (what === 'property') await setPropertyDialog(line);
  else if (what === 'effort') await setEffort(hd);
  else if (what === 'schedule') await planHere('SCHEDULED', 'SCHEDULED', 'Scheduled to', hd);
  else if (what === 'deadline') await planHere('DEADLINE', 'DEADLINE', 'Deadline on', hd);
  else if (what === 'clock-in') clockInHere(hd);
  else if (what === 'timestamp') await addTimestampBody(hd);
  else if (what === 'refile') await refileHere(false, hd);
  else if (what === 'archive') await archiveHere(hd);
  else if (what === 'body') {
    const body = await askBody(hd.title || '(empty heading)', bodyOf(b.text, line));
    if (body !== undefined) runEdit((t) => setBody(t, line, body));
  } else if (what === 'edit') {
    const title = await askTitle('Edit heading title', hd.title);
    if (title !== undefined) runEdit((t) => setTitle(t, line, title, tagsColumn()));
  } else if (what === 'insert') {
    const title = await askTitle('New heading', '');
    if (title !== undefined) runEdit((t) => insertHeadingAfter(t, line, title));
  }
}

// Swiping a heading from right to left cycles it, like TAB.
let swipe = null;
// The Back button: a tap goes back; a long press says where it would go.
{
  const back = $('back');
  const note = $('backnote');
  let timer = null;
  let held = false;
  let hide = null;
  back.addEventListener('mousedown', (e) => e.preventDefault()); // an open keyboard and the cursor stay as they are
  back.addEventListener('contextmenu', (e) => e.preventDefault());
  back.addEventListener('pointerdown', () => {
    held = false;
    timer = setTimeout(() => {
      held = true;
      const e = places.peek(placeValid);
      if (!e) return;
      note.textContent = backLabel(e);
      note.hidden = false;
      clearTimeout(hide);
      hide = setTimeout(() => { note.hidden = true; }, 2500);
    }, 500);
  });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) back.addEventListener(type, () => clearTimeout(timer));
  back.addEventListener('click', () => { if (held) { held = false; return; } note.hidden = true; goBack(); });
}

$('outline').addEventListener('pointerdown', (e) => {
  const row = e.target.closest('.ol-head');
  swipe = row ? { line: Number(row.dataset.line), x: e.clientX, y: e.clientY } : null;
});
$('outline').addEventListener('pointerup', (e) => {
  const s = swipe;
  swipe = null;
  if (s && e.clientX - s.x < -60 && Math.abs(e.clientY - s.y) < 40) cycleHeading(s.line);
});
$('outline').addEventListener('pointercancel', () => { swipe = null; });

const outlineOn = {
  cycle: cycleHeading,
  todo: (line) => runEdit((t) => cycleTodo(t, line, 1, tagsColumn())),
  checkbox: (line) => runEdit((t) => toggleCheckbox(t, line)),
  actions: headingActions,
  cell: cellSheet,
};

// ---- The command palette --------------------------------------------------------------------------------

// Every command has a plain label, its Emacs name and (below) the key it is on. `outline` marks the ones that make sense with no cursor.
const PALETTE = [
  ['calendar', 'calendar', 'Calendar', true],
  ['unsent-saves', 'unsent-saves', 'Send queued saves', true],
  ['indent', 'org-indent-mode', 'Indent mode', true],
  ['cycle', 'org-cycle', 'Fold or unfold'], ['cycle-global', 'org-shifttab', 'Fold or unfold everything', true],
  ['todo', 'org-todo', 'Change TODO state'], ['todo-next', 'org-shiftright', 'Next TODO state'], ['todo-previous', 'org-shiftleft', 'Previous TODO state'],
  ['agenda', 'org-agenda-list', 'Agenda', true], ['agenda-todo', 'org-todo-list', 'TODO list', true], ['agenda-tags', 'org-tags-view', 'Agenda by tags', true], ['agenda-search', 'org-search-view', 'Agenda search', true], ['schedule', 'org-schedule', 'Schedule'], ['deadline', 'org-deadline', 'Set deadline'], ['timestamp', 'org-timestamp', 'Insert timestamp'], ['timestamp-inactive', 'org-timestamp-inactive', 'Insert inactive timestamp'], ['priority', 'org-priority', 'Set priority'], ['priority-up', 'org-priority-up', 'Raise priority'], ['priority-down', 'org-priority-down', 'Lower priority'],
  ['set-tags', 'org-set-tags-command', 'Set tags'], ['set-property', 'org-set-property', 'Set property'], ['delete-property', 'org-delete-property', 'Delete property'],
  ['promote', 'org-metaleft', 'Promote'], ['demote', 'org-metaright', 'Demote'], ['promote-subtree', 'org-shiftmetaleft', 'Promote subtree'], ['demote-subtree', 'org-shiftmetaright', 'Demote subtree'],
  ['move-up', 'org-metaup', 'Move up'], ['move-down', 'org-metadown', 'Move down'],
  ['insert-heading', 'org-insert-heading-respect-content', 'Insert heading after subtree'], ['insert-heading-here', 'org-meta-return', 'Insert heading here'],
  ['table-align', 'org-table-align', 'Align table'], ['table-sort', 'org-table-sort-lines', 'Sort table lines'], ['table-blank-field', 'org-table-blank-field', 'Blank table field'], ['table-sum', 'org-table-sum', 'Sum table column'], ['keep-offline', 'serita-keep-files-offline', 'Keep files offline', true], ['table-recalculate', 'org-table-recalculate', 'Recalculate table formulas'], ['table-formula', 'org-table-eval-formula', 'Edit a table formula'], ['table-edit-formulas', 'org-table-edit-formulas', 'Edit all table formulas'], ['table-toggle-numbers', 'org-table-toggle-coordinate-overlays', 'Show table row and column numbers'], ['table-toggle-debug', 'org-table-toggle-formula-debugger', 'Debug table formulas'], ['table-recalculate-buffer', 'org-table-recalculate-buffer-tables', 'Recalculate all tables', true], ['table-create', 'org-table-create-or-convert-from-region', 'Create table or convert text'],
  ['table-transpose', 'org-table-transpose-table-at-point', 'Transpose table'], ['table-field-info', 'org-table-field-info', 'Show field coordinates'], ['table-hline', 'org-table-insert-hline', 'Insert horizontal line'],
  ['table-copy-down', 'org-table-copy-down', 'Copy field down'], ['table-next-row', 'org-table-next-row', 'Next row'],
  ['toggle-checkbox', 'org-toggle-checkbox', 'Toggle checkbox'], ['sparse-tree-regexp', 'org-sparse-tree', 'Show matching lines', true], ['sparse-tree-match', 'org-match-sparse-tree', 'Show headings by tag or property', true], ['sparse-tree-todo', 'org-show-todo-tree', 'Show unfinished TODO entries', true], ['sparse-tree-todo-keyword', 'org-show-todo-tree', 'Show entries with a TODO keyword', true],
  ['isearch-forward', 'isearch-forward', 'Find forward', true], ['isearch-backward', 'isearch-backward', 'Find backward', true], ['isearch-forward-regexp', 'isearch-forward-regexp', 'Find regexp forward', true], ['isearch-backward-regexp', 'isearch-backward-regexp', 'Find regexp backward', true], ['query-replace', 'query-replace', 'Replace', true], ['query-replace-regexp', 'query-replace-regexp', 'Replace regexp', true], ['goto-line', 'goto-line', 'Go to line', true], ['back', 'pop-global-mark', 'Go back', true], ['effort', 'org-set-effort', 'Set effort'], ['capture', 'org-capture', 'Capture', true], ['refile', 'org-refile', 'Refile', true], ['refile-copy', 'org-refile-copy', 'Refile and keep'], ['refile-cache-clear', 'org-refile-cache-clear', 'Clear refile cache', true], ['archive-subtree', 'org-archive-subtree', 'Archive'], ['archive-sibling', 'org-archive-to-archive-sibling', 'Archive to sibling'], ['archive-tag', 'org-toggle-archive-tag', 'Toggle archive tag'], ['clock-in', 'org-clock-in', 'Clock in'], ['clock-out', 'org-clock-out', 'Clock out'], ['clock-cancel', 'org-clock-cancel', 'Cancel clock'], ['agenda-file-add', 'org-agenda-file-to-front', 'Add file to agenda files', true], ['agenda-file-remove', 'org-remove-file', 'Remove file from agenda files', true],
  ['undo', 'undo', 'Undo', true], ['redo', 'undo-redo', 'Redo', true],
  ['select-all', 'mark-whole-buffer', 'Select all'], ['kill-line', 'kill-line', 'Cut to end of line'], ['kill-whole-line', 'kill-whole-line', 'Cut whole line'], ['yank', 'yank', 'Paste'],
  ['next-line', 'next-line', 'Next line'], ['previous-line', 'previous-line', 'Previous line'], ['forward-char', 'forward-char', 'Forward character'], ['backward-char', 'backward-char', 'Backward character'],
  ['forward-word', 'forward-word', 'Forward word'], ['backward-word', 'backward-word', 'Backward word'], ['beginning-of-line', 'move-beginning-of-line', 'Start of line'], ['end-of-line', 'move-end-of-line', 'End of line'],
  ['beginning-of-buffer', 'beginning-of-buffer', 'Start of buffer'], ['end-of-buffer', 'end-of-buffer', 'End of buffer'], ['scroll-up', 'scroll-up-command', 'Page down'], ['scroll-down', 'scroll-down-command', 'Page up'],
  ['quit', 'keyboard-quit', 'Quit'],
].map(([command, name, label, outline = false]) => ({ command, name, label, outline, key: Object.entries(TEXT_KEYS).find(([, c]) => c === command)?.[0] ?? '' }));

async function commandPalette() {
  const text = viewMode() === 'text';
  const entries = text ? PALETTE : PALETTE.filter((e) => e.outline);
  const found = (t) => entries.filter((e) => matchWords(t, e.label, e.name));
  let entry;
  if (text) {
    const name = await mini.ask({ prompt: 'M-x', historyKey: 'M-x', require: true,
      complete: (t) => (t.trim() === '' ? [] : found(t).map((e) => ({ label: e.label, value: e.name, hint: `${e.name}  ${e.key}`.trim() }))) });
    if (name === undefined || name.trim() === '') { argState = NO_ARG; return; }
    entry = entries.find((e) => e.name === name);
    if (!entry) { message('[No match]', true); beep(); return; }
  } else {
    entry = await panel((sheet, close) => {
      sheet.classList.add('full', 'palette');
      const input = h('input', { placeholder: 'Search commands', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Search commands' });
      const list = h('div', { class: 'list' });
      const fill = () => list.replaceChildren(...found(input.value).map((e) => h('button', { class: 'item', onclick: () => close(e) },
        h('span', {}, e.label), h('span', { class: 'meta' }, `${e.name}${e.key ? `  ${e.key}` : ''}`))));
      input.addEventListener('input', fill);
      fill();
      // The universal argument for the next command: C-u counts up (a fourth tap clears it) and the digits scroll beside it
      const said = h('p', { class: 'argsaid' }, '');
      const cu = h('button', { class: 'cu', onclick: () => { argState = pressU(argState, true); redraw(); } }, 'C-u');
      const digits = Object.fromEntries([...'0123456789-'].map((c) => [c, h('button', { class: 'dg', 'aria-label': c === '-' ? 'minus' : `digit ${c}`, onclick: () => { argState = pressDigit(argState, c, true); redraw(); } }, c)]));
      const redraw = () => {
        const n = argState.u;
        cu.classList.toggle('on', n > 0); cu.textContent = n > 1 ? `C-u ×${n}` : 'C-u';
        for (const [c, b] of Object.entries(digits)) b.classList.toggle('on', argState.digits !== '' && argState.digits.includes(c));
        said.textContent = argLabel(argState) ? `Next command runs with ${argLabel(argState)}.` : 'No prefix.';
      };
      redraw();
      put(sheet, h('h2', {}, 'Commands'), said, input, list, h('div', { class: 'row prefix' }, cu, h('div', { class: 'digits' }, ...Object.values(digits))));
      input.focus();
    });
    if (!entry) { argState = NO_ARG; return; }
  }
  goal = null;
  await invoke(entry.command);
}

// Emacs keys in the Text view: a key press becomes a chord, and a chord a command. A key held by the key row
// (Meta, Ctrl, Shift) applies to the next key only.
const keymap = createKeymap(TEXT_KEYS);

// Movement keys. The cursor is moved in the text as shown, so folded text is skipped as Emacs skips it. Up and down keep a goal column
// while they follow each other, and move by screen line when lines wrap.
const VERTICAL = new Set(['next-line', 'previous-line', 'scroll-up', 'scroll-down']);
let goal = null;

/** Where the screen lines of the line [start, end) of the shown text begin. */
function rowStarts(start, end) {
  if (editor.wrap === 'off' || end - start < 2) return [start];
  const m = $('mirror');
  const css = getComputedStyle(editor);
  m.style.width = `${editor.clientWidth}px`;
  m.style.paddingLeft = css.paddingLeft;
  m.style.paddingRight = css.paddingRight;
  m.textContent = editor.value.slice(start, end);
  const lineHeight = parseFloat(getComputedStyle(m).lineHeight);
  if (m.scrollHeight - parseFloat(css.paddingTop) - parseFloat(css.paddingBottom) <= lineHeight * 1.5) return [start];
  const node = m.firstChild;
  const rows = [start];
  const range = document.createRange();
  let top = null;
  for (let i = 0; i < end - start; i++) {
    range.setStart(node, i);
    range.setEnd(node, i + 1);
    const rect = range.getClientRects()[0];
    if (!rect) continue;
    if (top !== null && rect.top > top + 1) rows.push(start + i);
    top = rect.top;
  }
  return rows;
}

const focusPoint = () => (editor.selectionDirection === 'backward' ? editor.selectionStart : editor.selectionEnd);
/** Scrolls the text so the position `p` of the shown text is on screen; when it was not, it is put in the middle, as Emacs recenters. */
function showCaret(p) {
  const m = $('mirror');
  const css = getComputedStyle(editor);
  m.style.width = `${editor.clientWidth}px`;
  m.style.paddingLeft = css.paddingLeft;
  m.style.paddingRight = css.paddingRight;
  m.textContent = editor.value.slice(0, p);
  const mark = h('span', {}, '\u200b');
  m.append(mark);
  const top = mark.getBoundingClientRect().top - m.getBoundingClientRect().top;
  const lineHeight = parseFloat(css.lineHeight);
  if (top < editor.scrollTop || top + lineHeight > editor.scrollTop + editor.clientHeight) editor.scrollTop = Math.max(0, top - editor.clientHeight / 2);
}
function goTo(p) { editor.setSelectionRange(p, p); showCaret(p); renderModeLine(); }
const ERRORS = { 'end-of-buffer': 'End of buffer', 'beginning-of-buffer': 'Beginning of buffer' };
function moved(r) { goTo(r.pos); if (r.error) message(ERRORS[r.error], true); }
function vertical(dir) {
  const r = moveVertical(editor.value, focusPoint(), dir, goal, rowStarts);
  goal = r.goal;
  moved(r);
}
function page(dir) {
  const lineHeight = parseFloat(getComputedStyle(editor).lineHeight);
  const rows = Math.max(1, Math.floor(editor.clientHeight / lineHeight) - 2);
  let p = focusPoint();
  let error = null;
  for (let i = 0; i < rows && !error; i++) { const r = moveVertical(editor.value, p, dir, goal, rowStarts); goal = r.goal; p = r.pos; error = r.error; }
  editor.scrollTop += dir * rows * lineHeight;
  moved({ pos: p, error: error && p === focusPoint() ? error : null });
}

function runChord(chord, event, fromRow) {
  const r = keymap.press(chord);
  klog('chord', chord, r.kind, r.command ?? r.echo ?? '');
  if (r.kind === 'run') {
    event.preventDefault();
    message('');
    if (!VERTICAL.has(r.command)) goal = null;
    invoke(r.command);
    if ($('message').classList.contains('error')) beep();
  } else if (r.kind === 'prefix') { event.preventDefault(); message(r.echo); }
  else if (r.echo) { event.preventDefault(); message(r.echo, true); beep(); }
  else if (fromRow) { event.preventDefault(); message(`${chord} is undefined`, true); beep(); }
}

function moveCursor(key, extend) {
  const v = editor.value;
  const forward = editor.selectionDirection !== 'backward';
  let anchor = forward ? editor.selectionStart : editor.selectionEnd;
  let focus = forward ? editor.selectionEnd : editor.selectionStart;
  const startOf = (p) => (p <= 0 ? 0 : v.lastIndexOf('\n', p - 1) + 1);
  const start = startOf(focus);
  const col = focus - start;
  if (key === 'ArrowLeft') focus = Math.max(0, focus - 1);
  else if (key === 'ArrowRight') focus = Math.min(v.length, focus + 1);
  else if (key === 'ArrowUp') { if (start > 0) focus = Math.min(startOf(start - 1) + col, start - 1); }
  else {
    const nl = v.indexOf('\n', focus);
    if (nl >= 0) { const end = v.indexOf('\n', nl + 1); focus = Math.min(nl + 1 + col, end < 0 ? v.length : end); }
  }
  if (!extend) anchor = focus;
  editor.setSelectionRange(Math.min(anchor, focus), Math.max(anchor, focus), focus < anchor ? 'backward' : 'forward');
  renderModeLine();
}

const TABLE_ONLY = new Set(['RET', 'S-RET', 'M-S-<up>', 'M-S-<down>', 'C-c -', 'C-c RET', 'C-c ?']);
const HEADING_ONLY = new Set(['S-<up>', 'S-<down>', 'S-<left>', 'S-<right>']);
const SOFT_KEYS = ['Unidentified', 'Process'];
const MODIFIER_KEYS = ['Control', 'Alt', 'Meta', 'Shift'];

editor.addEventListener('keydown', (e) => {
  wasKill = lastKill;
  lastKill = false;
  if (e.key !== 'Tab') lastCycle = null;
  if (!emacsKeys() || viewMode() !== 'text') return;
  const held = keyRow.sticky();
  const fromRow = held.ctrl || held.meta || held.shift;
  const chord = chordOf({ key: e.key, ctrl: e.ctrlKey || held.ctrl, meta: e.altKey || e.metaKey || held.meta, shift: e.shiftKey || held.shift });
  if (keymap.pending() === '' && TABLE_ONLY.has(chord) && !inTable()) return; // elsewhere these keys do what they always did
  if (chord === 'RET' && keymap.pending() === '' && editor.value[editor.selectionStart] === undefined) return;
  if (chord === 'RET' && keymap.pending() === '' && editor.value[editor.selectionStart] === '\n') return; // at the end of the line RET stays a newline
  if (HEADING_ONLY.has(chord) && kindAtCursor().kind !== 'heading' && !stampAt(currentBuffer().text, cursorOffset())) return; // elsewhere the arrows select, as usual
  if ((chord === 'C-c' || chord === 'C-x' || chord === 'C-v') && !held.ctrl && keymap.pending() === '') return; // a keyboard's own C-c, C-x and C-v stay copy, cut and paste; the prefixes come from the key row
  if (chord) runChord(chord, e, fromRow);
  else if (keymap.pending() && e.key.length === 1) runChord(e.key, e, false);
  // An on-screen keyboard sends its letters as Unidentified or Process key presses followed by typed text (the beforeinput handler below); the held keys wait for that text.
  if (fromRow && !MODIFIER_KEYS.includes(e.key) && !SOFT_KEYS.includes(e.key) && e.keyCode !== 229) keyRow.clear();
});

// A log of what the keyboard sends the editor, for finding out why a key does not do what it should (Settings, Key event log).
const keyLines = [];
function klog(...parts) {
  if (!keyLogOn()) return;
  keyLines.push(`${new Date().toISOString().slice(11, 23)} ${parts.join(' ')}`);
  if (keyLines.length > 400) keyLines.shift();
}

/** The key event log as a screen of its own: what was recorded, with Copy, Clear and On or Off. */
async function keyLogScreen() {
  for (;;) {
    const act = await panel((sheet, close) => {
      put(sheet, h('h2', {}, 'Key event log'),
        h('p', {}, keyLogOn() ? 'Recording. Press keys in the editor, then come back here to copy the log.' : 'Off. Turn it on, press keys in the editor, then come back here.'),
        h('pre', { class: 'keylogtext', 'aria-label': 'Recorded key events' }, keyLines.length ? keyLines.join('\n') : '(nothing recorded yet)'),
        h('div', { class: 'row' },
          h('button', { onclick: () => close('toggle') }, keyLogOn() ? 'Turn off' : 'Turn on'),
          h('button', { onclick: () => close('clear') }, 'Clear'),
          h('button', { class: 'primary', onclick: () => close('copy') }, 'Copy'),
          h('button', { onclick: () => close(undefined) }, 'Close')));
    });
    if (act === 'toggle') config.update({ settings: { 'view.keyLog': String(!keyLogOn()) } });
    else if (act === 'clear') keyLines.length = 0;
    else if (act === 'copy') { try { await navigator.clipboard.writeText(keyLines.join('\n')); message('Copied the key event log'); } catch { message('Could not copy to the clipboard', true); } }
    else return;
  }
}
for (const type of ['keydown', 'keyup', 'beforeinput', 'input', 'compositionstart', 'compositionupdate', 'compositionend']) {
  editor.addEventListener(type, (e) => {
    const held = keyRow.sticky();
    klog(type, e.key !== undefined ? `key=${e.key} code=${e.code} kc=${e.keyCode}` : '', e.inputType ? `type=${e.inputType}` : '', e.data !== undefined && e.data !== null ? `data=${JSON.stringify(e.data)}` : '',
      e.isComposing ? 'composing' : '', e.cancelable === false ? 'uncancelable' : '', `mods=${[e.ctrlKey && 'C', e.altKey && 'A', e.metaKey && 'M', e.shiftKey && 'S'].filter(Boolean).join('')}`,
      `row=${Object.entries(held).filter(([, v]) => v).map(([k]) => k).join(',')}`, `pending=${keymap.pending()}`);
  }, true);
}

// An on-screen keyboard reports its letters as typed text, not as key presses. With Ctrl or Meta held on the key row, or after a prefix such as
// C-c, such a letter is a key chord and not text to insert.
editor.addEventListener('beforeinput', (e) => {
  if (!emacsKeys() || viewMode() !== 'text' || e.inputType !== 'insertText' || e.data?.length !== 1) return;
  const held = keyRow.sticky();
  if (!held.ctrl && !held.meta && keymap.pending() === '') return;
  const chord = chordOf({ key: e.data, ctrl: held.ctrl, meta: held.meta, shift: held.shift });
  e.preventDefault();
  runChord(chord ?? e.data, { preventDefault() {} }, true);
  keyRow.clear();
});

// Whether the on-screen keyboard is wanted while the key row is shown. The editor keeps focus either way.
let softKeyboard = false;
const focusEditor = () => { if (document.activeElement !== editor) editor.focus({ preventScroll: true }); };

followViewport();
const keyRow = createKeyRow({
  root: $('keyrow'),
  store: localStorage,
  toggleKeyboard() {
    softKeyboard = !softKeyboard;
    editor.inputMode = softKeyboard ? 'text' : 'none';
    if (softKeyboard && document.activeElement === editor) editor.blur();
    focusEditor();
  },
  press(key, mods) {
    focusEditor();
    const plainArrow = key.startsWith('Arrow') && !mods.ctrl && !mods.meta;
    if (plainArrow && !mods.shift) {
      const command = { ArrowUp: 'previous-line', ArrowDown: 'next-line', ArrowLeft: 'backward-char', ArrowRight: 'forward-char' }[key];
      if (!VERTICAL.has(command)) goal = null;
      invoke(command);
      if ($('message').classList.contains('error')) beep();
      return;
    }
    const chord = chordOf({ key, ...mods });
    // Shift and an arrow from the key row: on a heading, or up and down on a timestamp, they are the Org keys, as from a keyboard.
    if (plainArrow && !(HEADING_ONLY.has(chord) && (kindAtCursor().kind === 'heading' || stampAt(currentBuffer().text, cursorOffset())))) { moveCursor(key, true); return; }
    if (chord) runChord(chord, { preventDefault() {} }, true);
  },
});

window.addEventListener('beforeunload', (e) => { if (session.unsavedIds().length) e.preventDefault(); });

// ---- Queued saves and the offline cache ----------------------------------------------------------------

async function sendQueued(asked = false) {
  let sent = 0;
  let serverError = null;
  const found = [];
  for (const p of ['github', 'webdav']) {
    if (!providers[p]) continue;
    try {
      const r = await providers[p].sync();
      sent += r.synced.length;
      for (const clash of r.conflicts) found.push({ p, clash });
      if (r.error) serverError = r.error;
    } catch (e) { failure(e); return; }
  }
  if (serverError) message(`${serverError}. Saves stay queued and are sent when the server answers`, true);
  else if (!sent && asked && found.length === 0) message('No saves are waiting');
  else if (sent) message(`Sent ${sent} saved ${sent === 1 ? 'file' : 'files'} to the server`);
  await updatePending();
  if (found.length > 0) await clashList(found);
  await updatePending();
}
window.addEventListener('online', () => sendQueued());
if (navigator.onLine) sendQueued();

// ---- Updates: a new version waits until the user taps Restart ------------------------------------------

/** @type {{ worker: any, version: string } | null} */
let waiting = null;
let restarting = false;

async function updateFound(worker) {
  waiting = { worker, version: await askVersion(worker) };
  message(`Version ${waiting.version} is ready. Menu, then Restart to update.`);
}

function restart() {
  restarting = true;
  waiting.worker.postMessage({ type: 'skip-waiting' });
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (restarting) location.reload(); });
  navigator.serviceWorker.register('sw.js').then((registration) => {
    watchUpdates(registration, navigator.serviceWorker, (w) => updateFound(w).catch(failure));
    const look = () => registration.update().catch(() => {});
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') look(); });
    window.addEventListener('online', look);
    window.__serita = { look };
  }).catch(failure);
}

/** Looks at the open file in storage when you switch to it or come back to the app, and says what it found. A failed check stays quiet; saving reports a failure. */
let missedNotice = null;
async function checkChanged(id) {
  try {
    const b = session.state().buffers.find((x) => x.id === id);
    if (!b) return;
    const r = await session.check(id);
    // A tab in the background shows its notice when it comes back, so it is not missed
    if (r === 'reloaded') { if (document.hidden) missedNotice = `${b.title} changed in storage; reloaded`; else message(`${b.title} changed in storage; reloaded`); }
    else if (r === 'changed') message(`${b.title} changed in storage; saving will ask which copy to keep`, true);
    else if (r === 'gone') message(`${b.title} is no longer in storage`, true);
  } catch { /* offline or unreachable */ }
}
// A file changed by another tab of the app is checked at once; this tab's own saves are not.
const watching = new Map();
session.subscribe(() => {
  const open = new Map(session.state().buffers.filter((b) => b.name).map((b) => [b.id, b.name]));
  for (const [id, w] of watching) if (open.get(id) !== w.name) { w.off(); watching.delete(id); }
  for (const [id, name] of open) if (!watching.has(id)) watching.set(id, { name, off: app.storage.watch(name, (_n, external) => { if (external) checkChanged(id); }) });
});
/** Opens a file from its saved copy; storage is looked at afterward, and a newer copy is loaded (or reported) as for any file. */
async function openFile(name) {
  const r = await session.openFile(name);
  if (r.ok && r.opened) checkChanged(r.id);
  return r;
}
const checkCurrent = () => { const c = session.state().current; if (c !== null) checkChanged(c); };
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (missedNotice) { message(missedNotice); missedNotice = null; }
  checkCurrent();
});
window.addEventListener('online', checkCurrent);

// Reopen what was open before the reload, then keep a copy of the open buffers as they change.
const SESSION_KEY = 'serita.session';
let restoring = true;
function saveSession() {
  if (restoring) return;
  try {
    if (restoreOn() && session.state().buffers.length > 0) localStorage.setItem(SESSION_KEY, JSON.stringify(session.snapshot()));
    else localStorage.removeItem(SESSION_KEY);
  } catch (e) { failure(e); }
}
let saveTimer = null;
session.subscribe(() => { clearTimeout(saveTimer); saveTimer = setTimeout(saveSession, 400); });
config.onChange(() => { clearTimeout(saveTimer); saveTimer = setTimeout(saveSession, 0); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') saveSession(); });

async function startSession() {
  let saved = null;
  try { saved = restoreOn() ? JSON.parse(localStorage.getItem(SESSION_KEY) ?? 'null') : null; } catch (e) { failure(e); }
  const r = saved ? await session.restore(saved) : { opened: 0, skipped: [] };
  if (r.opened === 0) {
    // The first time the app opens, the examples are offered.
    let first = false;
    try { first = localStorage.getItem('serita.samples') === null; localStorage.setItem('serita.samples', 'seen'); } catch { /* storage is unavailable */ }
    const file = first ? await askSample() : undefined;
    if (file) await openSample(file); else session.newScratch();
  }
  restoring = false;
  saveSession();
  // The files were opened from their saved copies; storage is looked at now, without holding anything up.
  for (const b of session.state().buffers) if (b.name) checkChanged(b.id);
  message(r.skipped.length ? `Could not reopen ${r.skipped.join(', ')}` : r.opened > 0 ? 'Reopened your files' : 'Welcome to Serita', r.skipped.length > 0);
}
await startSession();
updatePending().catch(failure);
