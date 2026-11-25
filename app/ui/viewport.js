// Keeps the app inside the part of the screen the user can see. Android Chrome shrinks the page when the on-screen keyboard opens
// (the viewport meta asks for it); iOS Safari instead slides the page up under the keyboard, so the key row and minibuffer vanish and the whole
// screen scrolls. This follows the visual viewport (a standard browser API) and sizes the app to it, which gives iOS the Android behavior.

/** Sets --vvh and --vvt on the root from the visual viewport and keeps the page from scrolling; returns a function that stops it. */
export function followViewport(win = window) {
  const vv = win.visualViewport;
  if (!vv) return () => {};
  const root = win.document.documentElement;
  const fit = () => {
    root.style.setProperty('--vvh', `${vv.height}px`);
    root.style.setProperty('--vvt', `${vv.offsetTop}px`);
    root.classList.toggle('keyboard', win.innerHeight - vv.height > 120);
    if (win.scrollY || win.scrollX) win.scrollTo(0, 0);
  };
  vv.addEventListener('resize', fit);
  vv.addEventListener('scroll', fit);
  win.addEventListener('scroll', fit);
  fit();
  return () => { vv.removeEventListener('resize', fit); vv.removeEventListener('scroll', fit); win.removeEventListener('scroll', fit); };
}
