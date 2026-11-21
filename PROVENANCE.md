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
