# Provenance log

Required by SPEC section 3, rule 5. One entry per module: who wrote it, which documents it was written from, and a statement about encumbered code.

Entry format:

    ## <module path>
    - Written by: <name or session>, <date>
    - Written from: <documents>
    - Statement: <no GNU Emacs, Org, or org-pwa source was read or consulted / exceptions>

## Project-level entries

### Session 2026-11-21: foundations planning
- Written by: Claude (Sonnet 5.5) session, 2026-11-21
- Written from: SPEC.md (as provided by the author); the Org Mode Compact Guide table of contents at https://orgmode.org/guide/ retrieved 2026-11-21 (titles only, see GUIDE-NODES.org)
- Statement: No GNU Emacs source, Org source, org-pwa source, or code derived from them was read, searched for, or fetched in this session. Limits of that statement: the model has general background knowledge of Org mode from its training, which cannot be audited; and the session's memory store holds the author's working preferences for org-pwa (process notes, not code). The spec's author states the spec was written by a session that had read parts of Emacs and Org source; the reviewer should confirm the spec's wording is behavioral only (SPEC section 3).

## Modules

Each tooling module below was written 2026-11-21 by the Claude (Sonnet 5.5) session from SPEC.md sections 3 and 11 and PROPOSAL-phase1.md only, using Node's standard library. Statement for every entry: no GNU Emacs, Org, or org-pwa source was read or consulted.

### `tools/license-check.mjs`
- Purpose: fail on a non-MIT project license or a dependency outside the lenient list (SPEC 3).

### `tools/denylist-check.mjs`
- Purpose: fail when source contains a string from `tools/denylist.txt` (license markers only so far; identifiers are added when identified).

### `tools/provenance-check.mjs`
- Purpose: fail when a code file has no entry in this log.

### `tools/dco-check.mjs`
- Purpose: fail when a commit lacks a Signed-off-by line.

### `core/names.js`
- Written from: SPEC 13.1 (storage names) and the author's examples (`github:home.org`, `local:notes.org`). Statement as above.

### `core/parse.js`
- Written from: SPEC 10 and 11 (lossless round trip, incremental reparse later) and the general shape of Org file syntax as an interface: headlines are stars then a space, then optional keyword, priority, comment marker, title and trailing tags; keyword lines, blocks with begin and end markers, drawers, tables, list items, planning lines. The Compact Guide was consulted only as a node list (`GUIDE-NODES.org`). The block rule (a begin line opens a block only when a matching end exists later) and the line classifier are the session's own design. Statement as above; the model's untraceable background knowledge of Org syntax applies.

### `core/serialize.js`
- Written from: SPEC 11 (parse then serialize returns the input). Statement as above.

### `core/document.js`
- Written from: PROPOSAL-phase1.md section 2 (immutable state, inverse patches, shared undo). The edit-batch and inverse-coordinate scheme is the session's own design. Statement as above.

### `app/interface/contract.js`, `app/interface/memory.js`
- Written from: PROPOSAL-phase1.md section 3 and SPEC 10 (the app interface, capability reporting, no imitation of missing capabilities, versioned writes with a conflict result). Statement as above.

### `app/storage/kv-memory.js`, `app/storage/kv-idb.js`, `app/storage/local.js`
- Written from: PROPOSAL-phase1.md and SPEC 4 and 13.1 (local app storage provider, versioned writes). The key-value contract (get, atomic update, keys) and the version-per-write scheme are the session's own design. `kv-idb.js` uses the standard browser IndexedDB interface as documented on the web platform; no code was copied from any library. Statement as above.

### `app/storage/github.js`
- Written from: GitHub's published REST documentation for repository contents (get, create or update, delete) and git trees, fetched 2026-11-21 from docs.github.com. Endpoint paths, headers, body fields, the 1 MB inline limit and the tree limits come from it. The documentation does not say which status a stale or missing sha produces, so the provider decides conflicts by re-reading the file; that rule is the session's own design. Statement as above.

### `app/storage/webdav.js`, `app/storage/xml.js`
- Written from: RFC 4918 (WebDAV) and RFC 9110 (HTTP semantics) as read from rfc-editor.org on 2026-11-21: PROPFIND with Depth 1 and the 207 multi-status structure, collections marked in resourcetype, hrefs as absolute paths or URIs and percent-encoded, PUT failing with 409 when the parent collection is missing, MKCOL status codes, If-Match (strong comparison) and If-None-Match: * with 412 on failure. The RFC text read did not state the success codes for PUT and DELETE, so any 2xx is accepted. The conflict rule (re-read after 404 or 412) and the ETag requirements are the session's own design. The XML reader is original, written from the XML structure those replies use. No WebDAV client, library or server source was read. Statement as above.

### `test/fake-webdav.js`, `test/webdav.test.js`, `test/xml.test.js`
- Written from: the same RFC text (the fake follows the rules listed above) and the module descriptions. Statement as above.

### `core/bytes.js`, `app/storage/browse.js`, `test/sizes.test.js`
- Written from: the author's request (Open shows a file's size when it can) and RFC 4918 section 15.4 as read on 2026-11-21 (the getcontentlength property carries the HTTP Content-Length value; the RFC does not say when it may be absent, so a missing size is null) and GitHub's tree documentation (blob entries include size). Folder browsing from a flat file list is the session's own design. Statement as above.

### `core/settings-file.js`, `test/settings-file.test.js`
- Written from: the author's decisions of 2026-11-21 (SPEC.md, "Settings export") and the Web Crypto API as documented (PBKDF2 key derivation, AES-GCM). The Org layout and the encrypted block are this project's own design. Statement as above.

### `app/main.js`, `app/ui/session.js`, `app/ui/config.js`, `app/ui/providers.js`, `app/ui/find.js`, `app/ui/recent.js`, `sw.js`, `index.html`, `app.css`, `manifest.webmanifest`
- Written from: the author's decisions and mockups of 2026-11-21 (SPEC.md, "Decided" tables), the author's screenshot of their own existing app for layout (shape of the screen only; no code), standard web platform documentation (service workers, Web App Manifest, IndexedDB, Web Crypto), and this project's own modules. The icons are generated plain images (a white letter on a green square). Statement as above.

- 0.11.20: keyboard focus after a sheet closes, the Menu button's focus, scroll position of the Settings screens and typed keys in the capture menu follow the author's decisions of 2026-11-27; no Emacs source or other program was consulted.
- 0.11.19: the Settings-wide search, single-panel Debugging and removal of Capture from the Menu follow the author's mockups and decisions of 2026-11-27; Skip and cross on a log note are the author's decision (no observed Emacs result: batch Emacs cannot cancel a note buffer); no Emacs source or other program was consulted.
- 0.11.18: the Settings regrouping (sections, search, Appearance and Debugging screens, Shift-selection and the three log rows) follows the author's mockups of 2026-11-27; the settings it exposes (org-log-done, org-log-reschedule, org-log-redeadline, org-support-shift-select) were already implemented from conformance results; no Emacs source or other program was consulted.

### `test/sw.test.js`, `test/config.test.js`, `test/find.test.js`, `test/recent.test.js`, `test/session.test.js`, `test/browser/app.mjs`, `test/browser/harness.mjs`
- Written from: the modules above and the author's decisions; expected values are hand-derived from those decisions, not from any other program. Statement as above.

### `core/outline.js`, `core/outline-edit.js`, `core/projection.js`, `app/ui/dom.js`, `app/ui/keys.js`, `app/ui/keyrow.js`, `app/ui/outline-view.js`, `test/outline.test.js`, `test/projection.test.js`, `test/keys.test.js`, `test/browser/views.mjs`
- Written from: the author's requests and mockups, and the Org Compact Guide's description of visibility cycling, #+STARTUP values, TODO sequences, and the structure-editing keys, read as behavior only. The fold model, projection, edit functions and key names are this project's own design. Statement as above.

### `app/ui/history.js`, `test/history.test.js`
- Written from: the author's request (a floating back button that returns to where the user came from, with a long press that says where) and the author's design. No other program or source was consulted. Statement as above.

### `core/lisp-list.js`, `core/effort.js`, `test/lisp-list.test.js`, `test/fixtures/emacs-effort.json`
- Written from: the author's request (agenda files kept as the list `init.el` would set) and the SPEC's storage names; the effort forms and the property text are the Emacs 30.1 conformance results for the ef-* cases, read as behavior only. Statement as above.

### `core/clock.js`, `test/clock.test.js`, `test/fixtures/emacs-clock.json`
- Written from: the author's request (clocking as Emacs does it) and the Emacs 30.1 conformance results for the ck-* cases (the text each key sequence leaves and the messages), read as behavior only. Statement as above.

### `core/body.js`, `test/body.test.js`
- Written from: the author's request (edit the text under a heading in the Outline view) and the author's design. No other program or source was consulted. Statement as above.

### `core/capture.js`, `core/lisp-read.js`, `test/capture.test.js`, `test/fixtures/emacs-capture.json`
- Written from: the author's request (capture as Emacs does it, templates stored as init.el writes them), the Org manual's description of capture templates, and the Emacs 30.1 conformance results for the cp-* cases (the text each template leaves and its errors), read as behavior only. Statement as above.

### `examples/*.org`, `test/examples.test.js`
- Written from: the author's request (SPEC.md section 9: a runnable example per chapter) and this project's own behavior. The text is original and dedicated to the public domain (CC0 1.0). No other program or source was consulted. Statement as above.

### `core/calendar.js`, `test/calendar.test.js`
- Written from: the author's request (a month to tap in the date prompt, with the time) and the calendar's own arithmetic (weeks start on Sunday; minutes step by five as the timestamp keys do). No other program or source was consulted. Statement as above.

### `core/refile.js`, `test/refile.test.js`
- Written from: the author's request (refile and archive as Emacs does), the Org manual's description of refile targets and archive locations, and the Emacs 30.1 conformance results for the rf-* and ar-* cases (the text each operation leaves, its messages and errors), read as behavior only. Statement as above.

### `app/ui/update.js`, `app/version.js`, `test/update.test.js`, `test/browser/update.mjs`
- Written from: the author's request (see an update, choose when to restart) and the service worker API as documented (waiting worker, updatefound, message ports, skipWaiting). Statement as above.

### `app/storage/device.js`, `test/device.test.js`
- Written from: the author's request (open and save files on a Chromebook) and the File System Access API as documented (file handles, permissions, createWritable). Names, versions by last-modified time and the permission handling are this project's own design. Statement as above.

### `app/storage/cached.js`
- Written from: SPEC 13.1 (offline cache for the GitHub and WebDAV providers, one commit per save, a three-way prompt on conflict) and the session's own design: a cache record per file holding the last server copy, an unsent local edit with a version token, and a queued delete; a sync that returns conflicts with base, mine and theirs. Only a typed network error counts as offline. Statement as above.

### `test/cached.test.js`
- Written from: the description above. Statement as above.

### `app/storage/conflict.js`
- Written from: the general idea of a three-way line merge (changes in different places combine; the same place changed differently is a conflict). The matching step is a standard longest-common-subsequence table written from its textbook definition. No diff or merge library or tool source was read. Statement as above.

### `test/fake-github.js`, `test/github.test.js`, `test/conflict.test.js`
- Written from: the same GitHub documentation (the fake follows the documented fields) and the module descriptions above. Statement as above.

### `app/interface/browser.js`
- Written from: PROPOSAL-phase1.md section 3 and SPEC 4 and 10 (browser implementation, capability reporting, no imitation of missing capabilities, native-only features reported unavailable). Browser feature names (clipboard, window.open, the file picker functions) are standard web platform interfaces. Statement as above.

### `test/local.test.js`, `test/browser.contract.test.js`
- Written from: the module descriptions above and the shared contract suite. Statement as above.

### `test/browser/run.mjs`
- Written from: SPEC 11 (browser smoke tests). A small static server and a Playwright launcher; Playwright is a development tool outside the project's dependencies. Statement as above.

### `test/contract.js`, `test/memory.contract.test.js`
- Written from: the interface description in PROPOSAL-phase1.md section 3; the shared suite every implementation must pass (SPEC 12, phase 9 gate). Statement as above.

### `test/parse.test.js`, `test/document.test.js`
- Written from: the module descriptions above; round-trip, metamorphic and seeded random tests per SPEC 11. Statement as above.

### `test/tools.test.js`
- Purpose: tests for the four checks above, written from their stated behavior.

## Conformance corpus

A separate repository holds questions (case files written by us) and results recorded by running GNU Emacs 30.1 on the maintainer's machine in batch mode through documented interfaces. No Emacs or Org source was read, and none is stored. The corpus is not imported by this repository and is not consulted while writing a module; mismatches found by the comparer are fixed from the Compact Guide and SPEC.

### `core/lines.js`, `core/killring.js`, `test/lines.test.js`, `test/browser/tools.mjs`
- Written from: the author's mockup and decisions (whole-line edits, a kill ring whose consecutive kills join), and observed results from the conformance corpus for M-RET and the TAB cycle, read as behavior only. Statement as above.

### `tools/install-hooks.mjs`, `.githooks/commit-msg`
- Written from: the git documentation (core.hooksPath, interpret-trailers). The hook signs off each commit, so the DCO check cannot fail for a missing line. Statement as above.

### `core/motion.js`, `test/motion.test.js`, `test/browser/motion.mjs`
- Written from: the author's decisions and observed results from the conformance corpus for the movement keys, read as behavior only. Statement as above.

### `core/properties.js`, `test/properties.test.js`, `app/ui/minibuffer.js`, `test/browser/commands.mjs`
- Written from: the author's mockups and decisions (the minibuffer row, Find with ▲ ▼ ✕, the command palette), and observed results from the conformance corpus for priorities, TODO states and property drawers, read as behavior only. Statement as above.

### `core/regexp.js`, `core/replace.js`, `core/sparse.js`, `core/timestamp.js`, `core/agenda.js`, `test/timestamp.test.js`, `test/agenda.test.js`, `test/regexp.test.js`, `test/replace.test.js`, `test/sparse.test.js`
- Written from: the Emacs manual's description of regexp syntax and query replace, and observed Emacs results (recorded as fixtures) read as data only. Statement as above.

### `core/diary.js`, `test/diary.test.js`
- Written from: observed Emacs 30.1 diary listings for the date forms and the calendar sexps (conformance v0.1.25), recorded as fixtures and read as behavior only. Statement as above.

### `core/holidays.js`, `test/holidays.test.js`
- Written from: observed Emacs 30.1 holiday lists for the general and Christian categories and the local forms (conformance v0.1.26), recorded as fixtures and read as behavior only, and the published Gauss/Meeus rule for the date of Easter. Statement as above.

### `app/ui/viewport.js`, `test/browser/keyboard.mjs`
- Written from: the standard Visual Viewport API (resize and scroll events, height and offsetTop). Statement as above.

### `core/contacts.js`, `test/contacts.test.js`, `test/diary-display.test.js`
- Written from the lists Emacs 30.1 showed for diary continuation, non-marking and time lines (conformance v0.1.33), and: observed Emacs 30.1 results with org-contacts 1.3 for which dates and properties it accepts (conformance v0.1.30 to v0.1.32), and the author's example contacts and agenda with the lines Emacs showed, read as behavior only. Statement as above.

### `core/solar.js`, `test/solar.test.js`
- Written from: the published equinox and solstice algorithm in Jean Meeus, Astronomical Algorithms, chapter 27, and the times Emacs 30.1 listed for 2026 to 2028 (conformance v0.1.26), read as behavior only. Statement as above.

### `core/agenda-filter.js`, `test/agenda-filter.test.js`
- Written from: observed Emacs 30.1 results for the agenda's tag, category, effort and regexp filters and for marks and bulk actions (conformance v0.1.23 and v0.1.24), read as behavior only. Statement as above.

### `test/browser/appearance.mjs`
- Written from: the author's mockup and decisions (Appearance screen, heading swipe, restore of open files). Statement as above.

### `core/table.js`, `test/table.test.js`
- Written from: the Org manual's description of tables and observed Emacs 30.1 results with Org 9.7.11 for the table keys, alignment, sorting, conversion, import and export (conformance v0.1.34), recorded as fixtures and read as behavior only. Statement as above.

### `core/prefix.js`, `test/prefix.test.js`
- Written from: observed Emacs 30.1 results with Org 9.7.11 for `org-agenda-prefix-format` and `org-agenda-category-icon-alist` (conformance v0.1.37), recorded as fixtures and read as behavior only. Statement as above.

### `core/universal.js`, `test/universal.test.js`, `test/prefix-args.test.js`
- Written from: the Emacs manual's description of the universal argument and observed Emacs 30.1 results with Org 9.7.11 for refile, cycling, TODO states, heading insertion and table sorting with a prefix (conformance v0.1.38), recorded as fixtures and read as behavior only. Statement as above.

### `app/storage/timeout.js`, `test/timeout.test.js`
- Written from: the Fetch standard's AbortController interface. No other project's code was consulted.

### `core/calc.js`, `core/units.js`, `core/tblfm.js`, `test/tblfm.test.js`, `test/fixtures/emacs-tblfm.json`
- Written from: the Org manual's chapter on the spreadsheet (references, ranges, flags, #+TBLFM: lines) and the Calc manual's description of algebraic entry and of units (usimplify), the unit sizes from standard reference tables, and observed Emacs 30.1 results with Org 9.7.11 for formula questions (conformance v0.1.40 to v0.1.53, the unit names and sizes from conversions the oracle performed), recorded as the fixture and read as behavior only. Statement as above.

### `core/tblcmd.js`, `test/tblcmd.test.js`, `test/fixtures/emacs-tblcmd.json`, `test/fixtures/emacs-iterate.json`
- Written from: the Org manual's description of recalculation (C-c *, C-u C-c *, C-u C-u C-c *, C-c =, C-u C-c =) and observed Emacs 30.1 results with Org 9.7.11 for the commands and messages (conformance v0.1.41, v0.1.42 and v0.1.49), recorded as the fixture and read as behavior only. No other project's code was consulted.

### `core/tblisp.js`
- Written from: the Emacs Lisp manual's descriptions of the functions it implements (arithmetic, strings, format, format-time-string, date-to-time) and observed Emacs 30.1 results with Org 9.7.11 for Lisp formulas (conformance v0.1.41), recorded as fixtures and read as behavior only. Statement as above.

### `core/plot.js`, `test/plot.test.js`, `test/fixtures/emacs-plot.json`, `test/fixtures/emacs-plotscript.json`
- Written from: the Org manual's section on org-plot (the `#+PLOT:` options and plot types) and observed Emacs 30.1 results with Org 9.7.11 for option merging, defaults and the gnuplot script it produces (conformance v0.1.45 to v0.1.48, gnuplot stubbed), recorded as fixtures and read as behavior only. The charts are drawn by Serita's own SVG code. No other project's code was consulted.

### `core/elisp.js`, `test/capture-templates.test.js`, `test/fixtures/emacs-capture-templates.json`, `test/fixtures/user-templates.el`
- Written from: the Emacs Lisp manual's descriptions of the functions it implements (let, setq, dolist, format, re-search-forward and re-search-backward, insert, replace-match, flush-lines) and observed Emacs 30.1 results with Org 9.7.11 for capture into a function target, :prepare-finalize, item bullets and numbering, tag alignment and table formulas after capture (conformance v0.1.55 and v0.1.56), recorded as fixtures and read as behavior only. user-templates.el is the author's own configuration. No other project's code was consulted.

### `core/tblexport.js`, `core/orgmarkup.js`, `core/entities.js`, `test/table-transfer.test.js`, `test/orgmarkup.test.js`, `test/orgmarkup-cells.test.js`, `test/fixtures/emacs-table-transfer.json`, `test/fixtures/emacs-markup-cells.json`
- Written from: the Org manual's chapters on tables (exporting, importing, rectangles, recalculation marks) and observed Emacs 30.1 results with Org 9.7.11 for orgtbl-to-csv, -tsv, -orgtbl, -generic, -latex, -html, -texinfo and -unicode, org-table-import, org-table-convert-region, rectangle copy, cut and paste, mark rotation, and the translation of inline markup, links, entities and special strings in cells (conformance v0.1.54, v0.1.57, v0.1.58 and v0.1.64 to v0.1.67; the entity table is a dump of org-entities), recorded as fixtures and read as behavior only. No other project's code was consulted.

### `core/init.js`, `test/init.test.js`, `test/fixtures/init/`
- Written from: the Emacs Lisp manual's descriptions of load, setq, defvar, defun and add-to-list (the new element goes first unless APPEND is given). The fixtures are the author's own configuration files. No other project's code was consulted.

### `core/subtree.js`, `test/subtree.test.js`, `test/fixtures/emacs-subtree.json`
- Written from: the Org manual's description of cutting, copying and pasting subtrees and observed Emacs 30.1 results with Org 9.7.11 for org-cut-subtree, org-copy-subtree and org-paste-subtree. No other project's code was consulted.

### `test/conditional.test.js`
- Written from: the HTTP standard's description of conditional requests (If-None-Match and 304). No other project's code was consulted.

### `core/datetree.js`, `test/datetree.test.js`, `test/capture-clock.test.js`, `test/fixtures/emacs-datetree.json`
- Written from: the Org manual's description of capture targets for date and week trees and observed Emacs 30.1 results with Org 9.7.11 for where an entry, item, checkitem, plain text or table row goes (existing and missing years, months, weeks and days, ordering, :prepend, :empty-lines, +prompt, file+olp+datetree), and for :clock-in, :clock-keep and :clock-resume (conformance v0.1.63), recorded as fixtures and read as behavior only. No other project's code was consulted.

### `core/extra-menu.js`, `test/extra-menu.test.js`
- Written from: the Emacs Lisp manual's description of easy-menu-define (menu items as vectors with :help, :enable and :visible, the "---" separator, submenus as lists) and observed Emacs 30.1 results with Org 9.7.11 for org-capture-select-template (groups, keys, order) and org-find-olp (conformance v0.1.61 to v0.1.63). No other project's code was consulted.

### `core/links.js`, `core/footnote.js`, `core/emphasize.js`, `core/emphasis.js`, `app/ui/inline.js`, `app/ui/linkcmds.js`, `test/links.test.js`, `test/footnote.test.js`, `test/emphasize.test.js`, `test/emphasis.test.js`, `test/insert-link.test.js`, `test/browser/links.mjs`, `test/fixtures/emacs-objects.json`, `test/fixtures/emacs-entry-links.json`, `test/fixtures/emacs-insert-link.json`, `test/fixtures/emacs-footnote.json`, `test/fixtures/emacs-emphasize.json`, `test/fixtures/emacs-emphasis.json`
- Written from: the Org manual's chapters on hyperlinks (link formats, internal links, search options, abbreviations, handling links), footnotes and emphasis markup, and observed Emacs 30.1 results with Org 9.7.11 for link parsing, org-open-at-point, org-store-link, org-insert-link, org-footnote-action and org-emphasize (conformance v0.1.70 to v0.1.75). No other project's code was consulted, and no Emacs or Org source was read.

### `test/datetree2.test.js`, `test/recalc-marks.test.js`, `test/fixtures/emacs-datetree2.json`, `test/fixtures/emacs-recalc-marks.json`
- Written from: the Org manual's description of date and week trees and of recalculation marks, and observed Emacs 30.1 results with Org 9.7.11 for ISO-year week trees, month trees, prompted dates, and which rows a recalculation covers (conformance v0.1.68 and v0.1.69). No other project's code was consulted.

### `core/lists.js`, `test/lists.test.js`, `test/lists2.test.js`, `test/browser/lists.mjs`, `test/fixtures/emacs-lists.json`, `test/fixtures/emacs-lists2.json`, `test/fixtures/emacs-paste-subtree.json`
- Written from: the Org manual's chapter on plain lists (items, bullets, numbering, checkboxes, sorting) and observed Emacs 30.1 results with Org 9.7.11 for M-RET, M-S-RET, C-c -, org-toggle-item, org-toggle-heading, org-toggle-checkbox with prefix arguments, org-sort-list, list repair, item moves and indents, and org-paste-subtree with prefix arguments (conformance v0.1.73). No other project's code was consulted.

### `test/lists3.test.js`, `test/dateprompt.test.js`, `test/fixtures/emacs-lists3.json`, `test/fixtures/emacs-dateprompt.json`, `test/fixtures/emacs-dateprefill.json`
- Written from observed Emacs 30.1 results with Org 9.7.11 for C-c - with prefix arguments, S-left and S-right on item lines, and the date a prompt gives when it starts from a date already set (conformance v0.1.76, v0.1.77 and v0.1.78 and v0.1.79: li3-*, li4-*,li5-*, dp-*, dt-*, dd-*, ddr-*); no Emacs or Org source was read.

### `test/logbook.test.js`, `test/browser/logging.mjs`, `test/fixtures/emacs-logging.json`
- Logging, radio targets, multi-line emphasis, typed dates and list details were written from observed Emacs 30.1 results (conformance v0.1.74 and v0.1.75: lg-*, rt-*, me-*, dq-*, li2-*); no Emacs or Org source was read.
- 0.11.11: the date prompt starting from the date already set follows the org-read-date default described in the Org manual and the `+N` / `++N` results of conformance v0.1.75 (dq-*); conformance v0.1.76 (dp-*) asks Emacs for the prompt text. The browser tests for it, for radio taps in the Outline view, for S-right on a bullet and for multi-line emphasis markers were written by us.

### 0.11.21: `core/solar.js` (sunriseSunset), `core/diary.js`, `test/sunrise.test.js`, `test/fixtures/emacs-sunrise.json`, `core/sparse.js` (dateSparse, deadlineSparse), `core/links.js` (radioBreaks), `core/timestamp.js` (formatHeading, closing notes for repeats), `core/outline.js` (startupLog), `core/init.js`, `examples/logging.org`, `test/fixtures/emacs-sparse-dates.json`, `test/fixtures/emacs-sparse-deadlines.json`, `test/fixtures/emacs-radio-breaks.json`, `test/fixtures/emacs-repeat-log.json`, `test/fixtures/emacs-logging.json` (org-log-refile)
- Written from observed Emacs 30.1 results with Org 9.7.11: sparse trees by date and radio targets over line breaks (conformance v0.1.76: sd-*, rt3-*), the refile log line (v0.1.74: lg-refile*), deadline sparse trees, repeat and closing-note logs, log note headings, `#+STARTUP: log*` words and `C-c .` on an existing stamp (v0.1.80: cd-*, se-*, rp-*, nh-*, sx-*, ts-*; v0.1.81: rf-*, np-*, ts-*, ds-*, kw-*); no Emacs or Org source was read. The note prompt texts follow the buffer text recorded in v0.1.81 (np-*).
- Sunrise and sunset use the published NOAA low-precision solar position method (equation of time and declination from the Julian century); the zenith angle 90.6 degrees was fitted to Emacs 30.1's results (v0.1.80 sun-*, v0.1.81 sn-*), and times can differ from Emacs by a minute.
- calendar-time-display-form, solar-sunrise-sunset, solar-time-string and the diary sexp forms when, let, format, apply, car, cadr and nth follow the Emacs manual's descriptions and Emacs 30.1's results for the 24-hour and 12-hour forms (v0.1.80 sun-h24, sun-h12ampm); calendar-current-date reads the device's date; string-replace and replace-regexp-in-string follow the Emacs manual (the regexp through the Emacs regexp translator).

### 0.11.22: `core/agenda.js` (sexpStamps, headline timestamps), `test/sexp-stamps.test.js`, `test/fixtures/emacs-sexp-stamps.json`
- Written from observed Emacs 30.1 results with Org 9.7.11 (conformance v0.1.82: ts-*): a timestamp in a headline and `<%%(sexp)>` in a headline, a body line or after SCHEDULED/DEADLINE show the heading on each day the sexp holds. Conformance v0.1.83 (ss-*) shows that the heading appears as written whatever the sexp returns (a string, a cons), and that a sexp that is nil or fails shows nothing.

### 0.11.29: `core/weather.js`, `core/diary.js` (org-weather, defineFunctions: init-file defuns callable from diary sexps), `core/init.js`, `app/main.js` (refreshWeather, org-weather-refresh), `test/weather.test.js`, `test/browser/weather.mjs`, `app/main.js` (the Agenda's Calendar button, × in the title row), `app.css` (the Agenda's top like the Calendar's), `test/browser/sun.mjs`, `test/browser/commands.mjs`, `core/pretty.js`, `app/ui/inline.js` (drawn scripts and entities), `core/sparse.js` (dateSparse type), `core/timestamp.js` (user, %u/%U), `app/ui/keys.js` (enter), `test/round88.test.js`, `test/fixtures/emacs-round88.json`, `examples/outline.org`, `examples/dates.org`, `examples/config.org`, `test/browser/scripts.mjs`, `test/fixtures/emacs-round89.json`, `test/fixtures/emacs-round90.json` (the case cd-neg was dropped from `emacs-sparse-deadlines.json`: it was recorded with a clock that disagreed with the date given to Org, and dd-neg replaces it)
- Written from the author's table of org-weather-format placeholders and units, and Open-Meteo's published parameters and WMO weather-code table at https://open-meteo.com/en/docs (fetched 2026-11-28). The forecast in the tests is hand-built in the shape that page describes. No Emacs, Org or org-weather source was read.

### 0.11.28: `app/main.js` (note prompt, unplanHere, C-u C-c ., startup settings), `app/ui/inline.js`, `app/ui/outline-view.js`, `core/timestamp.js` (removePlanning, stamp ranges), `core/init.js`, `test/unplan.test.js`, `test/fixtures/emacs-unplan.json`, `test/browser/logging.mjs`, `test/browser/commands.mjs`, `test/browser/links.mjs`
- Written from observed Emacs 30.1 results with Org 9.7.11: conformance v0.1.87 (sk-*) shows that a note saved empty logs the heading line alone and a canceled note logs nothing while the change itself stays; v0.1.81 ds-* shows the lines left by removing a schedule or deadline, that rescheduling drops CLOSED, and that leaving a done keyword in a file with log marks drops CLOSED; ts-cu-* shows what C-u C-c . puts in the prompt and keeps. The fixture holds the four ds-* buffers. Line numbers and wrapping come from display-line-numbers-mode and org-startup-truncated as the Emacs manual describes them. No Emacs or Org source was read.

### 0.11.27: `app.css` (the message line above the dimming layer behind every sheet), `test/browser/sun.mjs`
- Our own styling; the browser test checks the message is not under the dimming layer behind the Calendar and the month sheet.

### 0.11.26: `app.css` (the message line above the dimming layer in the Calendar), `test/browser/sun.mjs`
- Our own styling; the browser test checks that the message is not under the dimming layer.

### 0.11.25: `app/main.js` (the Calendar's Sun button), `test/browser/sun.mjs`
- The Sun button says what the S key says (conformance v0.1.86: cm-cal-day); its place in the row is our own layout.

### 0.11.24: `core/solar.js` (placeName, dateLabel, monthSunTimes), `app/main.js`, `test/sunrise.test.js`, `test/fixtures/emacs-sunrise-month.json`, `test/browser/sun.mjs`
- The sunrise-sunset message, its date prefix with an argument, the month list and the Calendar's S key follow Emacs 30.1's results (conformance v0.1.84: sr-*, v0.1.85: mo-*, v0.1.86: cm-*); the month sheet and its Copy and Close buttons are our own layout. The browser test was written by us.

### 0.11.23: `core/diary.js` (string-replace, replace-regexp-in-string, cons), `test/sunrise.test.js`
- string-replace and replace-regexp-in-string follow the Emacs manual; the regexp goes through the Emacs regexp translator. The sunrise tests fix their time zone, so they pass anywhere.
