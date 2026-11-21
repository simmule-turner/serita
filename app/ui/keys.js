// Emacs key chords: naming them as Emacs does ("C-c", "M-<up>", "<backtab>") and following a
// prefix such as "C-c" to the key after it. No DOM here.

const NAMES = { ArrowUp: '<up>', ArrowDown: '<down>', ArrowLeft: '<left>', ArrowRight: '<right>', Enter: 'RET', Tab: 'TAB', Backspace: 'DEL', Escape: 'ESC' };
const mods = (c, m, s) => (c ? 'C-' : '') + (m ? 'M-' : '') + (s ? 'S-' : '');

/**
 * The Emacs name of a key press, or null for a plain character and for the modifier keys themselves.
 * @param {{ key: string, ctrl?: boolean, meta?: boolean, shift?: boolean }} e
 */
export function chordOf({ key, ctrl = false, meta = false, shift = false }) {
  const printable = key.length === 1;
  const name = NAMES[key] ?? (printable ? key.toLowerCase() : null);
  if (name === null || (printable && !ctrl && !meta)) return null;
  if (key === 'Tab' && shift) return `${mods(ctrl, meta, false)}<backtab>`;
  return mods(ctrl, meta, shift && !printable) + name;
}

/**
 * @param {Record<string, string>} bindings  chord or "chord chord" to command name
 */
export function createKeymap(bindings) {
  const seqs = Object.keys(bindings);
  let pending = [];
  return {
    pending: () => pending.join(' '),
    reset() { pending = []; },
    /** @returns {{ kind: 'run', command: string } | { kind: 'prefix', echo: string } | { kind: 'none', echo?: string }} */
    press(chord) {
      if (chord === 'C-g' && pending.length > 0) { pending = []; return { kind: 'none', echo: 'Quit' }; }
      const seq = [...pending, chord].join(' ');
      if (bindings[seq]) { pending = []; return { kind: 'run', command: bindings[seq] }; }
      if (seqs.some((s) => s.startsWith(`${seq} `))) { pending = [...pending, chord]; return { kind: 'prefix', echo: `${seq}-` }; }
      const had = pending.length > 0;
      pending = [];
      return had ? { kind: 'none', echo: `${seq} is undefined` } : { kind: 'none' };
    },
  };
}

/** The keys the Text view answers to, and what each does (the commands are in app/main.js). */
export const TEXT_KEYS = Object.freeze({
  'TAB': 'cycle',
  '<backtab>': 'cycle-global',
  'M-<up>': 'move-up',
  'M-<down>': 'move-down',
  'M-<left>': 'promote',
  'M-<right>': 'demote',
  'M-S-<left>': 'promote-subtree',
  'M-S-<right>': 'demote-subtree',
  'C-RET': 'insert-heading',
  'C-c C-t': 'todo',
  'C-c C-c': 'toggle-checkbox',
});
