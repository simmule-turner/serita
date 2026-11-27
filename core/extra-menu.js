// The extra menu: an easy-menu-define form in the init file, read as data. A row is a vector [LABEL CALLBACK keywords...], a string
// starting with "--" is a separator, and a list ("Name" rows...) is a submenu. Written from the Emacs Lisp manual's description of
// easy-menu-define; no Emacs source was read.

import { readForms, isSym } from './lisp-read.js';
import { makeLisp } from './elisp.js';

const sym = (x) => (isSym(x) ? x.sym : null);

/** Keyword arguments after a row's callback: :help, :enable, :visible, :active. */
function keywords(rest) {
  const out = {};
  for (let i = 0; i < rest.length; i += 2) {
    const k = sym(rest[i]);
    if (!k?.startsWith(':')) throw new Error('A menu row has keyword arguments after its callback');
    out[k.slice(1)] = rest[i + 1];
  }
  return out;
}

function items(list) {
  return list.map((x) => {
    if (typeof x === 'string') return /^--/.test(x) ? { kind: 'separator' } : { kind: 'label', label: x };
    if (Array.isArray(x) && x.vector) {
      if (typeof x[0] !== 'string') throw new Error('A menu row starts with its label');
      const k = keywords(x.slice(2));
      return { kind: 'row', label: x[0], callback: x[1] ?? null, help: typeof k.help === 'string' ? k.help : null, enable: 'enable' in k ? k.enable : 'active' in k ? k.active : true, visible: 'visible' in k ? k.visible : true };
    }
    if (Array.isArray(x)) {
      if (typeof x[0] !== 'string') throw new Error('A submenu starts with its name');
      return { kind: 'submenu', label: x[0], items: items(x.slice(1)) };
    }
    throw new Error('Not a menu row');
  });
}

/**
 * The menu the text defines: its top-level rows.
 * @param {string} text defuns and an easy-menu-define form
 * @returns {{ items: any[], lisp: ReturnType<typeof makeLisp>, forms: any[] }}
 */
export function parseExtraMenu(text) {
  const forms = readForms(text);
  const lisp = makeLisp(forms);
  let name = null;
  for (const f of forms) {
    if (Array.isArray(f) && sym(f[0]) === 'defun') continue;
    lisp.evaluate(f);
    if (Array.isArray(f) && sym(f[0]) === 'easy-menu-define') name = sym(f[1]);
  }
  const data = name ? lisp.get(name) : null;
  if (!Array.isArray(data) || typeof data[0] !== 'string') throw new Error('easy-menu-define needs a menu that starts with its name');
  return { items: items(data.slice(1)), lisp, forms };
}
