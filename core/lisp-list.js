// A list of strings as init.el writes it: ("github:home.org" "local:work/plan.org"). The value of `org-agenda-files` is kept in this form,
// so an init file that sets it with setq gives the same text. A string may hold \" and \\.

/** @param {string} text @returns {string[]} */
export function parseStringList(text) {
  const t = text.trim().replace(/^'/, '');
  if (!/^\(.*\)$/s.test(t)) throw new Error('Expected a list of strings in parentheses');
  const inner = t.slice(1, -1);
  const out = [];
  let i = 0;
  for (;;) {
    while (i < inner.length && /\s/.test(inner[i])) i++;
    if (i >= inner.length) return out;
    if (inner[i] !== '"') throw new Error(`Expected a string at "${inner.slice(i, i + 12)}"`);
    let s = '';
    for (i++; ; i++) {
      if (i >= inner.length) throw new Error('A string is not closed');
      if (inner[i] === '\\') { i++; s += inner[i] ?? ''; continue; }
      if (inner[i] === '"') { i++; break; }
      s += inner[i];
    }
    out.push(s);
  }
}

/** @param {string[]} list */
export const formatStringList = (list) => `(${list.map((s) => `"${s.replace(/[\\"]/g, '\\$&')}"`).join(' ')})`;
