import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseExtraMenu } from '../core/extra-menu.js';
import { makeLisp, NeedFile } from '../core/elisp.js';
import { readForms } from '../core/lisp-read.js';
import { parseTemplates, menuAt, templateByKey } from '../core/capture.js';

const MENU = `(defun my-goto-olp (file &rest path) (find-file file) (goto-char (org-find-olp (cons file path))))
(easy-menu-define my-menu global-map "Menu"
  '("My Menu"
    ["Open Agenda" org-agenda :help "Open Org Agenda"]
    ["📔 Journal" (org-capture nil "j")]
    "---"
    ("Submenu"
     ["Upper" upcase-region :enable (use-region-p)]
     ["Gone" nil :visible nil])
    ["Current" (my-goto-olp "home.org" "Bag" "Health" (format-time-string "%Y-%m"))]))`;

test('easy-menu-define: rows, separators, submenus and keywords', () => {
  const { items } = parseExtraMenu(MENU);
  assert.deepEqual(items.map((i) => i.kind), ['row', 'row', 'separator', 'submenu', 'row']);
  assert.equal(items[0].label, 'Open Agenda'); assert.equal(items[0].help, 'Open Org Agenda'); assert.equal(items[0].callback.sym, 'org-agenda');
  assert.equal(items[1].callback[0].sym, 'org-capture'); assert.equal(items[1].callback[2], 'j');
  assert.equal(items[3].items[0].enable[0].sym, 'use-region-p'); assert.equal(items[3].items[1].visible, null);
});

test('a menu without a name is an error', () => {
  assert.throws(() => parseExtraMenu('(easy-menu-define m nil "x" (quote (1)))'), /starts with its name/);
});

test('a function that opens a file and finds an outline path: find-file asks for the file, then the point is the heading', () => {
  const { forms } = parseExtraMenu(MENU);
  const files = new Map();
  const form = readForms('(my-goto-olp "home.org" "Bag" "Health" (format-time-string "%Y-%m"))')[0];
  let r;
  for (let i = 0; i < 3 && !r; i++) {
    try { r = makeLisp(forms, { files, now: new Date(Date.UTC(2026, 10, 26)) }).run(form); } catch (e) { if (e instanceof NeedFile) files.set(e.file, '* Bag\n** Health\n*** 2026-10\n*** 2026-11\n'); else throw e; }
  }
  assert.equal(r.file, 'home.org');
  assert.equal(r.text.slice(r.point - 1).split('\n')[0], '*** 2026-11');
});

test('a missing outline path names the level', () => {
  const { forms } = parseExtraMenu(MENU);
  const files = new Map([['home.org', '* Bag\n']]);
  assert.throws(() => makeLisp(forms, { files }).run(readForms('(my-goto-olp "home.org" "Bag" "Health")')[0]), /Heading not found on level 2: Health/);
});

test('capture menu: groups, members and keys', () => {
  const t = parseTemplates(`(setq org-capture-templates '(("a" "Alpha" entry (file "x.org") "* %?") ("w" "Work") ("wm" "Meeting" entry (file "x.org") "* %?") ("wt" "Task" entry (file "x.org") "* %?") ("z" "Zed" entry (file "x.org") "* %?")))`);
  assert.deepEqual(menuAt(t).map((m) => [m.key, m.group]), [['a', false], ['w', true], ['z', false]]);
  assert.deepEqual(menuAt(t, 'w').map((m) => [m.key, m.description]), [['wm', 'Meeting'], ['wt', 'Task']]);
  assert.equal(templateByKey(t, 'wm').description, 'Meeting');
  assert.equal(templateByKey(t, 'w'), undefined);
});

test('capture menu: a member key without a group entry is not shown (Emacs: v0.1.63 cg-implicit)', () => {
  const t = parseTemplates(`(setq org-capture-templates '(("wm" "Meeting" entry (file "x.org") "* %?") ("a" "Alpha" entry (file "x.org") "* %?")))`);
  assert.deepEqual(menuAt(t).map((m) => [m.key, m.group]), [['a', false]]);
});

test('the init file keeps the menu and the functions it uses as the extra-menu setting', async () => {
  const { loadInit } = await import('../core/init.js');
  const r = await loadInit({ file: 'init.el', read: async () => MENU, trusted: async () => true });
  assert.deepEqual(r.report, []);
  const { items } = parseExtraMenu(r.settings['serita-extra-menu']);
  assert.equal(items.length, 5);
  assert.match(r.settings['serita-extra-menu'], /defun my-goto-olp/);
});
