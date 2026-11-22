// Screen wiring: toolbar, tabs, editor, mode line, message line, Find, and the bottom panels.
// What happens to buffers and files lives in ui/session.js; this file only draws and listens.

import { createBrowserInterface } from './interface/browser.js';
import { createSession } from './ui/session.js';
import { createConfig } from './ui/config.js';
import { createProviders } from './ui/providers.js';
import { search } from './ui/find.js';
import { createRecent } from './ui/recent.js';
import { children, parentDir } from './storage/browse.js';
import { parseName } from '../core/names.js';
import { formatSize } from '../core/bytes.js';
import { VERSION } from './version.js';
import { h, kept } from './ui/dom.js';
import { analyze, cycle, cycleGlobal, diff, ellipsisLines, hiddenLines, reveal } from '../core/outline.js';
import { backwardChar, backwardWord, forwardChar, forwardWord, lineEnd as endOfLine, lineStart as startOfLine, moveVertical } from '../core/motion.js';
import { DEFAULT_TAGS_COLUMN, changeLevel, cycleTodo, indentItem, insertHeadingAfter, insertHeadingHere, moveItem, moveSubtree, setPriority, setTags, setTitle, stepPriority, toggleCheckbox } from '../core/outline-edit.js';
import { deleteProperty, propertiesOf, propertyNames, setProperty } from '../core/properties.js';
import { createMinibuffer } from './ui/minibuffer.js';
import { duplicateLine, indentLine, killLine, killWholeLine, lineInfo, lineStart, moveLine } from '../core/lines.js';
import { createKillRing } from '../core/killring.js';
import { lineAt, project, toFull, toShown, touchedFold } from '../core/projection.js';
import { renderOutline } from './ui/outline-view.js';
import { TEXT_KEYS, chordOf, createKeymap } from './ui/keys.js';
import { createKeyRow } from './ui/keyrow.js';
import { askVersion, watchUpdates } from './ui/update.js';
import { exportSettings, importSettings, inspectSettingsFile, settingsFileName, SettingsFileError } from '../core/settings-file.js';

const $ = (id) => document.getElementById(id);

/** Puts the given content in a panel, leaving out anything empty. */
function put(sheet, ...kids) {
  sheet.replaceChildren(...kept(kids));
  for (const b of sheet.querySelectorAll('button')) if (b.textContent === 'Cancel') b.classList.add('cancel');
}

const config = createConfig(localStorage);
const { providers, rebuild } = await createProviders({ config, indexedDB, env: window, isOnline: () => navigator.onLine });
const app = createBrowserInterface({ providers, env: window });
const session = createSession({ app });
const recent = createRecent(localStorage);

const editor = $('editor');
let shownId = null;
let cur = null;        // what the views show now: { id, a (the outline), proj (the Text view's projection) }
let pendingSel = null; // where the cursor goes after the next render, in the real text

const setting = (k) => config.settings()[k];
const viewMode = () => (setting('view.mode') === 'outline' ? 'outline' : 'text');
const emacsKeys = () => setting('view.emacsKeys') === 'true';
const hideStars = () => setting('view.hideStars') === 'true';
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
    const scrim = h('div', { class: 'scrim' });
    const sheet = h('div', { class: 'sheet', role: 'dialog' });
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(undefined); } };
    function close(value) {
      scrim.remove(); sheet.remove();
      document.removeEventListener('keydown', onKey, true);
      resolve(value);
    }
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
      h('div', { class: 'list' }, items.map((it) => h('button', { class: `item${it.dim ? ' dim' : ''}`, onclick: () => close(it.value) },
        h('span', {}, it.label), it.meta ? h('span', { class: 'meta' }, it.meta) : null))),
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
    h('button', { class: 'title', onclick: () => session.select(b.id), title: b.name ?? b.title }, b.title + (b.dirty ? ' *' : '')),
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
  // With the key row shown, tapping the text does not raise the on-screen keyboard; the keyboard button does.
  editor.inputMode = $('keyrow').hidden || softKeyboard ? 'text' : 'none';
  editor.disabled = !shown;
  if (shown) {
    const a = analyze(shown.text);
    const proj = project(shown.text, hiddenLines(a.foldables, shown.folds), ellipsisLines(a.foldables, shown.folds), { hideStars: hideStars() });
    cur = { id: shown.id, a, proj };
    if (editor.value !== proj.value) {
      editor.value = proj.value;
      const sel = pendingSel !== null ? { start: pendingSel, end: pendingSel } : before;
      if (sel) editor.setSelectionRange(toShown(proj, sel.start), toShown(proj, sel.end));
    }
    pendingSel = null;
    if (mode === 'outline') renderOutline($('outline'), { text: shown.text, folds: shown.folds, hideStars: hideStars(), on: outlineOn });
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
function paintOverlay() {
  const hl = $('hl');
  if (!cur || editor.hidden || (!hit && !lineNumbers())) { hl.replaceChildren(); return; }
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
  try { return await handleSave(await session.saveAs(id, picked, { overwrite: true }), id); } catch (e) { failure(e); return false; }
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
  let provider = current ? parseName(current).provider : 'local';
  if (!(provider in providers) || (mode === 'open' && provider === 'device')) provider = 'local';
  let dir = current ? parseName(current).path.replace(/[^/]*$/, '') : '';
  return panel((sheet, close) => {
    let listing = { folders: [], files: [] };
    let loadError = null;
    const nameInput = mode === 'saveas' ? h('input', { value: suggested, 'aria-label': 'File name', oninput: () => draw() }) : null;
    const ok = h('button', { class: 'primary' });

    async function load() {
      if (provider === 'device') { listing = { folders: [], files: [] }; loadError = null; draw(); return; }
      try {
        const all = await app.storage.entries(`${provider}:`);
        listing = children(all.map((e) => ({ path: parseName(e.name).path, size: e.size })), dir);
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
      const typed = nameInput?.value.trim() ?? '';
      const there = listing.files.find((f) => f.name === typed);
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
        there ? h('p', { class: 'tag' }, `${there.name} exists${there.size === null ? '' : ` (${formatSize(there.size)})`}. Saving replaces it.`) : null,
        h('div', { class: 'row' }, h('button', { onclick: () => close(undefined) }, 'Cancel'),
          mode === 'saveas' ? Object.assign(ok, { textContent: there ? 'Replace' : 'Save', onclick: async () => {
            if (!typed) return;
            if (provider !== 'device') { close(`${provider}:${dir}${typed}`); return; }
            try { const path = await providers.device.pickSave(typed); if (path) close(`device:${path}`); } catch (e) { loadError = e.message; draw(); }
          } }) : null));
    }
    load();
  });
}

// ---- Find ------------------------------------------------------------------------------------------

let finding = null;
const mini = createMinibuffer({ root: $('findbar'), list: $('completions'), bell: () => beep(), restoreFocus: () => { if (viewMode() === 'text') editor.focus({ preventScroll: true }); } });

function startFind(backward = false) {
  if (finding || shownId === null) return;
  if (viewMode() === 'outline') setView('text');
  finding = { start: toFull(cur.proj, editor.selectionStart), end: toFull(cur.proj, editor.selectionEnd), folds: currentBuffer().folds };
  let mb;
  let dir = backward;
  const name = () => (dir ? 'I-search backward:' : 'I-search:');
  const input = () => mb.input;
  const show = (found) => {
    const b = currentBuffer();
    const opened = reveal(cur.a.foldables, b.folds, b.text.slice(0, found.start).split('\n').length - 1);
    if (JSON.stringify(opened) !== JSON.stringify(b.folds)) session.setFolds(b.id, opened);
    const start = toShown(cur.proj, found.start);
    const m = { start, end: start + (found.end - found.start) };
    editor.setSelectionRange(m.start, m.end);
    const mirror = $('mirror');
    mirror.style.width = `${editor.clientWidth}px`;
    mirror.textContent = `${editor.value.slice(0, m.start)}.`;
    editor.scrollTop = Math.max(0, mirror.scrollHeight - editor.clientHeight / 2);
    hit = m;
    paintOverlay();
    renderModeLine();
  };
  const go = (backward, from) => {
    const q = input().value;
    if (q === '') { mb.setPrompt(name()); return; }
    const m = search(currentBuffer().text, q, { from, backward });
    if (!m) { mb.setPrompt(`Failing ${name()}`, true); beep(); return; }
    mb.setPrompt(m.wrapped ? `Wrapped ${name()}` : name());
    show(m);
  };
  const end = (restore) => {
    if (restore) {
      if (JSON.stringify(currentBuffer().folds) !== JSON.stringify(finding.folds)) session.setFolds(shownId, finding.folds);
      editor.setSelectionRange(toShown(cur.proj, finding.start), toShown(cur.proj, finding.end));
    }
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
  const step = (back) => { dir = back; mb.setPrompt(name()); go(back, back ? selStart() : selEnd()); };
  mb = mini.open({
    prompt: name(),
    label: 'Search',
    onInput: () => go(dir, dir ? selEnd() : selStart()),
    onKey(e) {
      if (e.key === 'Enter') { e.preventDefault(); end(false); return true; }
      if (e.key === 'Escape' || (e.ctrlKey && e.key === 'g')) { e.preventDefault(); e.stopPropagation(); end(true); return true; }
      if (e.ctrlKey && (e.key === 's' || e.key === 'r')) { e.preventDefault(); step(e.key === 'r'); return true; }
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
  const s = config.settings();
  if (p === 'github') return config.githubReady() ? `${s['github.owner']}/${s['github.repo']}` : 'not set up';
  return config.webdavReady() ? s['webdav.url'] : 'not set up';
}

async function settings() {
  for (;;) {
    const what = await panel((sheet, close) => {
      put(sheet, h('h2', {}, 'Settings'),
        h('div', { class: 'list' },
          h('button', { class: 'item', onclick: () => close('github') }, h('span', {}, 'GitHub'), h('span', { class: 'meta' }, `${summary('github')} ›`)),
          h('button', { class: 'item', onclick: () => close('webdav') }, h('span', {}, 'WebDAV'), h('span', { class: 'meta' }, `${summary('webdav')} ›`)),
          h('button', { class: 'item', onclick: () => close('emacs') }, h('span', {}, 'Emacs keys'), h('span', { class: 'meta' }, emacsKeys() ? 'On ›' : 'Off ›')),
          h('button', { class: 'item', onclick: () => close('stars') }, h('span', {}, 'Hide leading stars'), h('span', { class: 'meta' }, hideStars() ? 'On ›' : 'Off ›')),
          h('button', { class: 'item', onclick: () => close('appearance') }, h('span', {}, 'Appearance'), h('span', { class: 'meta' }, `${theme()[0].toUpperCase()}${theme().slice(1)}, ${fontSize()}px ›`)),
          h('button', { class: 'item', onclick: () => close('tags-column') }, h('span', {}, 'Tag column'), h('span', { class: 'meta' }, `${tagsColumn()} ›`)),
          h('button', { class: 'item', onclick: () => close('restore') }, h('span', {}, 'Restore open files on start'), h('span', { class: 'meta' }, restoreOn() ? 'On ›' : 'Off ›')),
          h('button', { class: 'item', onclick: () => close('tools-text') }, h('span', {}, 'Tool row in the Text view'), h('span', { class: 'meta' }, toolRowOn('text') ? 'On ›' : 'Off ›')),
          h('button', { class: 'item', onclick: () => close('keylog') }, h('span', {}, 'Key event log'), h('span', { class: 'meta' }, keyLogOn() ? 'On ›' : 'Off ›')),
          h('button', { class: 'item', onclick: () => close('beep') }, h('span', {}, 'Beep on errors'), h('span', { class: 'meta' }, beepOn() ? 'On ›' : 'Off ›')),
          h('button', { class: 'item', onclick: () => close('tools-outline') }, h('span', {}, 'Tool row in the Outline view'), h('span', { class: 'meta' }, toolRowOn('outline') ? 'On ›' : 'Off ›')),
          h('div', { class: 'item', style: 'display:flex;align-items:center;justify-content:space-between;padding:4px 0' }, h('span', {}, 'Settings file'),
            h('span', { class: 'row' }, h('button', { onclick: () => close('export') }, 'Export'), h('button', { onclick: () => close('import') }, 'Import')))),
        h('div', { class: 'list' },
          h('div', { class: 'item' }, h('span', {}, 'Installed version'), h('span', { class: 'meta' }, VERSION)),
          waiting ? h('div', { class: 'item' }, h('span', {}, 'New version'), h('span', { class: 'meta' }, waiting.version)) : null),
        waiting ? h('div', { class: 'row' }, h('button', { class: 'primary', onclick: () => { close(undefined); restart(); } }, 'Restart to update')) : null,
        h('p', {}, 'Tokens and passwords are kept in this browser, on this device.'),
        h('div', { class: 'row' }, h('button', { onclick: () => close(undefined) }, 'Close')));
    });
    if (what === undefined) return;
    if (what === 'github' || what === 'webdav') await setup(what);
    else if (what === 'emacs') config.update({ settings: { 'view.emacsKeys': String(!emacsKeys()) } });
    else if (what === 'stars') config.update({ settings: { 'view.hideStars': String(!hideStars()) } });
    else if (what === 'appearance') await appearance();
    else if (what === 'tags-column') await tagsColumnDialog();
    else if (what === 'beep') config.update({ settings: { 'view.beep': String(!beepOn()) } });
    else if (what === 'keylog') { config.update({ settings: { 'view.keyLog': String(!keyLogOn()) } }); klog('log', 'on'); }
    else if (what === 'restore') config.update({ settings: { 'session.restore': String(!restoreOn()) } });
    else if (what === 'tools-text') config.update({ settings: { 'view.toolRowText': String(!toolRowOn('text')) } });
    else if (what === 'tools-outline') config.update({ settings: { 'view.toolRowOutline': String(!toolRowOn('outline')) } });
    else if (what === 'export') { await exportDialog(); return; }
    else { $('import-file').click(); return; }
  }
}

async function tagsColumnDialog() {
  const value = await panel((sheet, close) => {
    const input = h('input', { value: String(tagsColumn()), inputmode: 'numeric', autocomplete: 'off', 'aria-label': 'Tag column' });
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); close(input.value); } });
    put(sheet, h('h2', {}, 'Tag column'),
      h('p', {}, `A negative number is the column where the heading and its tags end; a positive one is the column where the tags start; 0 puts them one space after the title. The default is ${DEFAULT_TAGS_COLUMN}.`),
      input,
      h('div', { class: 'row' }, h('button', { onclick: () => close(undefined) }, 'Cancel'), h('button', { class: 'primary', onclick: () => close(input.value) }, 'Set')));
    input.focus();
  });
  if (value === undefined) return;
  if (!/^-?\d+$/.test(value.trim())) { message('Enter a whole number', true); return; }
  config.update({ settings: { 'org.tagsColumn': String(Number(value)) } });
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
    const r = await session.openFile(name);
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
          row('Save some buffers', 'some', session.unsavedIds().length === 0)),
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
  else if (what === 'open') {
    const name = await browse({ mode: 'open' });
    if (name) await openNamed(name);
  } else if (what === 'save') { if (shownId !== null) await saveBuffer(shownId); }
  else if (what === 'saveas') { if (shownId !== null) await saveAs(shownId); }
  else if (what === 'some') await saveSomeBuffers();
}

$('btn-files').addEventListener('click', filesMenu);
$('btn-save').addEventListener('click', () => { if (shownId !== null) saveBuffer(shownId); });
$('btn-find').addEventListener('click', () => startFind());
$('btn-view').addEventListener('click', async () => {
  const what = await choose(null, ['outline', 'text'].map((v) => ({ label: v === 'outline' ? 'Outline' : 'Text', meta: viewMode() === v ? 'current' : null, value: v })));
  if (what) setView(what);
});
$('btn-menu').addEventListener('click', async () => {
  const what = await choose(null, [
    waiting ? { label: 'Restart to update', meta: `${VERSION} to ${waiting.version}`, value: 'restart' } : null,
    { label: 'Commands', value: 'commands' },
    { label: 'Settings', value: 'settings' }].filter(Boolean));
  if (what === 'restart') restart();
  else if (what === 'commands') await commandPalette();
  else if (what === 'settings') await settings();
});

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
}

/** Calls `fn(line)` with the line of the enclosing heading. */
function withHeading(fn) {
  const hd = enclosingHead();
  if (!hd) { message('Not at a heading'); return; }
  return fn(hd.line);
}

const COMMANDS = {
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
  'beginning-of-buffer': () => goTo(0),
  'end-of-buffer': () => goTo(editor.value.length),
  'quit': () => message('Quit', true),
  'cycle': () => { const { line, kind } = kindAtCursor(); if (kind === null) message('Not at a heading or list item'); else cycleHeading(line); },
  'cycle-global': () => {
    const b = currentBuffer();
    const r = cycleGlobal(cur.a.heads, b.folds);
    session.setFolds(b.id, r.folds);
    message(r.state.toUpperCase());
  },
  'move-up': () => editHere((t, l) => moveSubtree(t, l, -1), (t, l) => moveItem(t, l, -1)),
  'move-down': () => editHere((t, l) => moveSubtree(t, l, 1), (t, l) => moveItem(t, l, 1)),
  'promote': () => editHere((t, l) => changeLevel(t, l, -1, false), (t, l) => indentItem(t, l, -1, false)),
  // On plain text Emacs's M-right moves a word forward.
  'demote': () => (kindAtCursor().kind === null ? COMMANDS['forward-word']() : editHere((t, l) => changeLevel(t, l, 1, false), (t, l) => indentItem(t, l, 1, false))),
  'promote-subtree': () => editHere((t, l) => changeLevel(t, l, -1, true), (t, l) => indentItem(t, l, -1, true)),
  'demote-subtree': () => editHere((t, l) => changeLevel(t, l, 1, true), (t, l) => indentItem(t, l, 1, true)),
  // On a heading or in its body: a new sibling heading after the subtree, as C-RET does in Emacs.
  'insert-heading': () => {
    const { line, kind } = kindAtCursor();
    if (kind === 'item') { message('Not at a heading'); return; }
    const head = [...cur.a.heads].reverse().find((x) => x.line <= line);
    if (!head) { message('Not at a heading'); return; }
    const r = runEdit((t) => insertHeadingAfter(t, head.line));
    if (r) placeCursor(r.line, true);
  },
  'todo': () => onEnclosingHeading((t, l) => cycleTodo(t, l, 1, tagsColumn())),
  'todo-next': () => onEnclosingHeading((t, l) => cycleTodo(t, l, 1, tagsColumn())),
  'todo-previous': () => onEnclosingHeading((t, l) => cycleTodo(t, l, -1, tagsColumn())),
  'priority-up': () => onEnclosingHeading((t, l) => stepPriority(t, l, -1, tagsColumn())),
  'priority-down': () => onEnclosingHeading((t, l) => stepPriority(t, l, 1, tagsColumn())),
  'priority': () => withHeading(priorityDialog),
  'set-property': () => withHeading(setPropertyDialog),
  'delete-property': () => withHeading(deletePropertyDialog),
  'set-tags': () => withHeading(setTagsDialog),
  'isearch-forward': () => startFind(false),
  'isearch-backward': () => startFind(true),
  'execute-command': () => commandPalette(),
  'toggle-checkbox': () => { if (!runEdit((t) => toggleCheckbox(t, kindAtCursor().line))) message('Nothing to do here'); },
  'insert-heading-here': () => { const r = runEdit((t) => insertHeadingHere(t, cursorOffset())); if (r) placeOffset(r.pos); },
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

function placeOffset(p) {
  const s = toShown(cur.proj, p);
  editor.setSelectionRange(s, s);
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
function askText({ prompt, title, help = null, value = '', complete = null, inputMode = 'text', ok = 'OK' }) {
  if (viewMode() === 'text') return mini.ask({ prompt, value, complete, inputMode });
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
    ? await mini.ask({ prompt: 'Priority A-C, or SPC to remove:', value: '' })
    : await choose('Priority', [...['A', 'B', 'C'].map((p) => ({ label: p, meta: hd.priority === p ? 'current' : null, value: p })), { label: 'None', value: '' }]);
  if (value === undefined) return;
  const p = value.trim().toUpperCase();
  if (p !== '' && !/^[A-C]$/.test(p)) { message('Priority must be A, B or C', true); beep(); return; }
  runEdit((t) => setPriority(t, line, p === '' ? null : p, tagsColumn()));
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
  const value = await askText({ prompt: 'Value:', title: name, value: old, ok: 'Set' });
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
  const what = await choose(hd.title || '(empty heading)', [
    { label: 'Change TODO state', meta: `${hd.todo ?? 'none'} to ${next ?? 'none'}`, value: 'todo' },
    { label: 'Promote', meta: hd.level > 1 ? `to level ${hd.level - 1}` : null, value: 'promote' },
    { label: 'Demote', meta: `to level ${hd.level + 1}`, value: 'demote' },
    { label: 'Promote subtree', value: 'promote-subtree' },
    { label: 'Demote subtree', value: 'demote-subtree' },
    { label: 'Move up', value: 'move-up' },
    { label: 'Move down', value: 'move-down' },
    { label: 'Insert heading below', value: 'insert' },
    { label: 'Change priority', meta: hd.priority ? `[#${hd.priority}]` : null, value: 'priority' },
    { label: 'Set tags', meta: hd.tags.length ? `:${hd.tags.join(':')}:` : null, value: 'tags' },
    { label: 'Set property', value: 'property' },
    { label: 'Edit title', value: 'edit' },
  ]);
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
  else if (what === 'edit') {
    const title = await askTitle('Edit heading title', hd.title);
    if (title !== undefined) runEdit((t) => setTitle(t, line, title, tagsColumn()));
  } else if (what === 'insert') {
    const title = await askTitle('New heading', '');
    if (title !== undefined) runEdit((t) => insertHeadingAfter(t, line, title));
  }
}

// Swiping a heading from right to left cycles it, like TAB.
let swipe = null;
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
};

// ---- The command palette --------------------------------------------------------------------------------

// Every command has a plain label, its Emacs name and (below) the key it is on. `outline` marks the ones that make sense with no cursor.
const PALETTE = [
  ['cycle', 'org-cycle', 'Fold or unfold'], ['cycle-global', 'org-shifttab', 'Fold or unfold everything', true],
  ['todo', 'org-todo', 'Change TODO state'], ['todo-next', 'org-shiftright', 'Next TODO state'], ['todo-previous', 'org-shiftleft', 'Previous TODO state'],
  ['priority', 'org-priority', 'Set priority'], ['priority-up', 'org-priority-up', 'Raise priority'], ['priority-down', 'org-priority-down', 'Lower priority'],
  ['set-tags', 'org-set-tags-command', 'Set tags'], ['set-property', 'org-set-property', 'Set property'], ['delete-property', 'org-delete-property', 'Delete property'],
  ['promote', 'org-metaleft', 'Promote'], ['demote', 'org-metaright', 'Demote'], ['promote-subtree', 'org-shiftmetaleft', 'Promote subtree'], ['demote-subtree', 'org-shiftmetaright', 'Demote subtree'],
  ['move-up', 'org-metaup', 'Move up'], ['move-down', 'org-metadown', 'Move down'],
  ['insert-heading', 'org-insert-heading-respect-content', 'Insert heading after subtree'], ['insert-heading-here', 'org-meta-return', 'Insert heading here'],
  ['toggle-checkbox', 'org-toggle-checkbox', 'Toggle checkbox'],
  ['isearch-forward', 'isearch-forward', 'Find forward', true], ['isearch-backward', 'isearch-backward', 'Find backward', true], ['goto-line', 'goto-line', 'Go to line', true],
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
    if (name === undefined || name.trim() === '') return;
    entry = entries.find((e) => e.name === name);
    if (!entry) { message('[No match]', true); beep(); return; }
  } else {
    entry = await panel((sheet, close) => {
      sheet.classList.add('full');
      const input = h('input', { placeholder: 'Search commands', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Search commands' });
      const list = h('div', { class: 'list' });
      const fill = () => list.replaceChildren(...found(input.value).map((e) => h('button', { class: 'item', onclick: () => close(e) },
        h('span', {}, e.label), h('span', { class: 'meta' }, `${e.name}${e.key ? `  ${e.key}` : ''}`))));
      input.addEventListener('input', fill);
      fill();
      put(sheet, h('h2', {}, 'Commands'), input, list, h('div', { class: 'row' }, h('button', { onclick: () => close(undefined) }, 'Cancel')));
      input.focus();
    });
    if (!entry) return;
  }
  goal = null;
  await COMMANDS[entry.command]();
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
function goTo(p) { editor.setSelectionRange(p, p); renderModeLine(); }
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
    COMMANDS[r.command]();
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
  if (HEADING_ONLY.has(chord) && kindAtCursor().kind !== 'heading') return; // elsewhere the arrows select, as usual
  if ((chord === 'C-c' || chord === 'C-x' || chord === 'C-v') && !held.ctrl && keymap.pending() === '') return; // a keyboard's own C-c, C-x and C-v stay copy, cut and paste; the prefixes come from the key row
  if (chord) runChord(chord, e, fromRow);
  else if (keymap.pending() && e.key.length === 1) runChord(e.key, e, false);
  // An on-screen keyboard sends its letters as Unidentified or Process key presses followed by typed text (the beforeinput handler below); the held keys wait for that text.
  if (fromRow && !MODIFIER_KEYS.includes(e.key) && !SOFT_KEYS.includes(e.key) && e.keyCode !== 229) keyRow.clear();
});

// A log of what the keyboard sends the editor, for finding out why a key does not do what it should (Settings, Key event log).
const keylog = $('keylog');
function klog(...parts) {
  keylog.hidden = !keyLogOn();
  if (!keyLogOn()) return;
  keylog.textContent = [...(keylog.textContent ? keylog.textContent.split('\n') : []), parts.join(' ')].slice(-14).join('\n');
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
    if (plainArrow) { moveCursor(key, mods.shift); return; }
    const chord = chordOf({ key, ...mods });
    if (chord) runChord(chord, { preventDefault() {} }, true);
  },
});

window.addEventListener('beforeunload', (e) => { if (session.unsavedIds().length) e.preventDefault(); });

// ---- Queued saves and the offline cache ----------------------------------------------------------------

async function sendQueued() {
  let sent = 0;
  const found = [];
  for (const p of ['github', 'webdav']) {
    if (!providers[p]) continue;
    try {
      const r = await providers[p].sync();
      sent += r.synced.length;
      for (const clash of r.conflicts) found.push({ p, clash });
    } catch (e) { failure(e); return; }
  }
  if (sent) message(`Sent ${sent} saved ${sent === 1 ? 'file' : 'files'} to the server`);
  await updatePending();
  if (found.length > 0) await clashList(found);
  await updatePending();
}
window.addEventListener('online', sendQueued);
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
  if (r.opened === 0) session.newScratch();
  restoring = false;
  saveSession();
  message(r.skipped.length ? `Could not reopen ${r.skipped.join(', ')}` : r.opened > 0 ? 'Reopened your files' : 'Welcome to Serita', r.skipped.length > 0);
}
await startSession();
updatePending().catch(failure);
