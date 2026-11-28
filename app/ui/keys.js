// Emacs key chords: naming them as Emacs does ("C-c", "M-<up>", "<backtab>") and following a
// prefix such as "C-c" to the key after it. No DOM here.

const NAMES = { ArrowUp: '<up>', ArrowDown: '<down>', ArrowLeft: '<left>', ArrowRight: '<right>', Enter: 'RET', Tab: 'TAB', Backspace: 'DEL', Escape: 'ESC', ' ': 'SPC' };
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
    /** Goes back into a prefix (C-c / c shows the sparse-tree menu again and reads the next key). */
    enter(seq) { pending = seq.split(' '); },
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
  'C-u': 'universal-argument',
  'C--': 'negative-argument',
  'C-0': 'argument-0', 'C-1': 'argument-1', 'C-2': 'argument-2', 'C-3': 'argument-3', 'C-4': 'argument-4',
  'C-5': 'argument-5', 'C-6': 'argument-6', 'C-7': 'argument-7', 'C-8': 'argument-8', 'C-9': 'argument-9',
  'TAB': 'cycle',
  '<backtab>': 'cycle-global',
  'M-<up>': 'move-up',
  'M-<down>': 'move-down',
  'M-<left>': 'promote',
  'M-<right>': 'demote',
  'M-S-<left>': 'promote-subtree',
  'M-S-<right>': 'demote-subtree',
  'C-RET': 'insert-heading',
  'S-<up>': 'priority-up',
  'S-<down>': 'priority-down',
  'S-<right>': 'todo-next',
  'S-<left>': 'todo-previous',
  'C-c C-t': 'todo',
  'C-c ,': 'priority',
  'C-c C-q': 'set-tags',
  'C-c C-x p': 'set-property',
  'M-x': 'execute-command',
  'C-c C-c': 'toggle-checkbox',
  'C-c a a': 'agenda',
  'C-c a t': 'agenda-todo',
  'C-c a m': 'agenda-tags',
  'C-c a s': 'agenda-search',
  'C-c C-s': 'schedule',
  'C-c C-d': 'deadline',
  'C-c .': 'timestamp',
  'C-c !': 'timestamp-inactive',
  'C-c / r': 'sparse-tree-regexp',
  'C-c / m': 'sparse-tree-match',
  'C-c / t': 'sparse-tree-todo',
  'C-c / T': 'sparse-tree-todo-keyword',
  'C-c / d': 'sparse-tree-deadlines',
  'C-c / b': 'sparse-tree-before',
  'C-c / a': 'sparse-tree-after',
  'C-c / D': 'sparse-tree-between',
  'C-c / c': 'sparse-tree-date-type',
  'M-RET': 'insert-heading-here',
  'M-S-RET': 'insert-todo-item',
  'RET': 'table-next-row',
  'S-RET': 'table-copy-down',
  'M-S-<up>': 'table-delete-row',
  'M-S-<down>': 'table-insert-row',
  'C-c -': 'ctrl-c-minus',
  'C-c RET': 'table-hline-and-move',
  'C-c ^': 'sort',
  'C-c C-z': 'add-note',
  'C-c |': 'table-create',
  'C-c ?': 'table-field-info',
  'C-c *': 'ctrl-c-star',
  'C-c =': 'table-formula',
  "C-c '": 'table-edit-formulas',
  'C-c " g': 'table-plot',
  'C-c }': 'table-toggle-numbers',
  'C-c {': 'table-toggle-debug',
  'C-c +': 'table-sum',
  'C-c C-x M-w': 'copy-special',
  'C-c C-x C-w': 'cut-special',
  'C-c C-x C-y': 'paste-special',
  'C-#': 'table-rotate-recalc-marks',
  'C-/': 'undo',
  'C-_': 'undo',
  'C-x u': 'undo',
  'C-?': 'redo',
  'C-x h': 'select-all',
  'M-g g': 'goto-line',
  'C-x C-SPC': 'back',
  'C-c &': 'back',
  'C-c C-o': 'open-link',
  'C-c l': 'store-link',
  'C-c C-l': 'insert-link',
  'C-c C-x f': 'footnote',
  'C-c C-x C-f': 'emphasize',
  'C-c C-x e': 'effort',
  'C-c c': 'capture',
  'C-c C-w': 'refile', 'C-c M-w': 'refile-copy', 'C-c C-x C-a': 'archive-subtree', 'C-c $': 'archive-subtree', 'C-c C-x A': 'archive-sibling', 'C-c C-x a': 'archive-tag',
  'C-c C-x C-i': 'clock-in',
  'C-c C-x C-o': 'clock-out',
  'C-c C-x C-q': 'clock-cancel',
  'C-c [': 'agenda-file-add',
  'C-c ]': 'agenda-file-remove',
  'C-k': 'kill-line',
  'C-S-DEL': 'kill-whole-line',
  'C-y': 'yank',
  'C-n': 'next-line',
  'C-p': 'previous-line',
  'C-f': 'forward-char',
  'C-b': 'backward-char',
  'M-f': 'forward-word',
  'M-b': 'backward-word',
  'C-a': 'beginning-of-line',
  'C-e': 'end-of-line',
  'M-<': 'beginning-of-buffer',
  'M->': 'end-of-buffer',
  'C-v': 'scroll-up',
  'M-v': 'scroll-down',
  'C-s': 'isearch-forward',
  'C-r': 'isearch-backward',
  'C-M-s': 'isearch-forward-regexp',
  'C-M-r': 'isearch-backward-regexp',
  'M-%': 'query-replace',
  'C-M-%': 'query-replace-regexp',
  'C-g': 'quit',
});
