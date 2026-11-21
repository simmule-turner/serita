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
import { changeLevel, cycleTodo, insertHeadingAfter, moveSubtree, setTags, toggleCheckbox } from '../core/outline-edit.js';
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

function message(text, isError = false) {
  const el = $('message');
  el.textContent = text;
  el.classList.toggle('error', isError);
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
    document.addEventListener('keydown', onKey, true);
    $('layer').append(scrim, sheet);
    build(sheet, close);
  });
}

/** A list of choices. Items are { label, value, meta? }. */
function choose(title, items, { cancel = true } = {}) {
  return panel((sheet, close) => {
    put(sheet, 
      title ? h('h2', {}, title) : null,
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
  editor.hidden = mode !== 'text';
  $('outline').hidden = mode !== 'outline';
  $('keyrow').hidden = !(mode === 'text' && emacsKeys() && shown);
  editor.disabled = !shown;
  if (shown) {
    const a = analyze(shown.text);
    const proj = project(shown.text, hiddenLines(a.heads, shown.folds), ellipsisLines(a.heads, shown.folds), { hideStars: hideStars() });
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
  renderModeLine();
}

// An edit of the shown text becomes an edit of the real text; a change touching a "..." opens that fold first.
editor.addEventListener('input', () => {
  $('hl').replaceChildren();
  const b = currentBuffer();
  if (!b || !cur) return;
  const d = diff(cur.proj.value, editor.value);
  const open = touchedFold(cur.proj, d.from, d.to, d.insert);
  const from = toFull(cur.proj, d.from);
  pendingSel = from + d.insert.length;
  session.setText(b.id, b.text.slice(0, from) + d.insert + b.text.slice(toFull(cur.proj, d.to)));
  if (open !== null) { const folds = { ...currentBuffer().folds }; delete folds[open]; session.setFolds(b.id, folds); }
});
editor.addEventListener('scroll', () => { $('hl').scrollTop = editor.scrollTop; });
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

function startFind() {
  if (finding || shownId === null) return;
  if (viewMode() === 'outline') setView('text');
  finding = { start: toFull(cur.proj, editor.selectionStart), end: toFull(cur.proj, editor.selectionEnd) };
  const input = h('input', { 'aria-label': 'Search', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
  const show = (found) => {
    const b = currentBuffer();
    const opened = reveal(cur.a.heads, b.folds, b.text.slice(0, found.start).split('\n').length - 1);
    if (JSON.stringify(opened) !== JSON.stringify(b.folds)) session.setFolds(b.id, opened);
    const start = toShown(cur.proj, found.start);
    const m = { start, end: start + (found.end - found.start) };
    editor.setSelectionRange(m.start, m.end);
    const mirror = $('mirror');
    mirror.style.width = `${editor.clientWidth}px`;
    mirror.textContent = `${editor.value.slice(0, m.start)}.`;
    editor.scrollTop = Math.max(0, mirror.scrollHeight - editor.clientHeight / 2);
    const hl = $('hl');
    hl.style.width = `${editor.clientWidth}px`;
    hl.replaceChildren(editor.value.slice(0, m.start), h('mark', {}, editor.value.slice(m.start, m.end)), editor.value.slice(m.end));
    hl.scrollTop = editor.scrollTop;
    renderModeLine();
  };
  const go = (backward, from) => {
    const q = input.value;
    if (q === '') { message(''); return; }
    const m = search(currentBuffer().text, q, { from, backward });
    if (!m) { message(`Failing I-search: ${q}`, true); return; }
    message(m.wrapped ? 'Wrapped' : '');
    show(m);
  };
  const end = (restore) => {
    if (restore) editor.setSelectionRange(toShown(cur.proj, finding.start), toShown(cur.proj, finding.end));
    finding = null;
    $('hl').replaceChildren();
    $('findbar').hidden = true;
    $('findbar').replaceChildren();
    message('');
    renderModeLine();
  };
  const selStart = () => toFull(cur.proj, editor.selectionStart);
  const selEnd = () => toFull(cur.proj, editor.selectionEnd);
  input.addEventListener('input', () => go(false, selStart()));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); end(false); editor.focus(); }
    else if (e.key === 'Escape') { e.stopPropagation(); end(true); }
  });
  $('findbar').replaceChildren(
    h('span', { class: 'label' }, 'I-search:'), input,
    h('button', { 'aria-label': 'Previous match', onclick: () => go(true, selStart()) }, '▲'),
    h('button', { 'aria-label': 'Next match', onclick: () => go(false, selEnd()) }, '▼'),
    h('button', { 'aria-label': 'Cancel search', onclick: () => end(true) }, '✕'));
  $('findbar').hidden = false;
  input.focus();
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
    else if (what === 'export') { await exportDialog(); return; }
    else { $('import-file').click(); return; }
  }
}

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
$('btn-find').addEventListener('click', startFind);
$('btn-view').addEventListener('click', async () => {
  const what = await choose(null, ['outline', 'text'].map((v) => ({ label: v === 'outline' ? 'Outline' : 'Text', meta: viewMode() === v ? 'current' : null, value: v })));
  if (what) setView(what);
});
$('btn-menu').addEventListener('click', async () => {
  const what = await choose(null, [
    waiting ? { label: 'Restart to update', meta: `${VERSION} to ${waiting.version}`, value: 'restart' } : null,
    { label: 'Settings', value: 'settings' }].filter(Boolean));
  if (what === 'restart') restart();
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
  try {
    const r = fn(b.text);
    if (r) session.apply(b.id, r);
    return r;
  } catch (e) { failure(e); return null; }
}

const headingAtCursor = () => {
  const line = lineAt(cur.proj, editor.selectionStart);
  return cur.a.heads.some((x) => x.line === line) ? line : null;
};

function editAtHeading(fn, atEnd = false) {
  const line = headingAtCursor();
  if (line === null) { message('Not at a heading'); return; }
  const r = runEdit((t) => fn(t, line));
  if (r) placeCursor(r.line, atEnd);
}

function cycleHeading(line) {
  const b = currentBuffer();
  const r = cycle(cur.a.heads, b.folds, line);
  if (r) { session.setFolds(b.id, r.folds); message(r.state.toUpperCase()); }
}

const COMMANDS = {
  'cycle': () => { const line = headingAtCursor(); if (line === null) message('Not at a heading'); else cycleHeading(line); },
  'cycle-global': () => {
    const b = currentBuffer();
    const r = cycleGlobal(cur.a.heads, b.folds);
    session.setFolds(b.id, r.folds);
    message(r.state.toUpperCase());
  },
  'move-up': () => editAtHeading((t, l) => moveSubtree(t, l, -1)),
  'move-down': () => editAtHeading((t, l) => moveSubtree(t, l, 1)),
  'promote': () => editAtHeading((t, l) => changeLevel(t, l, -1, false)),
  'demote': () => editAtHeading((t, l) => changeLevel(t, l, 1, false)),
  'promote-subtree': () => editAtHeading((t, l) => changeLevel(t, l, -1, true)),
  'demote-subtree': () => editAtHeading((t, l) => changeLevel(t, l, 1, true)),
  'insert-heading': () => editAtHeading(insertHeadingAfter, true),
  'todo': () => editAtHeading(cycleTodo),
};

async function setTagsDialog(line) {
  const hd = cur.a.heads.find((x) => x.line === line);
  const value = await panel((sheet, close) => {
    const input = h('input', { value: hd.tags.join(':'), autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Tags' });
    put(sheet, h('h2', {}, 'Tags'), h('p', {}, 'Separate tags with a colon, for example work:home.'),
      h('div', {}, h('label', {}, 'Tags'), input),
      h('div', { class: 'row' }, h('button', { onclick: () => close(undefined) }, 'Cancel'), h('button', { class: 'primary', onclick: () => close(input.value) }, 'Set')));
  });
  if (value === undefined) return;
  const tags = value.split(':').map((s) => s.trim()).filter(Boolean);
  if (tags.some((t) => !/^[\p{L}\p{N}_@#%]+$/u.test(t))) { message('Tags can have letters, digits and _ @ # %', true); return; }
  runEdit((t) => setTags(t, line, tags));
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
    { label: 'Set tags', meta: hd.tags.length ? `:${hd.tags.join(':')}:` : null, value: 'tags' },
    { label: 'Edit in Text view', value: 'edit' },
  ]);
  const run = {
    todo: () => cycleTodo, promote: () => (t, l) => changeLevel(t, l, -1, false), demote: () => (t, l) => changeLevel(t, l, 1, false),
    'promote-subtree': () => (t, l) => changeLevel(t, l, -1, true), 'demote-subtree': () => (t, l) => changeLevel(t, l, 1, true),
    'move-up': () => (t, l) => moveSubtree(t, l, -1), 'move-down': () => (t, l) => moveSubtree(t, l, 1),
  };
  if (what === undefined) return;
  if (run[what]) runEdit((t) => run[what]()(t, line));
  else if (what === 'tags') await setTagsDialog(line);
  else if (what === 'edit' || what === 'insert') {
    const r = what === 'insert' ? runEdit((t) => insertHeadingAfter(t, line)) : { line };
    if (!r) return;
    setView('text');
    placeCursor(r.line, what === 'insert');
    editor.focus();
  }
}

const outlineOn = {
  cycle: cycleHeading,
  todo: (line) => runEdit((t) => cycleTodo(t, line)),
  checkbox: (line) => runEdit((t) => toggleCheckbox(t, line)),
  actions: headingActions,
};

// Emacs keys in the Text view: a key press becomes a chord, and a chord a command. A key held by the key row
// (Meta, Ctrl, Shift) applies to the next key only.
const keymap = createKeymap(TEXT_KEYS);

function runChord(chord, event, fromRow) {
  const r = keymap.press(chord);
  if (r.kind === 'run') { event.preventDefault(); message(''); COMMANDS[r.command](); }
  else if (r.kind === 'prefix') { event.preventDefault(); message(r.echo); }
  else if (r.echo) { event.preventDefault(); message(r.echo); }
  else if (fromRow) { event.preventDefault(); message(`${chord} is undefined`); }
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

const MODIFIER_KEYS = ['Control', 'Alt', 'Meta', 'Shift'];

editor.addEventListener('keydown', (e) => {
  if (!emacsKeys() || viewMode() !== 'text') return;
  const held = keyRow.sticky();
  const fromRow = held.ctrl || held.meta || held.shift;
  const chord = chordOf({ key: e.key, ctrl: e.ctrlKey || held.ctrl, meta: e.altKey || e.metaKey || held.meta, shift: e.shiftKey || held.shift });
  if (chord) runChord(chord, e, fromRow);
  else if (keymap.pending() && e.key.length === 1) runChord(e.key, e, false);
  if (fromRow && !MODIFIER_KEYS.includes(e.key)) keyRow.clear();
});

const keyRow = createKeyRow({
  root: $('keyrow'),
  store: localStorage,
  toggleKeyboard: () => { if (document.activeElement === editor) editor.blur(); else editor.focus(); },
  press(key, mods) {
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

session.newScratch();
message('Welcome to Serita');
updatePending().catch(failure);
