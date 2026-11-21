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
import { exportSettings, importSettings, inspectSettingsFile, settingsFileName, SettingsFileError } from '../core/settings-file.js';

const $ = (id) => document.getElementById(id);
const kept = (kids) => kids.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false);

/** Puts the given content in a panel, leaving out anything empty. */
function put(sheet, ...kids) {
  sheet.replaceChildren(...kept(kids));
  for (const b of sheet.querySelectorAll('button')) if (b.textContent === 'Cancel') b.classList.add('cancel');
}

function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== false) el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...kept(kids));
  return el;
}

const config = createConfig(localStorage);
const { providers, rebuild } = await createProviders({ config, indexedDB, isOnline: () => navigator.onLine });
const app = createBrowserInterface({ providers, env: window });
const session = createSession({ app });
const recent = createRecent(localStorage);

const editor = $('editor');
let shownId = null;

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

function cursorPosition() {
  const before = editor.value.slice(0, editor.selectionStart);
  const line = before.split('\n').length;
  return { line, col: before.length - (before.lastIndexOf('\n') + 1) };
}

const STORAGE_LABEL = { local: 'Local', github: 'GitHub', webdav: 'WebDAV' };

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
  $('modeline').textContent = `${b.dirty ? '**' : '--'}  ${where}  ${scrollPosition()}  L${line} C${col}`;
}

function render() {
  const s = session.state();
  $('tabs').replaceChildren(...s.buffers.map((b) => h('span', { class: `tab${b.id === s.current ? ' current' : ''}` },
    h('button', { class: 'title', onclick: () => session.select(b.id), title: b.name ?? b.title }, b.title + (b.dirty ? ' *' : '')),
    h('button', { 'aria-label': `Close ${b.title}`, onclick: () => closeBuffer(b.id) }, '×'))));
  if (s.current !== shownId) {
    shownId = s.current;
    const b = s.buffers.find((x) => x.id === s.current);
    editor.disabled = !b;
    editor.value = b?.text ?? '';
  }
  renderModeLine();
}

editor.addEventListener('input', () => { $('hl').replaceChildren(); if (shownId !== null) session.setText(shownId, editor.value); });
editor.addEventListener('scroll', () => { $('hl').scrollTop = editor.scrollTop; });
for (const ev of ['keyup', 'click', 'select', 'scroll']) editor.addEventListener(ev, renderModeLine);
session.subscribe(render);

// ---- Saving ---------------------------------------------------------------------------------

async function handleSave(r, id) {
  if (r.status === 'saved') {
    const b = session.state().buffers.find((x) => x.id === id);
    recent.add(b.name);
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

async function conflict(c) {
  const settleAndMaybeSave = async (text, save) => {
    session.settle(c, text);
    return save ? saveBuffer(c.id) : false;
  };
  const choice = await panel((sheet, close) => {
    const first = () => {
      put(sheet, 
        h('h2', {}, `${c.name.replace(/^.*[/:]/, '')} changed on the server`),
        h('p', {}, c.theirs === null ? 'The file was deleted on the server since you opened it.' : 'Someone saved a newer copy since you opened it.'),
        h('div', { class: 'row' },
          c.theirs === null ? null : h('button', { onclick: () => merge() }, 'Merge'),
          h('button', { onclick: () => close('mine') }, 'Keep mine'),
          c.theirs === null ? null : h('button', { onclick: () => close('theirs') }, 'Use theirs'),
          h('button', { onclick: () => close(undefined) }, 'Cancel')));
    };
    const merge = () => {
      const m = session.merge(c);
      if (m.clean) { close({ merged: m.text }); return; }
      const picks = [];
      const rows = m.segments.filter((s) => s.type === 'conflict').map((s, i) => {
        picks[i] = 'mine';
        const sel = h('select', { onchange: () => { picks[i] = sel.value; } },
          h('option', { value: 'mine' }, 'Keep mine'), h('option', { value: 'theirs' }, 'Use theirs'), h('option', { value: 'both' }, 'Keep both'));
        return h('div', { class: 'list' }, h('label', {}, `Conflict ${i + 1}: mine`), h('pre', {}, s.mine.join('')),
          h('label', {}, 'theirs'), h('pre', {}, s.theirs.join('')), sel);
      });
      put(sheet, h('h2', {}, 'Settle the clashes'), ...rows,
        h('div', { class: 'row' }, h('button', { onclick: () => first() }, 'Back'),
          h('button', { class: 'primary', onclick: () => close({ merged: session.resolve(m.segments, (i) => picks[i]) }) }, 'Apply')));
    };
    first();
  });
  if (choice === undefined) return false;
  if (choice === 'mine') return settleAndMaybeSave(c.mine, true);
  if (choice === 'theirs') { await settleAndMaybeSave(c.theirs, false); message('Loaded the server copy'); return false; }
  await settleAndMaybeSave(choice.merged, false);
  message('Merged. Save to send it.');
  return false;
}

// ---- File browser (Open and Save as) -------------------------------------------------------------

function providerLabel(p) { return { local: 'This device', github: 'GitHub', webdav: 'WebDAV' }[p]; }

/** @returns {Promise<string|undefined>} the chosen storage name */
function browse({ mode, suggested = '', current = null }) {
  let provider = current ? parseName(current).provider : 'local';
  if (!(provider in providers)) provider = 'local';
  let dir = current ? parseName(current).path.replace(/[^/]*$/, '') : '';
  return panel((sheet, close) => {
    let listing = { folders: [], files: [] };
    let loadError = null;
    const nameInput = mode === 'saveas' ? h('input', { value: suggested, 'aria-label': 'File name', oninput: () => draw() }) : null;
    const ok = h('button', { class: 'primary' });
    const note = h('p', { class: 'tag' });

    async function load() {
      try {
        const all = await app.storage.entries(`${provider}:`);
        listing = children(all.map((e) => ({ path: parseName(e.name).path, size: e.size })), dir);
        loadError = null;
      } catch (e) { listing = { folders: [], files: [] }; loadError = e.message; }
      draw();
    }
    async function change() {
      const items = ['local', 'github', 'webdav'].map((p) => ({
        value: p, label: providerLabel(p), meta: p in providers ? '' : 'set up' }));
      const p = await choose('Storage', items);
      if (!p) return;
      if (!(p in providers)) { await setup(p); if (!(p in providers)) return; }
      provider = p; dir = ''; load();
    }
    function draw() {
      const typed = nameInput?.value.trim() ?? '';
      const there = listing.files.find((f) => f.name === typed);
      put(sheet, 
        h('h2', {}, mode === 'open' ? 'Open' : 'Save as'),
        h('div', { class: 'list' }, h('button', { class: 'item', onclick: change }, h('span', {}, `Storage: ${providerLabel(provider)}`), h('span', { class: 'meta' }, 'Change'))),
        h('div', { class: 'path' }, `${provider}:${dir}`),
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
          mode === 'saveas' ? Object.assign(ok, { textContent: there ? 'Replace' : 'Save', onclick: () => { if (typed) close(`${provider}:${dir}${typed}`); } }) : null));
      note.remove();
    }
    load();
  });
}

// ---- Find ------------------------------------------------------------------------------------------

let finding = null;

function startFind() {
  if (finding || shownId === null) return;
  finding = { start: editor.selectionStart, end: editor.selectionEnd };
  const input = h('input', { 'aria-label': 'Search', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' });
  const show = (m) => {
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
    const m = search(editor.value, q, { from, backward });
    if (!m) { message(`Failing I-search: ${q}`, true); return; }
    message(m.wrapped ? 'Wrapped' : '');
    show(m);
  };
  const end = (restore) => {
    if (restore) editor.setSelectionRange(finding.start, finding.end);
    finding = null;
    $('hl').replaceChildren();
    $('findbar').hidden = true;
    $('findbar').replaceChildren();
    message('');
    renderModeLine();
  };
  input.addEventListener('input', () => go(false, editor.selectionStart));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); end(false); editor.focus(); }
    else if (e.key === 'Escape') { e.stopPropagation(); end(true); }
  });
  $('findbar').replaceChildren(
    h('span', { class: 'label' }, 'I-search:'), input,
    h('button', { 'aria-label': 'Previous match', onclick: () => go(true, editor.selectionStart) }, '▲'),
    h('button', { 'aria-label': 'Next match', onclick: () => go(false, editor.selectionEnd) }, '▼'),
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
          await rebuild(); message(`${def.title} removed`); close(true);
        } }, 'Remove'),
        h('button', { onclick: () => close(undefined) }, 'Cancel'),
        h('button', { class: 'primary', onclick: async () => {
          config.update({ settings: Object.fromEntries(inputs.map(([k, i]) => [k, i.value.trim()])), secrets: secret.value ? { [def.secret[0]]: secret.value } : {} });
          try { await rebuild(); message(config[`${p}Ready`]() ? `${def.title} set up` : `${def.title} needs every field before it can be used`); } catch (e) { failure(e); }
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
          h('div', { class: 'item', style: 'display:flex;align-items:center;justify-content:space-between;padding:4px 0' }, h('span', {}, 'Settings file'),
            h('span', { class: 'row' }, h('button', { onclick: () => close('export') }, 'Export'), h('button', { onclick: () => close('import') }, 'Import')))),
        h('p', {}, 'Tokens and passwords are kept in this browser, on this device.'),
        h('div', { class: 'row' }, h('button', { onclick: () => close(undefined) }, 'Close')));
    });
    if (what === undefined) return;
    if (what === 'github' || what === 'webdav') await setup(what);
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
$('btn-view').addEventListener('click', () => choose(null, [{ label: 'Text', value: 'text' }]));
$('btn-menu').addEventListener('click', async () => {
  const what = await choose(null, [{ label: 'Settings', value: 'settings' }]);
  if (what === 'settings') await settings();
});

window.addEventListener('beforeunload', (e) => { if (session.unsavedIds().length) e.preventDefault(); });

// ---- Queued saves and the offline cache ----------------------------------------------------------------

async function sendQueued() {
  let sent = 0;
  let clashes = 0;
  for (const p of ['github', 'webdav']) {
    if (!providers[p]) continue;
    try {
      const r = await providers[p].sync();
      sent += r.synced.length;
      clashes += r.conflicts.length;
    } catch (e) { failure(e); return; }
  }
  if (sent) message(`Sent ${sent} saved ${sent === 1 ? 'file' : 'files'} to the server`);
  if (clashes) message(`${clashes} ${clashes === 1 ? 'file' : 'files'} changed on the server and could not be sent`, true);
}
window.addEventListener('online', sendQueued);
if (navigator.onLine) sendQueued();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(failure);

session.newScratch();
message('Welcome to Serita');
