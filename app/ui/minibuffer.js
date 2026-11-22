// The minibuffer: one line at the bottom of the screen where Emacs asks its questions. A field with the prompt inside it, buttons
// on the right, and a short list of completions that sits above the key row. Find and every other one-line question use it.
// Keys in the field: RET accepts, C-g or Escape cancels, TAB completes, up and down choose a completion, M-p and M-n go through
// earlier answers.

import { h } from './dom.js';

/**
 * @param {{ root: HTMLElement, list: HTMLElement, bell: () => void, restoreFocus?: () => void }} deps  `root` is the row, `list` the completions,
 * `restoreFocus` puts the cursor back where it was when the minibuffer closes.
 */
export function createMinibuffer({ root, list, bell, restoreFocus = () => {} }) {
  const history = new Map();
  let active = null;

  /**
   * Opens the minibuffer. `onInput(text)` is called as the text changes. `buttons` are { label, aria, onclick }.
   * `complete(text)` gives [{ label, value, hint? }]; the list follows the text.
   * @returns {{ input: HTMLInputElement, setPrompt: (text: string, failing?: boolean) => void, close: () => void, setValue: (v: string) => void }}
   */
  function open({ prompt, stack = false, value = '', buttons = [], onInput = () => {}, onKey = () => false, complete = null, onPick = null, inputMode = 'text', historyKey = null, label: name = prompt.replace(/:\s*$/, '') }) {
    active?.close();
    const label = h('span', { class: 'prompt' }, prompt);
    const input = h('input', { autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', inputmode: inputMode, 'aria-label': name });
    input.value = value;
    const field = h('label', { class: 'field' }, label, input);
    let items = [];
    let at = 0;
    const showList = () => {
      items = complete ? complete(input.value) : [];
      at = Math.min(at, Math.max(0, items.length - 1));
      list.replaceChildren(...items.slice(0, 6).map((it, i) => h('button', { class: `choice${i === at ? ' on' : ''}`, onclick: () => (onPick ? onPick(it) : (input.value = it.value, showList(), input.focus())) },
        h('span', {}, it.label), it.hint ? h('span', { class: 'hint' }, it.hint) : null)));
      list.hidden = items.length === 0;
    };
    const keepFocus = (e) => { if (e.target.closest('button')) e.preventDefault(); };
    list.onpointerdown = keepFocus;
    list.onmousedown = keepFocus;
    root.onpointerdown = keepFocus;
    root.onmousedown = keepFocus;
    const self = {
      input,
      setPrompt(text, failing = false) { label.textContent = text; field.classList.toggle('failing', failing); },
      setValue(v) { input.value = v; },
      close() {
        if (active !== self) return;
        active = null;
        root.hidden = true;
        root.classList.remove('stack');
        root.replaceChildren();
        list.hidden = true;
        list.replaceChildren();
        restoreFocus();
      },
      chosen: () => items[at] ?? null,
    };
    input.addEventListener('input', () => { at = 0; showList(); onInput(input.value); });
    input.addEventListener('keydown', (e) => {
      if (onKey(e)) return;
      const past = historyKey ? history.get(historyKey) ?? [] : [];
      if (e.key === 'ArrowDown' && items.length) { e.preventDefault(); at = (at + 1) % Math.min(6, items.length); showList(); }
      else if (e.key === 'ArrowUp' && items.length) { e.preventDefault(); at = (at + Math.min(6, items.length) - 1) % Math.min(6, items.length); showList(); }
      else if (e.key === 'Tab' && items.length) { e.preventDefault(); input.value = items[at].value; showList(); onInput(input.value); }
      else if (e.altKey && (e.key === 'p' || e.key === 'n') && past.length) {
        e.preventDefault();
        const i = (self.h ?? past.length) + (e.key === 'p' ? -1 : 1);
        self.h = Math.min(past.length - 1, Math.max(0, i));
        input.value = past[self.h];
        showList();
      }
    });
    root.classList.toggle('stack', stack);
    root.replaceChildren(field, ...buttons.map((b) => h('button', { 'aria-label': b.aria, onclick: b.onclick }, b.label)));
    root.hidden = false;
    active = self;
    showList();
    input.focus();
    self.remember = (v) => { if (historyKey && v !== '') history.set(historyKey, [...(history.get(historyKey) ?? []), v].slice(-50)); };
    return self;
  }

  /**
   * Asks one question. Resolves with the text, or undefined when it is cancelled (C-g, Escape or the cancel button).
   * With completions, RET takes the highlighted one when the text is not one of them yet and `require` is set.
   * @returns {Promise<string | undefined>}
   */
  function ask({ prompt, value = '', complete = null, require = false, historyKey = null, inputMode = 'text' }) {
    return new Promise((resolve) => {
      let mb;
      const done = (v) => { mb.remember(v ?? ''); mb.close(); resolve(v); };
      const cancel = () => { mb.close(); bell(); resolve(undefined); };
      const accept = () => {
        const text = mb.input.value;
        const pick = mb.chosen();
        done(require && pick && !complete(text).some((c) => c.value === text) ? pick.value : text);
      };
      mb = open({
        prompt, value, complete, historyKey, inputMode,
        buttons: [{ label: '✓', aria: 'Accept', onclick: accept }, { label: '✕', aria: 'Cancel', onclick: cancel }],
        onPick: complete ? (it) => done(it.value) : null,
        onKey(e) {
          if (e.key === 'Enter') { e.preventDefault(); accept(); return true; }
          if (e.key === 'Escape' || (e.ctrlKey && e.key === 'g')) { e.preventDefault(); e.stopPropagation(); cancel(); return true; }
          return false;
        },
      });
    });
  }

  return { open, ask, active: () => active };
}
