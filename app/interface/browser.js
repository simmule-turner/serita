// Browser implementation of the app interface.
// Storage is routed by provider name to the providers it is given. A provider that is not
// configured reports itself unavailable; nothing stands in for it.
// Everything the browser may or may not have comes in through `env`, so it can be tested.

import { CAPABILITIES, CapabilityUnavailable } from './contract.js';
import { parseName, formatName, PROVIDERS } from '../../core/names.js';

const REASONS = Object.freeze({
  notify: 'the browser cannot deliver reminders while the app is closed; the native apps can',
  files: 'this browser cannot open and save real files',
  script: 'running source blocks arrives in a later release',
});

/**
 * @param {{
 *   providers: Partial<Record<string, import('../storage/local.js').Provider>>,
 *   env?: any,
 *   now?: () => Date,
 * }} opts
 * @returns {import('./contract.js').AppInterface}
 */
export function createBrowserInterface({ providers, env = globalThis, now = () => new Date() }) {
  const watchers = new Map();
  const emit = (name) => { for (const cb of watchers.get(name) ?? []) cb(name); };

  const provider = (p) => {
    const impl = providers[p];
    if (!impl) throw new CapabilityUnavailable('storage', `the ${p} provider is not configured`);
    return impl;
  };
  const resolve = (name) => { const { provider: p, path } = parseName(name); return { p, path, impl: provider(p), full: formatName(p, path) }; };

  const hasClipboard = typeof env.navigator?.clipboard?.writeText === 'function' && typeof env.navigator?.clipboard?.readText === 'function';
  const hasLinks = typeof env.open === 'function';
  const hasFiles = typeof env.showOpenFilePicker === 'function' && typeof env.showSaveFilePicker === 'function';
  const available = { storage: true, clock: true, notify: false, links: hasLinks, clipboard: hasClipboard, files: hasFiles, script: false };
  const need = (cap) => { if (!available[cap]) throw new CapabilityUnavailable(cap, REASONS[cap]); };
  const cancelled = (e) => e?.name === 'AbortError';

  async function entries(prefix = '') {
    const providerOnly = prefix.endsWith(':') && PROVIDERS.includes(prefix.slice(0, -1));
    const targets = prefix === ''
      ? Object.keys(providers).map((p) => ({ p, rest: '' }))
      : providerOnly ? [{ p: prefix.slice(0, -1), rest: '' }]
        : [(({ provider: p, path }) => ({ p, rest: path }))(parseName(prefix))];
    const out = [];
    for (const { p, rest } of targets) {
      for (const e of await provider(p).entries(rest)) out.push({ name: formatName(p, e.path), size: e.size });
    }
    return out.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  return {
    capabilities: () => Object.fromEntries(CAPABILITIES.map((c) =>
      [c, available[c] ? { available: true } : { available: false, reason: REASONS[c] ?? 'not available in this browser' }])),

    storage: {
      async read(name) { const { path, impl } = resolve(name); return impl.read(path); },
      async write(name, text, opts) {
        const { path, impl, full } = resolve(name);
        const r = await impl.write(path, text, opts);
        if (r.ok) emit(full);
        return r;
      },
      entries,
      async list(prefix = '') {
        return (await entries(prefix)).map((e) => e.name);
      },
      async remove(name) {
        const { path, impl, full } = resolve(name);
        await impl.remove(path);
        emit(full);
      },
      watch(name, cb) {
        const { full } = resolve(name);
        if (!watchers.has(full)) watchers.set(full, new Set());
        watchers.get(full).add(cb);
        return () => watchers.get(full).delete(cb);
      },
      providers: () => [...PROVIDERS],
    },

    clock: {
      now,
      timeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    },

    notify: {
      async schedule() { need('notify'); },
      async cancel() { need('notify'); },
    },

    links: { async open(url) { need('links'); env.open(url, '_blank', 'noopener'); } },

    clipboard: {
      async read() { need('clipboard'); return env.navigator.clipboard.readText(); },
      async write(text) { need('clipboard'); await env.navigator.clipboard.writeText(text); },
    },

    files: {
      async pickOpen() {
        need('files');
        try {
          const [handle] = await env.showOpenFilePicker();
          const file = await handle.getFile();
          return { name: file.name, text: await file.text() };
        } catch (e) { if (cancelled(e)) return null; throw e; }
      },
      async pickSave(suggestedName, text) {
        need('files');
        try {
          const handle = await env.showSaveFilePicker({ suggestedName });
          const w = await handle.createWritable();
          await w.write(text);
          await w.close();
          return true;
        } catch (e) { if (cancelled(e)) return false; throw e; }
      },
      async pickFolder() {
        throw new CapabilityUnavailable('files', 'folder access arrives with the native apps');
      },
    },

    script: { async run() { need('script'); } },
  };
}
