// The commands for links, footnotes and emphasis: C-c C-o, C-c l, C-c C-l, C-c C-x f and C-c C-x C-f. The text work is in core/links.js,
// core/footnote.js and core/emphasize.js; this file asks what Emacs asks and puts the results where the cursor is.
// `ctx` is what main.js lends: the current buffer, the cursor, prompts, and visiting files.

import * as L from '../../core/links.js';
import * as F from '../../core/footnote.js';
import { emphasize, MARKERS } from '../../core/emphasize.js';
import { evalLisp } from '../../core/tblisp.js';
import { readForms, isSym } from '../../core/lisp-read.js';

const dirOf = (name) => { const m = /^([a-z][a-z0-9]*:)?(.*)$/i.exec(name ?? ''); const p = m ? m[2] : ''; return p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : ''; };
const lineCol = (text, offset) => { const before = text.slice(0, offset).split('\n'); return { line: before.length - 1, col: before[before.length - 1].length }; };
const offsetOf = (text, line, col) => text.split('\n').slice(0, line).reduce((n, l) => n + l.length + 1, 0) + col;

/** org-link-abbrev-alist from its setting: Lisp text such as (("gh" . "https://github.com/%s")). */
export function abbrevAlist(src) {
  if (!src || !src.trim()) return [];
  try {
    const form = readForms(src)[0];
    const list = Array.isArray(form) ? form : form?.quote;
    if (!Array.isArray(list)) return [];
    return list.filter((e) => Array.isArray(e) && typeof e[0] === 'string').map((e) => [e[0], e.tail ?? e[1]]).filter(([, v]) => typeof v === 'string');
  } catch { return []; }
}

export function createLinkCommands(ctx) {
  /** The links C-c l has stored, newest first: { link, title }. */
  let stored = [];

  const text = () => ctx.buffer().text;
  const here = () => lineCol(text(), ctx.offset());
  const settings = () => ({
    alist: abbrevAlist(ctx.setting('org-link-abbrev-alist')),
    mustMatch: { t: true, nil: false }[ctx.setting('org-link-search-must-match-exact-headline')] ?? 'query-to-create',
    keep: ctx.setting('org-link-keep-stored-after-insertion') === 't',
    useId: ctx.setting('org-id-link-to-org-use-id') || 'nil',
    label: ctx.setting('org-footnote-auto-label') || 't',
    section: ctx.setting('org-footnote-section') === 'nil' ? null : (ctx.setting('org-footnote-section') || 'Footnotes'),
    inline: ctx.setting('org-footnote-define-inline') === 't',
    adjust: ctx.setting('org-footnote-auto-adjust') === 't',
  });

  /** Puts the cursor at a place in the buffer (after revealing it) and remembers where it was, so C-c & returns. */
  function goto(line, col = 0, { remember = true } = {}) {
    if (remember) ctx.leave();
    ctx.reveal(line);
    ctx.place(offsetOf(text(), line, col));
  }

  async function searchHere(option) {
    const s = settings();
    const r = L.search(text(), option, { mustMatch: s.mustMatch });
    if (r.error) { ctx.message(r.error, true); return; }
    if (r.sparse !== undefined) { await ctx.sparse(r.sparse); return; }
    if (r.create !== undefined) {
      if (!(await ctx.confirm('No match - create this as a new heading? '))) return;
      const made = L.createHeading(text(), r.create);
      ctx.apply(made.text);
      goto(made.line, made.col);
      return;
    }
    if (r.line !== null && r.line !== undefined) goto(r.line, r.col ?? 0);
  }

  /** Where a file link goes: a name in the same place as the buffer's file, unless it names a place itself. */
  function fileName(path) {
    let p = path.replace(/^~\//, '');
    if (/^[a-z][a-z0-9]*:/i.test(p) && !/^[a-z]:[\\/]/i.test(p)) return p;
    if (p.startsWith('/')) return p.slice(1);
    const name = ctx.buffer().name;
    const m = /^([a-z][a-z0-9]*:)?(.*)$/i.exec(name ?? '');
    const prefix = m?.[1] ?? '';
    const dir = dirOf(name);
    p = p.replace(/^\.\//, '');
    return `${prefix}${dir ? `${dir}/` : ''}${p}`;
  }

  async function openFileLink(parts) {
    const name = fileName(parts.path);
    const found = await ctx.visit(name);
    if (!found) { ctx.message(`Cannot open ${name}`, true); return; }
    if (parts.search) await searchHere(parts.search);
  }

  async function openId(id) {
    for (const b of ctx.buffers()) {
      const line = L.findId(b.text, id);
      if (line !== null) { await ctx.visit(b.name ?? b.title); goto(line, 0); return; }
    }
    for (const f of await ctx.orgFiles()) {
      const line = L.findId(f.text, id);
      if (line !== null) { await ctx.visit(f.name); goto(line, 0); return; }
    }
    ctx.message(`Cannot find entry with ID "${id}"`, true);
  }

  async function runShell(cmd) {
    if (!(await ctx.confirm(`Execute ${cmd} in shell? `))) return;
    ctx.message('Shell links cannot run in a browser', true);
  }

  async function runElisp(src) {
    if (!(await ctx.confirm(`Execute ${src} as Elisp? `))) return;
    try { ctx.message(`${src} => ${evalLisp(src).replace(/^"(.*)"$/s, '$1')}`); } catch (e) { ctx.message(e.message, true); }
  }

  /** Follows one link object from scanLine. */
  async function follow(obj) {
    if (obj.kind === 'footnote') { footnoteAt(obj.line, obj.start); return; }
    if (obj.kind === 'radio-link') { const at = L.radioTarget(text(), obj.name); if (at) goto(at.line, at.col); return; }
    if (obj.kind === 'target' || obj.kind === 'radio') { ctx.message('No link found', true); return; }
    const s = settings();
    const raw = obj.raw ?? `${obj.type}:${obj.path}`;
    const c = obj.format === 'bracket' ? L.classify(L.expandAbbrev(raw.replace(/\\(\\*)([[\]])/g, '$1$2'), s.alist)) : L.classify(`${obj.type}:${obj.path}`);
    const { type, path } = c;
    if (type === 'fuzzy' || type === 'custom-id') { await searchHere(type === 'custom-id' ? `#${path}` : path); return; }
    if (type === 'id') { await openId(path); return; }
    if (type.startsWith('file')) { await openFileLink(c); return; }
    if (type === 'http' || type === 'https' || type === 'ftp' || type === 'news') { ctx.openUrl(`${type}:${path}`); return; }
    if (type === 'mailto') { ctx.openUrl(`mailto:${path}`); return; }
    if (type === 'doi') { ctx.openUrl(`https://doi.org/${path}`); return; }
    if (type === 'elisp') { await runElisp(path); return; }
    if (type === 'shell') { await runShell(path); return; }
    ctx.message(`Not supported: ${type} links`, true);
  }

  /** C-c C-o */
  async function openAtPoint() {
    const { line, col } = here();
    const r = L.atPoint(text(), line, col);
    if (r.error) { ctx.message(r.error, true); return; }
    if (r.none) { ctx.message(r.none); return; }
    if (r.choose) {
      const lines = text().split('\n');
      const pick = await ctx.choose('Open which link?', r.choose.map((o, i) => ({ label: L.displayFormat(lines[o.line].slice(o.start, o.end)) || lines[o.line].slice(o.start, o.end), meta: `line ${o.line + 1}`, value: i, key: String(i + 1) })));
      if (pick === undefined) return;
      await follow(r.choose[pick]);
      return;
    }
    await follow(r.object);
  }

  /** A tap on a link the Outline view shows. */
  async function openAt(line, col) {
    const r = L.atPoint(text(), line, col);
    if (r.object) await follow(r.object);
  }

  /** C-c l */
  function storeLink() {
    const b = ctx.buffer();
    if (b.name === null) { ctx.message('No method for storing a link from this buffer', true); return; }
    const { line } = here();
    const r = L.store(b.text, line, fileLinkName(b.name), { useId: settings().useId });
    if (r.text) ctx.apply(r.text);
    stored = [{ link: r.link, title: r.title }, ...stored.filter((x) => x.link !== r.link)];
    ctx.message(`Stored: ${r.title ?? r.link}`);
  }
  const fileLinkName = (name) => name.replace(/^[a-z][a-z0-9]*:/i, '');

  /** C-c C-l; C-u asks for a file, C-u C-u for an absolute one. */
  async function insertLink() {
    const b = ctx.buffer();
    const { line, col } = here();
    const sel = ctx.selection();
    const plan = L.insertPlan(b.text, line, col, sel);
    const arg = ctx.arg();
    const dir = dirOf(fileLinkName(b.name ?? '')).replace(/^\//, '');
    const dirAbs = `/${dir}`.replace(/\/$/, '');
    let link;
    if (plan.mode === 'edit') {
      link = await ctx.ask({ prompt: 'Link:', title: 'Edit link', value: plan.link, ok: 'Next' });
    } else if (arg?.list) {
      const picked = await ctx.pickFile();
      if (picked === undefined) return;
      link = L.fileAnswer(picked, { absolute: arg.list >= 16, dir: dirAbs });
    } else {
      const def = stored[0];
      link = await ctx.ask({ prompt: def ? `Insert link (default ${def.link}):` : 'Insert link:', title: 'Insert link', help: 'A URL, a file: link, a heading with *, a custom ID with #, or text to search for.', value: '', ok: 'Next', complete: (t) => L.LINK_TYPES.map((x) => `${x}:`).filter((x) => x.startsWith(t.trim())).map((x) => ({ label: x, value: x })) });
    }
    if (link === undefined) return;
    const initial = plan.mode === 'edit' ? plan.desc : plan.desc ?? (stored.find((x) => x.link === link)?.title ?? null);
    const desc = link === '' ? '' : await ctx.ask({ prompt: 'Description:', title: 'Link description', value: initial ?? '', ok: 'Insert' });
    if (desc === undefined) return;
    const r = L.applyInsert(b.text, plan, { link, desc, dir: dirAbs.replace(/^\//, ''), keepAbsolute: arg?.list >= 16 });
    if (r.error) { if (r.text !== undefined) ctx.apply(r.text); ctx.message(r.error, true); return; }
    ctx.apply(r.text);
    ctx.place(r.offset);
    if (!settings().keep) stored = stored.filter((x) => !(L.normalizeFile(x.link, dirAbs.replace(/^\//, '')) === L.normalizeFile(link, dirAbs.replace(/^\//, ''))));
  }

  /** Puts the cursor where a footnote result says and shows its message. */
  function show(r, from) {
    if (r.text !== undefined && r.text !== from) ctx.apply(r.text);
    if (r.marked) ctx.leave();
    ctx.reveal(r.line);
    ctx.place(offsetOf(r.text ?? from, r.line, r.col));
    if (r.message) ctx.message(r.message);
  }

  function footnoteAt(line, col) {
    const r = F.jump(text(), line, col);
    if (r && r.line !== undefined) { const from = text(); if (r.marked) ctx.leave(); ctx.reveal(r.line); ctx.place(offsetOf(from, r.line, r.col)); if (r.message) ctx.message(r.message); }
  }

  /** C-c C-x f */
  async function footnote() {
    const b = ctx.buffer();
    const { line, col } = here();
    const s = settings();
    const arg = ctx.arg();
    const opts = { autoLabel: s.label, section: s.section, defineInline: s.inline, autoAdjust: s.adjust };
    let ask = { prefix: arg ? String(arg.list ?? arg.num) : null };
    for (let guard = 0; guard < 3; guard++) {
      const r = F.action(b.text, line, col, { ...ask, opts });
      if (r.need === 'label') {
        const label = await ctx.ask({ prompt: 'Label (leave empty for anonymous):', title: 'Footnote label', ok: 'Insert' });
        if (label === undefined) return;
        ask = { ...ask, label };
        continue;
      }
      if (r.need === 'choice') {
        const choice = await ctx.choose('Footnotes', [
          { label: 'Sort', meta: 's', value: 's', key: 's' }, { label: 'Renumber', meta: 'r', value: 'r', key: 'r' }, { label: 'Sort and renumber', meta: 'S', value: 'S', key: 'S' },
          { label: 'Normalize', meta: 'n', value: 'n', key: 'n' }, { label: 'Delete', meta: 'd', value: 'd', key: 'd' }]);
        if (choice === undefined) return;
        ask = { ...ask, choice };
        continue;
      }
      if (r.error) { ctx.message(r.error, true); return; }
      show(r, b.text);
      return;
    }
  }

  /** C-c C-x C-f */
  async function emphasizeCmd() {
    const b = ctx.buffer();
    const sel = ctx.selection();
    const at = ctx.offset();
    const ch = await ctx.chooseChar({ title: 'Emphasis', prompt: `Emphasis marker or tag: [${MARKERS}]`, items: [...MARKERS].map((m) => ({ label: m, meta: { '*': 'bold', '/': 'italic', _: 'underline', '=': 'verbatim', '~': 'code', '+': 'strike-through' }[m], value: m, key: m })).concat([{ label: 'Remove', meta: 'SPC', value: ' ', key: ' ' }]) });
    if (ch === undefined) return;
    const r = emphasize(b.text, sel ? sel.from : at, sel ? sel.to : at, ch);
    if (r.error) { ctx.message(r.error, true); return; }
    ctx.apply(r.text);
    ctx.place(r.offset);
  }

  return { openAtPoint, openAt, storeLink, insertLink, footnote, emphasize: emphasizeCmd, stored: () => stored, isSym };
}
