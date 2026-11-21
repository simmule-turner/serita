// In-memory implementation of the app interface, for tests and as the reference behavior.

import { CAPABILITIES, CapabilityUnavailable } from './contract.js';
import { parseName, formatName, PROVIDERS } from '../../core/names.js';

/**
 * @param {{ now?: () => Date, timeZone?: string, available?: Partial<Record<string, boolean>> }} [opts]
 * @returns {import('./contract.js').AppInterface & { _log: { notifications: object[], opened: string[] } }}
 */
export function createMemoryInterface(opts = {}) {
  const available = {
    storage: true, clock: true, notify: true, links: true, clipboard: true, files: false, script: false,
    ...opts.available,
  };
  const reasons = { files: 'no file picker in the memory interface', script: 'no script runner in the memory interface' };
  const need = (cap) => { if (!available[cap]) throw new CapabilityUnavailable(cap, reasons[cap]); };

  const files = new Map(); // key -> { text, version }
  const watchers = new Map(); // key -> Set<cb>
  let counter = 0;
  let clip = '';
  const log = { notifications: [], opened: [] };

  const key = (name) => { const { provider, path } = parseName(name); return formatName(provider, path); };
  const emit = (k) => { for (const cb of watchers.get(k) ?? []) cb(k); };

  const storage = {
    async read(name) {
      need('storage');
      const f = files.get(key(name));
      return f ? { text: f.text, version: f.version } : null;
    },
    async write(name, text, o = {}) {
      need('storage');
      const k = key(name);
      const cur = files.get(k);
      if ((cur?.version ?? undefined) !== o.baseVersion) {
        return { ok: false, conflict: { theirs: cur?.text ?? null, theirsVersion: cur?.version ?? null } };
      }
      const version = `v${++counter}`;
      files.set(k, { text, version });
      emit(k);
      return { ok: true, version };
    },
    async list(prefix = '') {
      need('storage');
      const providerOnly = prefix.endsWith(':') && PROVIDERS.includes(prefix.slice(0, -1));
      const p = prefix === '' || providerOnly ? prefix : key(prefix);
      return [...files.keys()].filter((k) => k.startsWith(p)).sort();
    },
    async remove(name) {
      need('storage');
      const k = key(name);
      if (files.delete(k)) emit(k);
    },
    watch(name, cb) {
      need('storage');
      const k = key(name);
      if (!watchers.has(k)) watchers.set(k, new Set());
      watchers.get(k).add(cb);
      return () => watchers.get(k).delete(cb);
    },
    providers: () => [...PROVIDERS],
  };

  return {
    capabilities: () => Object.fromEntries(CAPABILITIES.map((c) =>
      [c, available[c] ? { available: true } : { available: false, reason: reasons[c] ?? 'disabled' }])),
    storage,
    clock: {
      now: () => { need('clock'); return (opts.now ?? (() => new Date()))(); },
      timeZone: () => { need('clock'); return opts.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone; },
    },
    notify: {
      async schedule(n) { need('notify'); log.notifications = log.notifications.filter((x) => x.id !== n.id).concat(n); },
      async cancel(id) { need('notify'); log.notifications = log.notifications.filter((x) => x.id !== id); },
    },
    links: { async open(url) { need('links'); log.opened.push(url); } },
    clipboard: {
      async read() { need('clipboard'); return clip; },
      async write(t) { need('clipboard'); clip = t; },
    },
    files: {
      async pickOpen() { need('files'); return null; },
      async pickSave() { need('files'); return false; },
      async pickFolder() { need('files'); return null; },
    },
    script: { async run() { need('script'); throw new CapabilityUnavailable('script'); } },
    get _log() { return log; },
  };
}
