// The open buffers and what happens when they are opened, edited and saved.
// No DOM here: the view reads state() and calls these functions.
// A buffer is { id, name, text, saved, version }:
//   name     storage name ("github:home.org"), or null for a *scratch* buffer
//   saved    the text last known to be in storage (the base of a three-way merge)
//   version  the version token of that text, or null while the file has not been saved yet

import { merge3, resolve } from '../storage/conflict.js';

export const SCRATCH = '*scratch*';

/**
 * @typedef {{ id: number, name: string|null, text: string, saved: string, version: string|null }} Buffer
 * @typedef {{ id: number, name: string, mine: string, base: string, theirs: string|null, theirsVersion: string|null }} Conflict
 * @typedef {{ status: 'saved' } | { status: 'needs-name' } | { status: 'exists', size: number|null, theirsVersion: string }
 *   | { status: 'conflict', conflict: Conflict }} SaveResult
 */

/** @param {{ app: import('../interface/contract.js').AppInterface }} opts */
export function createSession({ app }) {
  /** @type {Buffer[]} */
  let buffers = [];
  let current = null;
  let nextId = 1;
  const listeners = new Set();
  const changed = () => { for (const cb of listeners) cb(); };
  const find = (id) => {
    const b = buffers.find((x) => x.id === id);
    if (!b) throw new Error(`no buffer ${id}`);
    return b;
  };
  const replace = (id, patch) => { buffers = buffers.map((b) => (b.id === id ? { ...b, ...patch } : b)); };

  const scratchTitle = (id) => {
    const n = buffers.filter((b) => b.name === null).length;
    return n === 0 ? SCRATCH : `${SCRATCH}<${n + 1}>`;
  };
  const baseName = (name) => name.slice(name.lastIndexOf('/') + 1).replace(/^[a-z]+:/, '');

  const session = {
    subscribe(cb) { listeners.add(cb); return () => listeners.delete(cb); },

    /** Tabs, in the order they were opened. The title of a scratch buffer is fixed when it is created. */
    state() {
      return {
        current,
        buffers: buffers.map((b) => ({
          id: b.id, name: b.name, text: b.text, version: b.version,
          title: b.name === null ? b.title : baseName(b.name),
          dirty: b.name === null ? b.text !== '' : b.text !== b.saved || b.version === null,
        })),
      };
    },

    newScratch() {
      const id = nextId++;
      const title = scratchTitle(id);
      buffers = [...buffers, { id, name: null, title, text: '', saved: '', version: null }];
      current = id;
      changed();
      return id;
    },

    /** @returns {Promise<{ ok: true, id: number } | { ok: false, reason: 'missing' }>} */
    async openFile(name) {
      const open = buffers.find((b) => b.name === name);
      if (open) { current = open.id; changed(); return { ok: true, id: open.id }; }
      const r = await app.storage.read(name);
      if (!r) return { ok: false, reason: 'missing' };
      const id = nextId++;
      buffers = [...buffers, { id, name, text: r.text, saved: r.text, version: r.version }];
      current = id;
      changed();
      return { ok: true, id };
    },

    select(id) { find(id); current = id; changed(); },

    setText(id, text) { find(id); replace(id, { text }); changed(); },

    /** Closes a buffer. Returns false, leaving it open, when it has unsaved changes and force is not set. */
    close(id, { force = false } = {}) {
      const b = find(id);
      const dirty = b.text !== b.saved || b.version === null;
      if (dirty && b.name !== null && !force) return false;
      if (b.name === null && b.text !== '' && !force) return false;
      const i = buffers.findIndex((x) => x.id === id);
      buffers = buffers.filter((x) => x.id !== id);
      if (current === id) current = buffers[Math.min(i, buffers.length - 1)]?.id ?? null;
      changed();
      return true;
    },

    /** Buffers that Save some buffers asks about: file buffers with unsaved changes, and scratch buffers with text. */
    unsavedIds() {
      return buffers.filter((b) => (b.name === null ? b.text !== '' : b.text !== b.saved || b.version === null)).map((b) => b.id);
    },

    /** @returns {Promise<SaveResult>} */
    async save(id) {
      const b = find(id);
      if (b.name === null) return { status: 'needs-name' };
      return write(b, b.name, b.version ?? undefined);
    },

    /**
     * Saves under another name. Without overwrite, an existing file is reported, not replaced.
     * @returns {Promise<SaveResult>}
     */
    async saveAs(id, name, { overwrite = false } = {}) {
      const b = find(id);
      if (!overwrite && name !== b.name) {
        const there = await app.storage.read(name);
        if (there) return { status: 'exists', size: new TextEncoder().encode(there.text).length, theirsVersion: there.version };
        return write(b, name, undefined);
      }
      const there = name === b.name ? null : await app.storage.read(name);
      return write(b, name, name === b.name ? b.version ?? undefined : there?.version);
    },

    /**
     * After a conflict: take `text` as the buffer, with `theirs` as the new last-known server copy.
     * The buffer stays unsaved unless the text equals theirs. Save it afterward to send it.
     */
    settle(conflict, text) {
      find(conflict.id);
      replace(conflict.id, { text, saved: conflict.theirs ?? '', version: conflict.theirsVersion });
      changed();
    },

    /** Re-reads an open file whose copy in storage changed, unless the buffer has unsaved edits. */
    async refresh(name) {
      const b = buffers.find((x) => x.name === name);
      if (!b || b.text !== b.saved) return;
      const r = await app.storage.read(name);
      if (!r) return;
      replace(b.id, { text: r.text, saved: r.text, version: r.version });
      changed();
    },

    /** Three-way merge of a conflict: { clean, text } or the segments to choose from. */
    merge(conflict) { return merge3(conflict.base, conflict.mine, conflict.theirs ?? ''); },
    resolve,
  };

  async function write(b, name, baseVersion) {
    const r = await app.storage.write(name, b.text, baseVersion === undefined ? undefined : { baseVersion });
    if (r.ok) {
      replace(b.id, { name, saved: b.text, version: r.version });
      changed();
      return { status: 'saved' };
    }
    return {
      status: 'conflict',
      conflict: { id: b.id, name, mine: b.text, base: b.saved, theirs: r.conflict.theirs, theirsVersion: r.conflict.theirsVersion },
    };
  }

  return session;
}
