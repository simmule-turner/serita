// The init file: a Lisp file run at startup and on demand. `load` runs another file; a file name may start with a provider, as in
// github:org/globals.el. A form that fails is reported with its file and line and the rest still runs. A setting the app does not
// use yet is kept and reported, never dropped. A file runs only when `trusted` says its name and content hash are known.
// Written from the Emacs Lisp manual's descriptions of load, setq, defvar, defun and add-to-list; no Emacs source was read.

import { readForms, isSym } from './lisp-read.js';
import { makeLisp } from './elisp.js';
import { parseName, formatName, PROVIDERS } from './names.js';
import { formatStringList } from './lisp-list.js';
import { parseTemplates } from './capture.js';

const sym = (x) => (isSym(x) ? x.sym : null);
const MAX_DEPTH = 8;

/** Lisp data as text: what `setq` would have to be given to build it. */
export function printLisp(x) {
  if (x === null) return 'nil';
  if (x === true) return 't';
  if (typeof x === 'number') return String(x);
  if (typeof x === 'string') return `"${x.replace(/[\\"]/g, '\\$&').replace(/\n/g, '\\n').replace(/\t/g, '\\t')}"`;
  if (isSym(x)) return x.sym;
  if (x && x.quote !== undefined) return `'${printLisp(x.quote)}`;
  if (Array.isArray(x)) return `(${x.map(printLisp).join(' ')}${x.tail !== undefined ? ` . ${printLisp(x.tail)}` : ''})`;
  throw new Error('Cannot show this value');
}

const bool = (v) => (v === null ? 'nil' : 't');
const text = (v) => { if (typeof v !== 'string') throw new Error('Expected a string'); return v; };
const word = (v) => { if (v === null) return 'nil'; if (v === true) return 't'; if (isSym(v)) return v.sym; throw new Error('Expected a symbol'); };
const strings = (v) => { if (v === null) return []; if (!Array.isArray(v) || v.some((s) => typeof s !== 'string')) throw new Error('Expected a list of strings'); return v; };
const symbols = (v) => { if (v === null) return []; if (!Array.isArray(v) || v.some((s) => !isSym(s))) throw new Error('Expected a list of symbols'); return v.map(sym); };

// Variables that give one setting: [setting key, how the setting holds the value]
const SIMPLE = {
  'org-agenda-files': ['org-agenda-files', (v) => formatStringList(strings(v))],
  'org-contacts-files': ['org-contacts-files', (v) => strings(v).join(' ')],
  'diary-file': ['diary-file', text],
  'org-contacts-birthday-property': ['org-contacts-birthday-property', text],
  'org-agenda-include-diary': ['org-agenda-include-diary', bool],
  'diary-show-holidays-flag': ['diary-show-holidays-flag', bool],
  'org-agenda-use-time-grid': ['org-agenda-use-time-grid', bool],
  'calendar-date-style': ['calendar-date-style', word],
  'org-tags-column': ['org.tagsColumn', (v) => { if (!Number.isInteger(v)) throw new Error('Expected an integer'); return String(v); }],
  'org-startup-indented': ['org-startup-indented', bool],
  'org-hide-leading-stars': ['org-hide-leading-stars', bool],
  'org-archive-location': ['org-archive-location', text],
  'org-archive-mark-done': ['org-archive-mark-done', word],
  'org-archive-save-context-info': ['org-archive-save-context-info', (v) => { const l = symbols(v); return l.length ? l.join(' ') : 'nil'; }],
  'org-log-into-drawer': ['org-log-into-drawer', (v) => (typeof v === 'string' ? v : v === true ? 'LOGBOOK' : 'nil')],
  'org-log-repeat': ['org-log-repeat', word],
  'org-refile-allow-creating-parent-nodes': ['org-refile-allow-creating-parent-nodes', word],
  'holiday-local-holidays': ['holiday-local-holidays', (v) => { if (v === null) return ''; if (!Array.isArray(v)) throw new Error('Expected a list of holiday forms'); return v.map(printLisp).join(' '); }],
};
// Variables that go together into one setting that holds them as setq forms
const GROUPS = {
  'org-refile-settings': ['org-refile-targets', 'org-refile-use-outline-path', 'org-reverse-note-order', 'org-refile-use-cache'],
  'org-agenda-prefix-settings': ['org-agenda-prefix-format', 'org-agenda-category-icon-alist'],
};
const HOLIDAYS = { 'holiday-general-holidays': 'general', 'holiday-christian-holidays': 'christian', 'holiday-solar-holidays': 'solar' };
const NOT_BUILT = ['holiday-hebrew-holidays', 'holiday-islamic-holidays', 'holiday-bahai-holidays', 'holiday-oriental-holidays'];

/** Where a loaded name is: names with a provider are as given; a bare name is beside the file that loads it. */
export function resolveName(name, from) {
  const m = /^([a-z][a-z0-9]*):/.exec(name);
  if (m && PROVIDERS.includes(m[1])) return name;
  const p = parseName(from);
  const dir = p.path.includes('/') ? p.path.slice(0, p.path.lastIndexOf('/') + 1) : '';
  return formatName(p.provider, `${dir}${name}`);
}

const lineOf = (src, at) => src.slice(0, at).split('\n').length;

const sha256 = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * Runs the init file.
 * @param {{ file: string, read: (name: string) => Promise<string>, trusted: (name: string, hash: string, text: string) => Promise<boolean>, now?: Date }} o
 * @returns {Promise<{ settings: Record<string, string>, files: { name: string, hash: string }[], report: { kind: 'error' | 'untrusted' | 'kept', file: string, line?: number, message: string }[] }>}
 */
export async function loadInit({ file, read, trusted, now = new Date() }) {
  const lisp = makeLisp([], { now });
  const report = [];
  const files = [];
  const touched = new Set();
  const defuns = new Map();
  const loading = [];

  const run = async (name, depth) => {
    if (loading.includes(name)) { report.push({ kind: 'error', file: name, message: 'Loading itself again' }); return; }
    if (depth > MAX_DEPTH) { report.push({ kind: 'error', file: name, message: 'Files load too deeply' }); return; }
    let src;
    try { src = await read(name); } catch (e) { report.push({ kind: 'error', file: name, message: `Cannot read: ${e.message}` }); return; }
    const hash = await sha256(src);
    if (!(await trusted(name, hash, src))) { report.push({ kind: 'untrusted', file: name, message: 'Not run: the file is not trusted' }); return; }
    files.push({ name, hash });
    loading.push(name);
    const forms = readForms(src, { spans: true });
    for (const { form, start, end } of forms) {
      const line = lineOf(src, start);
      try {
        if (Array.isArray(form) && sym(form[0]) === 'load') {
          const target = lisp.evaluate(form[1]);
          if (typeof target !== 'string') throw new Error('load needs a file name');
          await loadOne(resolveName(target, name), depth + 1);
          continue;
        }
        lisp.evaluate(form);
        const head = Array.isArray(form) ? sym(form[0]) : null;
        if (head === 'defun') defuns.set(sym(form[1]), src.slice(start, end));
        else if (head === 'setq' || head === 'setq-default') for (let i = 1; i < form.length; i += 2) touched.add(sym(form[i]));
        else if (head === 'add-to-list') touched.add(sym(lisp.evaluate(form[1])));
        else if (head === 'defvar' && form.length > 2) touched.add(sym(form[1]));
      } catch (e) {
        const m = e.message ?? String(e);
        report.push({ kind: 'error', file: name, line, message: /^void-function /.test(m) ? `Not supported: ${m.slice('void-function '.length)}` : m });
      }
    }
    if (forms.error) report.push({ kind: 'error', file: name, line: lineOf(src, forms.error.at), message: forms.error.message.replace(/ at character \d+$/, '') });
    loading.pop();
  };
  // A name without .el is tried with .el first, as load does
  const loadOne = async (name, depth) => {
    if (/\.[a-z]+$/i.test(name)) return run(name, depth);
    try { await read(`${name}.el`); return run(`${name}.el`, depth); } catch { return run(name, depth); }
  };

  await run(file, 0);

  const settings = {};
  const value = (n) => lisp.get(n);
  const problem = (n, e) => report.push({ kind: 'error', file, message: `${n}: ${e.message}` });
  const keep = (n) => report.push({ kind: 'kept', file, message: `${n} is kept but not used yet` });
  let kinds = null;
  const groupSeen = {};
  for (const n of touched) {
    try {
      if (SIMPLE[n]) { const [key, fmt] = SIMPLE[n]; settings[key] = fmt(value(n)); }
      else if (HOLIDAYS[n]) { kinds ??= new Set(Object.values(HOLIDAYS)); if (value(n) === null) kinds.delete(HOLIDAYS[n]); }
      else if (NOT_BUILT.includes(n)) { if (value(n) !== null) keep(n); }
      else if (n === 'org-capture-templates') { /* below, with the functions */ }
      else {
        const g = Object.keys(GROUPS).find((k) => GROUPS[k].includes(n));
        if (g) (groupSeen[g] ??= []).push(n);
        else keep(n);
      }
    } catch (e) { problem(n, e); }
  }
  for (const [key, vars] of Object.entries(groupSeen)) settings[key] = vars.map((n) => `(setq ${n} ${valueText(value(n))})`).join('\n');
  if (kinds) settings['calendar-holidays'] = kinds.size === 3 ? '' : kinds.size ? [...kinds].join(' ') : 'nil';
  if (touched.has('org-capture-templates')) {
    try {
      const t = `${[...defuns.values()].join('\n\n')}\n\n(setq org-capture-templates ${valueText(value('org-capture-templates'))})\n`.trimStart();
      parseTemplates(t);
      settings['org-capture-templates'] = t;
    } catch (e) { problem('org-capture-templates', e); }
  }
  return { settings, files, report };
}

const valueText = (v) => (Array.isArray(v) || isSym(v) ? `'${printLisp(v)}` : printLisp(v));
