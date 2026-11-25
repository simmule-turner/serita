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
