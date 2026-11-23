// The open buffers and what happens when they are opened, edited and saved.
// No DOM here: the view reads state() and calls these functions.
// A buffer is { id, name, text, saved, version, folds }:
//   name     storage name ("github:home.org"), or null for a *scratch* buffer
//   saved    the text last known to be in storage (the base of a three-way merge)
//   version  the version token of that text, or null while the file has not been saved yet
//   folds    what is folded (see core/outline.js); every view reads it, none keeps its own
//   undo, redo  earlier and later texts; typing within a second joins one step, other edits are steps of their own

import { merge3, resolve } from '../storage/conflict.js';
import { analyze, diff, remapFolds, startupFolds, validFolds } from '../../core/outline.js';

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

  /** The new text of a buffer with its folds moved along. `remap` is given by structure edits; other changes are found by comparing the texts. */
  const retext = (b, text, remap) => {
    if (text === b.text) return { text };
    let folds;
    if (remap) folds = Object.fromEntries(Object.entries(b.folds).map(([k, v]) => [remap(Number(k)), v]).filter(([k]) => k !== null));
    else { const d = diff(b.text, text); folds = remapFolds(b.folds, b.text, d.from, d.to, d.insert); }
    return { text, folds: validFolds(analyze(text).foldables, folds) };
  };

  const HISTORY = 200;
  /** The patch with the undo history updated: the text before the edit is kept, and redo is dropped. `group` joins quick typing into one step. */
  const record = (b, patch, group) => {
    if (patch.text === b.text) return patch;
    const now = Date.now();
    const join = group && b.group && now - b.at < 1000 && b.undo.length > 0;
    return { ...patch, undo: join ? b.undo : [...b.undo, b.text].slice(-HISTORY), redo: [], group, at: now };
  };
  /** Moves one step along `from` (undo or redo); the other list gets the text we leave. Returns where the cursor goes, or null when there is no step. */
  const step = (id, from, to) => {
    const b = find(id);
    if (b[from].length === 0) return null;
    const text = b[from][b[from].length - 1];
    const d = diff(b.text, text);
    replace(id, { ...retext(b, text), [from]: b[from].slice(0, -1), [to]: [...b[to], b.text], group: false });
    changed();
    return d.from + d.insert.length;
  };

  const session = {
    subscribe(cb) { listeners.add(cb); return () => listeners.delete(cb); },

    /** Tabs, in the order they were opened. The title of a scratch buffer is fixed when it is created. */
    state() {
      return {
        current,
        buffers: buffers.map((b) => ({
          id: b.id, name: b.name, text: b.text, version: b.version, folds: b.folds,
          title: b.name === null ? b.title : baseName(b.name),
          dirty: b.name === null ? b.text !== '' : b.text !== b.saved || b.version === null,
        })),
      };
    },

    newScratch(name = null) {
      const id = nextId++;
      const title = name ?? scratchTitle(id);
      buffers = [...buffers, { id, name: null, title, text: '', saved: '', version: null, folds: {}, undo: [], redo: [], group: false, at: 0 }];
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
      buffers = [...buffers, { id, name, text: r.text, saved: r.text, version: r.version, folds: startupFolds(r.text), undo: [], redo: [], group: false, at: 0 }];
      current = id;
      changed();
      return { ok: true, id };
    },

    /** Opens a file that does not exist yet as an unsaved buffer. */
    createFile(name, text) {
      const id = nextId++;
      buffers = [...buffers, { id, name, text, saved: '', version: null, folds: startupFolds(text), undo: [], redo: [], group: false, at: 0 }];
      changed();
      return id;
    },

    select(id) { find(id); current = id; changed(); },

    /** What to keep across a reload: the buffers in order, the current one, and the text of buffers that are scratch or unsaved. */
    snapshot() {
      const at = buffers.findIndex((b) => b.id === current);
      return {
        current: at < 0 ? 0 : at,
        buffers: buffers.map((b) => ({
          name: b.name, title: b.name === null ? b.title : undefined, folds: b.folds,
          ...(b.name === null || b.text !== b.saved ? { draft: b.text } : {}),
        })),
      };
    },

    /**
     * Opens the buffers of a snapshot. A file that cannot be read is skipped and named in `skipped`; a draft is the buffer's text,
     * with the file as it is now as the last saved copy.
     * @returns {Promise<{ opened: number, skipped: string[] }>}
     */
    async restore(snap) {
      const skipped = [];
      const ids = [];
      for (const e of snap.buffers) {
        const id = nextId++;
        if (e.name === null) {
          buffers = [...buffers, { id, name: null, title: e.title ?? scratchTitle(id), text: e.draft ?? '', saved: '', version: null, folds: validFolds(analyze(e.draft ?? '').foldables, e.folds ?? {}), undo: [], redo: [], group: false, at: 0 }];
          ids.push(id);
          continue;
        }
        const r = await app.storage.read(e.name).catch(() => null);
        if (!r) { skipped.push(e.name); continue; }
        const text = e.draft ?? r.text;
        buffers = [...buffers, { id, name: e.name, text, saved: r.text, version: r.version, folds: validFolds(analyze(text).foldables, e.folds ?? startupFolds(r.text)), undo: [], redo: [], group: false, at: 0 }];
        ids.push(id);
      }
      current = ids[Math.min(snap.current, ids.length - 1)] ?? null;
      changed();
      return { opened: ids.length, skipped };
    },

    /** Typing: quick changes join one undo step. */
    setText(id, text) { const b = find(id); replace(id, record(b, retext(b, text), true)); changed(); },

    /** @returns {number|null} where the cursor goes (an offset in the text), or null when there is nothing to undo */
    undo(id) { return step(id, 'undo', 'redo'); },
    redo(id) { return step(id, 'redo', 'undo'); },

    /** Takes the result of a structure edit (core/outline-edit.js); folds move with the lines. */
    apply(id, result) { const b = find(id); replace(id, record(b, retext(b, result.text, result.remap), false)); changed(); },

    setFolds(id, folds) { find(id); replace(id, { folds }); changed(); },

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
      replace(conflict.id, { ...retext(find(conflict.id), text), saved: conflict.theirs ?? '', version: conflict.theirsVersion });
      changed();
    },

    /** Re-reads an open file whose copy in storage changed, unless the buffer has unsaved edits. */
    async refresh(name) {
      const b = buffers.find((x) => x.name === name);
      if (!b || b.text !== b.saved) return;
      const r = await app.storage.read(name);
      if (!r) return;
      replace(b.id, { ...retext(b, r.text), saved: r.text, version: r.version });
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
