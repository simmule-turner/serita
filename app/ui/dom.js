// Small helpers for building page elements.

/** Flattens children and leaves out anything empty. */
export const kept = (kids) => kids.flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false);

/** An element with properties (on* are listeners, class is the class name) and children. */
export function h(tag, props = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== false) el.setAttribute(k, v === true ? '' : v);
  }
  el.append(...kept(kids));
  return el;
}
