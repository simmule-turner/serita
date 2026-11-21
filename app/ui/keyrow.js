// The key row: Meta, Ctrl, Shift, Tab and the arrows, then the keyboard and Float buttons.
// Docked it sits above the mode line and scrolls sideways; floating it is a panel you drag.
// Its buttons never take focus, so pressing one does not open the on-screen keyboard.

import { h } from './dom.js';

/**
 * @param {{ root: HTMLElement, store: { getItem(k: string): string|null, setItem(k: string, v: string): void },
 *   press(key: string, mods: { ctrl: boolean, meta: boolean, shift: boolean }): void, toggleKeyboard(): void }} o
 */
export function createKeyRow({ root, store, press, toggleKeyboard }) {
  const saved = (() => { try { return JSON.parse(store.getItem('serita.keyrow') ?? '{}'); } catch { return {}; } })();
  const st = { floating: saved.floating === true, x: saved.x ?? null, y: saved.y ?? null };
  const sticky = { ctrl: false, meta: false, shift: false };
  const keep = () => store.setItem('serita.keyrow', JSON.stringify(st));

  const noFocus = (e) => e.preventDefault();
  const button = (label, onclick, extra = {}) => h('button', { type: 'button', onpointerdown: noFocus, onmousedown: noFocus, onclick, ...extra }, label);
  const mod = (label, name) => {
    const b = button(label, () => { sticky[name] = !sticky[name]; paint(); }, { 'aria-pressed': 'false' });
    b.dataset.mod = name;
    return b;
  };
  const key = (label, name, aria) => button(label, () => {
    press(name, { ...sticky });
    for (const k of Object.keys(sticky)) sticky[k] = false;
    paint();
  }, aria ? { 'aria-label': aria } : {});

  const scroll = h('div', { class: 'keys' },
    mod('Meta', 'meta'), mod('Ctrl', 'ctrl'), mod('Shift', 'shift'), key('Tab', 'Tab'),
    key('←', 'ArrowLeft', 'Left'), key('↑', 'ArrowUp', 'Up'), key('↓', 'ArrowDown', 'Down'), key('→', 'ArrowRight', 'Right'));
  const kbd = button('⌨', () => toggleKeyboard(), { 'aria-label': 'Show or hide the keyboard', class: 'kbd' });
  const float = button('Float', () => { st.floating = !st.floating; keep(); layout(); });
  const grip = h('span', { class: 'grip', 'aria-hidden': 'true' }, '⠿');
  root.replaceChildren(grip, scroll, h('div', { class: 'pin' }, kbd, float));

  function paint() {
    for (const b of scroll.querySelectorAll('[data-mod]')) {
      b.classList.toggle('on', sticky[b.dataset.mod]);
      b.setAttribute('aria-pressed', String(sticky[b.dataset.mod]));
    }
  }

  function layout() {
    root.classList.toggle('float', st.floating);
    float.textContent = st.floating ? 'Dock' : 'Float';
    if (!st.floating) { root.style.left = root.style.top = ''; return; }
    const w = root.offsetWidth || 228;
    const x = st.x ?? Math.max(0, window.innerWidth - w - 8);
    const y = st.y ?? Math.max(0, window.innerHeight - 260);
    place(x, y);
  }
  function place(x, y) {
    st.x = Math.min(Math.max(0, x), Math.max(0, window.innerWidth - root.offsetWidth));
    st.y = Math.min(Math.max(0, y), Math.max(0, window.innerHeight - root.offsetHeight));
    root.style.left = `${st.x}px`;
    root.style.top = `${st.y}px`;
  }

  // Dragging: a press on the panel itself (not on a key) moves it.
  root.addEventListener('pointerdown', (e) => {
    if (!st.floating || e.target.closest('button')) return;
    e.preventDefault();
    const dx = e.clientX - st.x;
    const dy = e.clientY - st.y;
    const move = (ev) => place(ev.clientX - dx, ev.clientY - dy);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); keep(); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });

  return { layout, sticky: () => ({ ...sticky }), clear() { for (const k of Object.keys(sticky)) sticky[k] = false; paint(); } };
}
