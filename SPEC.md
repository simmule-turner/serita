# emacs-org: Product Specification

## 1. Original instructions (preserved verbatim)

These instructions are part of the specification. Where anything below conflicts with them, they win.

> Given your experience can you write the specs for an app emacs-org. It will be a pwa that supports android, iOS, chrome books, and desktop browsers. It will support native android and iOS builds like our current app using a similar framework.
>
> The basis for the app will be the functionality in the org compact guide. This version should be a clean implementation that does not have any GPL code. All the code written must be freely distributed with a more lenient license.
>
> We should have similar capabilities like org-pwa, like The various modes, similar look and feel, lisp and JavaScript babel support. Our target feature set is going to be constrained by the compact guide. Along the way we should produce .org documentation and examples. We should have an info reader as that should be the basis for the help.
>
> These instructions should be preserved as part of the specification. We will use the specs in a separate session once the are written sufficiently to avoid any contamination.

Standing working rules from the same author, which carry over to this project: targeted diffs, no fabricated APIs, American spelling, rounded-rectangle buttons, opaque popups, no fallback code, one implementation per capability, Emacs regexp syntax for anything Emacs-like, a mockup before any UI change, a new version number for every delivered build, README in the style of the Org Compact Guide, CHANGELOG with one short paragraph per release.

**Addendum, 2026-11-21 (same author, verbatim).** With three configuration files attached (reproduced in Appendix A):

> The functionality required to implement these capture templates and other features; must be available. We might not be able to use the code but we need this capability:

Section 13 turns that into requirements. It extends the Compact Guide scope; where it conflicts with the non-goals in section 2, section 13 wins.

## 2. Purpose, goals, non-goals

emacs-org is a clean-room, permissively licensed Org-mode app for phones, tablets, Chromebooks and desktop browsers. Its feature set is exactly what the Org Compact Guide covers, nothing more.

**Name.** The public name is Serita, with the subtitle: reads and writes Org files. "emacs-org" is the working name used in this document and in the repository until the first release.

**Reference guide.** The behavioral reference is the Org Mode Compact Guide as published at orgmode.org/guide on 2026-11-21 (copyright 2004–2026 FSF, GFDL 1.3). The guide states no Org version, so the pin is the retrieval date plus the list of its chapter and section nodes, recorded as the first implementation step. No copy of the guide's text is kept in the repository. A later guide revision is reviewed and adopted by an explicit decision, never picked up automatically.

**Goals**

1. Every capability in the Compact Guide, chapter by chapter, works the way the guide describes it.
2. One codebase runs as an installable PWA and inside native Android and iOS shells, offline first.
3. Several modes over one document model: a touch-first Outline mode, a plain Text mode, and an Emacs-keys mode (section 6).
4. Babel runs Emacs Lisp and JavaScript source blocks.
5. An Info reader is the help system, and the help is written in Org.
6. The app ships its own Org documentation and runnable examples.
7. Every line of code is original or under a lenient license (section 3).

**Non-goals**

- Anything outside the Compact Guide (Publishing, the full Org manual, Emacs packages, other Babel languages) unless a later decision adds it.
- Running Emacs or Emacs Lisp packages in general. The Lisp support is a small interpreter for Babel and variables, not a port of Emacs.
- Server components. Sync is by files and the user's own storage.

## 3. License and clean-room rules

The project's code is released under the MIT license. Documentation and examples are CC BY 4.0 or CC0. No file may carry GPL, LGPL, AGPL or GFDL terms, and every dependency must be MIT, BSD, ISC, Apache-2.0 or similar. A license check runs in CI and fails the build on anything else.

**Honest status of this specification.** It was written by a session that had worked on org-pwa and had read parts of GNU Emacs and Org source while verifying behavior. To limit contamination it describes behavior at the level of the Compact Guide only: no code, no internal names, no algorithms taken from Emacs or Org. Whoever reviews it for the implementation session should confirm that.

**Rules for the implementers**

1. Do not read, paste, port or translate GNU Emacs or Org source, the org-pwa source, or generated data from either. Their behavior is learned from the Compact Guide and this spec, and from running Emacs as a black box only if section 11 allows it.
2. The Compact Guide is the behavioral reference. Do not copy its text: it is GFDL. Write all documentation and help in original words.
3. Key names, command names and file syntax are interfaces, not code, and may be used. Prose, examples and data tables from GPL or GFDL sources may not.
4. Parsers, the Lisp interpreter, the date reader, the table calculator and the export engine are written from the written description of what they accept and produce, with tests written from the guide and from the spec's own examples.
5. Keep a provenance log: for each module, who wrote it, which documents it was written from, and a statement that no encumbered code was consulted.
6. A contributor agreement or DCO sign-off is required for every commit.

## 4. Platforms and delivery

One web codebase serves every platform. Native builds wrap the same code and add what a browser cannot do.

| Platform | Delivery | Notes |
| --- | --- | --- |
| Chrome, Edge, Firefox, Safari on desktop | Installable PWA | Keyboard-first; Emacs-keys mode is the natural fit |
| ChromeOS | Installable PWA | Treated as desktop with touch |
| Android | PWA and a native shell | Shell adds disk folders, background notifications, link handlers |
| iOS and iPadOS | PWA and a native shell | PWA limits (storage eviction, no background work) are the reason for the shell |

**Requirements for every platform**

- Works offline after the first load; a service worker precaches every module and the Info manuals.
- Phone width (about 400 px) through desktop; touch and keyboard both first-class.
- Documents live in app storage by default. Where the platform allows, the user can open and save real files and folders (File System Access in Chromium, the native shell elsewhere).
- No account, no server, no telemetry. Sync is by the user's own file storage.
- Every delivered build has a new version number; the service worker cache name changes with it.

**Browser-impossible features go in the native shells** behind one app interface (section 10): reading and writing real disk files and folders, tangle targets on disk, background notifications and appointment reminders, OS link handlers (mailto, irc, news and similar), and file-name completion. The web build implements the same interface with what the browser has and reports clearly when a capability is absent. There is no fallback code path that pretends otherwise.

## 5. Feature scope by Compact Guide chapter

The scope is the guide's chapters. Each row is a work package: implement every command and behavior the guide's chapter names, document it in Org, and ship an example. The "Needs" column marks where native shells or a decision matter.

| Chapter | Scope | Needs |
| --- | --- | --- |
| Headlines | Create, promote, demote, move, mark, narrow, toggle comment and archive tags | none |
| Visibility cycling | Global and local cycling, startup visibility, drawers | none |
| Motion | Heading, sibling, parent and level navigation | none |
| Structure editing | Insert, kill, copy, yank, refile subtrees, sort, clone | none |
| Sparse trees | Match tags, properties, TODO states, dates, regexps | none |
| Plain lists | Bullets, numbers, descriptions, checkboxes, reordering, renumbering | none |
| Tables | Editing, alignment, rows and columns, formulas, sorting, import and export | formula engine |
| Hyperlinks | Internal, external and file links, targets, abbreviations, following | native: OS link types, file completion |
| TODO items | Keywords, sequences, states, logging, priorities, subtasks, checkboxes | none |
| Tags | Inheritance, groups, fast selection, searching | none |
| Properties | Drawers, special properties, column view, property search | none |
| Dates and times | Timestamps, ranges, repeaters, deadlines, scheduling, clocking, effort | native: reminders |
| Capture, refile, archive | Templates and their escapes, refile targets, archive locations | none |
| Agenda views | Files, dispatcher, daily and weekly agenda, global TODO list, tag and property match, text search, custom views, commands, marks and bulk actions, filters | native: reminders |
| Markup | Emphasis, paragraphs, tables, lists, blocks, footnotes, entities, LaTeX fragments | none |
| Exporting | HTML, then Slides (Beamer-like), then ASCII; iCalendar and vCard (13.6); options, include files, export settings | native: save to disk |
| Working with source code | Blocks, header arguments, results, evaluation, tangling, noweb, Lisp and JavaScript | native: tangle to disk |
| Miscellaneous | Completion, edit-special, speed keys, in-buffer settings, link-handling | none |

**Definition of done for a chapter**

1. Every command in the chapter works from the touch UI, the command palette and, in Emacs-keys mode, the key the guide gives.
2. The chapter has an Org page in the manual (section 9) and a runnable example file.
3. The chapter's tests pass (section 11).
4. Anything left out is recorded with a reason in a roadmap file, never silently dropped.

## 6. Modes and look and feel

All modes edit one document model. Switching modes never reparses or reformats the text, and undo is shared.

| Mode | For | Behavior |
| --- | --- | --- |
| Outline | Touch and quick capture | Headings as a foldable tree; tapping a heading opens its actions; checkboxes, states and dates are tappable controls |
| Text | Editing the raw Org text | A plain editor with Org-aware commands, folding drawn as an ellipsis, a row of extra keys on phones |
| Emacs keys | Keyboard users who know Emacs | The Compact Guide's key bindings, prefix keys, universal argument, minibuffer prompts and echo-area messages, in the Text view and the Agenda |
| Agenda | Planning | Daily and weekly agenda, TODO list, match and search views, with their own keys and a focused-row model |

**Defaults.** When the app has a choice, it does what the guide says Emacs does. A setting may change that, and settings can be saved in a config file in Org syntax.

**Look and feel**

- Mobile first. A top bar with the view menu, a command palette (M-x style, completing by prefix) and a bottom key row in Text mode.
- Rounded-rectangle buttons with centered labels; controls vertically centered with equal space above and below; prompts the same size and style everywhere.
- Popups and menus are opaque.
- Light and dark themes follow the system and can be set; the colors for TODO and DONE keywords, priorities, tags, deadlines and the agenda's time grid are settings.
- Settings screens use plain wording; the variable name lives in the saved config, not in the label.
- Any new layout or control is mocked up and approved before it is built.
- Accessibility: every control reachable by keyboard and screen reader, text scales with the system setting, contrast meets WCAG AA.

## 7. Babel: Lisp and JavaScript

Source blocks follow the guide's Working with Source Code chapter. Two languages run in the app: `emacs-lisp` and `js` (`javascript` is an alias). Other languages are edited and exported but not evaluated.

**Header arguments** as the guide lists them, at block, heading (property) and file level: `:var`, `:results` (value, output, table, list, raw, verbatim, replace, append, silent), `:exports`, `:tangle`, `:noweb`, `:session`, `:cache`, `:dir`, `:eval`. Named blocks and `#+CALL:` pass values between blocks.

**JavaScript.** Each evaluation runs in a Web Worker with no DOM, no network and no storage, a time limit (default 10 seconds, a setting) and a memory cap by termination. `:var` values arrive as JavaScript values; tables become arrays of arrays. The value of the last expression is the result in value mode; `console.log` output is the result in output mode. A `:session` keeps one worker alive across blocks.

**Emacs Lisp.** A small interpreter written from the language's public semantics, not from Emacs. It is used for `emacs-lisp` blocks, table formulas that use `'(...)`, and settings in `#+STARTUP` and file-local variables.

1. Reader: lists, dotted pairs, quote, backquote with comma and comma-at, strings with escapes, characters, integers, floats, vectors, symbols.
2. Special forms and macros: `quote`, `function`, `lambda`, `if`, `cond`, `and`, `or`, `progn`, `let`, `let*`, `setq`, `while`, `dolist`, `dotimes`, `when`, `unless`, `defun`, `defvar`, `defmacro`, `condition-case`, `unwind-protect`, `catch`, `throw`.
3. Library: lists, sequences, strings, numbers, symbols, plists and alists, hash tables, `format`, `message`, `concat`, string and regexp functions using Emacs regexp syntax, `mapcar` and friends, time and date functions, and the buffer and text functions listed in section 13.4, which the capture target functions need.
4. Errors carry Emacs's error symbols and messages so that `condition-case` works as the guide shows.
5. Dynamic scope for `defvar` variables, lexical scope elsewhere. Tail calls are not required; a depth limit raises a clean error.
6. No file, process or network functions. File access goes through the app interface and the user's grant.

**Safety.** Evaluation of a block asks for confirmation the first time, per block or per file as the user chooses, and never runs on open. A document from elsewhere is untrusted until the user says otherwise. The same rule covers `:var` references that evaluate code and Lisp in table formulas.

## 8. Info reader and help

The help system is an Info reader. It reads the app's own manuals, which are written in Org and compiled at build time to a compact node-and-index form. There is no separate help screen and no web-hosted help.

**Reader behavior**

- Nodes with Next, Previous and Up links, a top node, a menu per node, cross-references and footnotes, an index, and a table of contents.
- Emacs Info keys in Emacs-keys mode (`n`, `p`, `u`, `l`, `t`, `d`, `m`, `g`, `i`, `,`, `s`, `SPC`, `DEL`, `q`, `TAB`, `RET`); in the other modes the same actions are on-screen buttons and swipes.
- Search across the manual with results listed by node; `i` completes index entries.
- Links in a manual can run a command or open an example file in the app.
- History (back and forward) and a bookmark per node, kept across sessions.
- Context help: from any command or setting, one tap or key opens the manual at the node that describes it.

**Build pipeline.** The manuals are Org files in the repository. A build step converts them to the reader's format using the app's own Org parser and exporter, so the help exercises the same code as the documents. The build fails on a broken cross-reference or a command with no documentation.

**Manuals shipped**

1. The emacs-org manual, organized like the Compact Guide chapter by chapter (the "Org Compact Guide" style: short paragraphs, a command with a one-line description, one example).
2. A keys reference generated from the key map, so it cannot drift from the app.
3. A short Lisp and JavaScript Babel reference.
4. The Info reader's own manual.

All manual text is original (section 3).

## 9. Documentation and examples

Documentation is a deliverable of every feature, written in Org as the work proceeds.

- `README.org`: succinct and user-facing, in the Compact Guide style. No implementation details, no version history.
- `manual/*.org`: the Info manuals (section 8), one file per chapter.
- `examples/*.org`: a runnable example per chapter and a few whole-workflow files (a weekly review, a project with clocking, a literate Babel notebook in Lisp and JavaScript, a table with formulas, an export sample). Opening the app for the first time offers them as sample documents.
- `CHANGELOG.org`: one paragraph per release saying what changed for the user and why, plus an optional one-line "Verified". No test counts or process notes.
- `ROADMAP.org`: only planned work; leftovers from reviews go under a matching section; items we would never do are removed.
- `SPEC.org`: this specification, kept current as decisions are made.
- Settings and config: a documented example config file in Org syntax; a test checks that every setting in the app appears in it and in the manual.

A documentation test checks that every key and command in the app is described in the manual, and that every example file loads, parses and, for Babel blocks, evaluates to the result its text claims.

## 10. Architecture and native shells

Three layers, each calling only the one below it.

1. **Core (pure JavaScript, no DOM, no platform calls).** Org parser and serializer, document model with undo, timestamp and repeater engine, table and formula engine, list and checkbox logic, tag and property search, agenda builder, capture and refile and archive, clock engine, Babel (header arguments, result insertion, tangle planning), Lisp interpreter, export engine, Info compiler. Every function takes text or a document and returns text or a document, so it runs unchanged in the browser, a worker, Node tests and the native shells.
2. **Interface layer (the app interface).** One small contract the core and the UI use for everything that touches the world: storage (read, write, list, watch), clock and time zone, notifications, link opening, clipboard, file picking, and Babel workers. Each platform supplies an implementation: browser (IndexedDB, File System Access where present, Notification API), Android shell, iOS shell. A capability the platform lacks is reported by the interface, and the UI shows it as unavailable. No code path imitates a missing capability.
3. **UI.** Outline, Text, Emacs-keys and Agenda views, the command palette, the minibuffer, the Info reader, settings. Views are layers over the one document model; a new view never re-derives folding, selection or undo.

**Rules**

- One implementation per capability. Commands are registered once and reached from the touch UI, the palette and the key map.
- No module-level mutable state; state lives in explicit state objects passed in.
- Plain ES modules, no build step required to run, a build only for the manuals and the release zip. Types by JSDoc checked in CI.
- Every module is listed in the service worker precache; a test fails when one is missing.
- Large documents stay responsive: windowed rendering for long agendas and outlines, incremental reparse on edit.

**Native shells.** Android (Kotlin, WebView hosting the same bundle) and iOS (Swift, WKWebView) provide the interface layer's native implementations: real folders and files, background notifications and appointment reminders, OS link handlers for mailto and other schemes, file-name completion, tangle and detangle on disk, share targets for capture. Shells carry no Org logic. A native build is versioned and zipped separately from the web build, with the version in the file name.

## 11. Testing and verification

Emacs is used only as a black-box oracle: a program run on the maintainer's machine that answers questions, never a source of code or text. The version used so far is GNU Emacs 30.1; each result file records the exact Emacs and Org versions.

**Conformance corpus (separate repository, data only)**

1. A question is a small input file plus a key sequence, kept in a case file. Cases contain inputs only and are written by us.
2. A harness script uses only documented interfaces (batch mode, buffers, key macros, text properties) to run each case and record the resulting text, visible lines, cursor position and error state as JSON. Message text is not recorded, except all-caps state words.
3. Results are facts about behavior. They never enter the main repository, are never imported by it, and implementers do not read them while writing a module. After a module exists, a comparer reports mismatches; each is fixed from the guide and this spec.
4. No Emacs binary, Lisp file or generated fixture of expressive text is committed.

**Tests in the main repository (all original)**

1. Examples from the guide's own text and this spec, written as input, command, expected output.
2. Round-trip and property tests: parse then serialize returns the input for every valid Org text; structure commands preserve what they should; undo restores exactly.
3. Metamorphic tests: for example, promoting then demoting a subtree is the identity, and sorting twice equals sorting once.
4. Cross-checks between independent paths in our own code, such as the table formula engine against the Lisp interpreter running the same formula.
5. Example-file tests: every example in the manual loads and its Babel blocks evaluate to the results shown.
6. Browser smoke tests for each mode on phone and desktop viewports, by name per feature.
7. Hygiene tests: no module-level mutable state, no new `any` types, every module precached, every key and setting documented, license check, a script that rejects code matching a deny-list of known GPL identifiers.

**Conformance corpus (optional, separate)**

If the decision allows it, a separate repository holds input and expected-output pairs observed by running Emacs as a black box, stored as data with no code from Emacs. It is never imported by the main repository's code, never read by implementers while writing a module, and used only afterward to report mismatches, which are fixed from the guide and the spec rather than from Emacs's source.

**Process**

- Run only the tests related to a change, by name, and say which; CI runs the whole suite.
- A release gate runs the full suite in several time zones, type checks, lint and the license check, then builds the zip. A single unrelated flaky test is rerun alone, not the whole gate.
- Date and time code is tested in at least three time zones and across DST changes.

## 12. Milestones

Phases run in this order. A phase is done when its gate holds, and each phase ends with a release that has a new version number.

1. **Foundations.** Repository, MIT license, CI with the license and provenance checks, core parser and serializer that round-trips, document model with undo, app interface with the browser implementation and the local, GitHub and WebDAV storage providers, PWA shell with service worker. *Gate: the example corpus round-trips and the app installs and works offline.*
2. **Outline editing.** Headlines, visibility cycling, motion, structure editing, sparse trees, plain lists, TODO items, tags, properties; Outline and Text modes; command palette. *Gate: each chapter's definition of done.*
3. **Info reader and manuals.** Org-to-Info build, the reader with its keys and search, context help, and the first manuals. From here every chapter ships with its manual page. *Gate: every command so far is documented and reachable from help.*
4. **Dates, capture and agenda.** Timestamps, repeaters, deadlines, scheduling, clocking, effort, capture, refile, archive, agenda views, marks and filters. *Gate: the example weekly-review file works end to end.*
5. **Tables, links and markup.** Table editing and formulas, hyperlinks, emphasis, blocks, footnotes, entities. *Gate: table formulas pass the guide's examples.*
6. **Babel.** Header arguments and results, JavaScript in workers, the Lisp interpreter, noweb, tangle planning. *Gate: the literate example notebook runs in both languages.*
7. **Export.** In this order: HTML, Slides, ASCII; then iCalendar and vCard export, and iCalendar and vCard import (13.6); options and include files. *Gate: the export sample file produces every format.*
8. **Emacs-keys mode.** The guide's bindings, prefix keys, universal argument, minibuffer, Agenda keys, edit-special, completion. *Gate: every key in the guide is bound or listed with a reason.*
9. **Native shells.** Android first, iOS next: folders and files, notifications, link handlers, tangle to disk. *Gate: the shell passes the same interface contract tests as the browser implementation.*
10. **Hardening.** Accessibility audit, large-document performance, security review, final documentation pass. *Gate: no open item in the roadmap that the guide requires.*

## 13. Capabilities required by the author's configuration

The author's real configuration (Appendix A) must run in emacs-org. The code itself may not be reusable, but every capability below has to exist. Behavior is taken from these files and from the public documentation of the named features, never from their source.

### 13.1 Config files, storage names, trust

- **Init file.** A Lisp file evaluated at startup and on demand. `;` starts a comment. `load` runs another file. An error names the file and line and startup continues with the rest.
- **Storage names.** A file name may start with a provider and a colon, such as `github:home.org` or `local:notes.org`. Every place that takes a file accepts one: `load`, agenda files, contacts files, refile targets, capture targets, the diary file. Providers: local app storage, a GitHub repository (token in the platform secure store, branch, offline cache, one commit per save, a three-way prompt on conflict), and WebDAV (URL and credentials in the secure store, offline cache, the same conflict prompt). All three ship in the first release.
- **Trust.** Init and loaded Lisp is code. A file runs only when listed as trusted by provider path and content hash; a changed remote file asks again. Nothing loaded from a document runs unasked.
- **Setting values.** `setq` with several pairs, `add-to-list`, numbers (negative and decimal), strings with emoji, `t`, `nil`, symbols, quoted lists, and alists with dotted pairs. A setting the app does not know is kept for extensions and shown in a report, not dropped.

### 13.2 Settings that must work

| Setting | Effect |
| --- | --- |
| org-agenda-files, org-contacts-files | The agenda files and the contacts files |
| org-refile-targets | List of entries: a file list or a symbol naming one, or nil for the current file, each with a maximum level |
| org-agenda-include-diary, diary-file | Diary entries appear in the agenda (13.5) |
| org-capture-templates | The templates (13.3), added with add-to-list |
| org-babel-load-languages | Which languages Babel may run: emacs-lisp and js |
| org-log-done | `'time` records a closing time |
| org-cycle-open-archived-trees | Cycling opens archived subtrees |
| org-startup-truncated, org-startup-indented, org-startup-with-inline-images | Line wrapping, indentation, inline images |
| org-use-sub-superscripts | `'{}` means only the braced form makes a sub or superscript |
| org-tags-column | Where tags sit; 0 puts them right after the title |
| calendar-latitude, calendar-longitude | Place for solar times and weather |
| calendar-time-display-form, display-time-mode, display-time-format | How times show; a clock in the top bar |
| display-line-numbers-mode | Line numbers in the Text view |
| holiday-general-holidays, holiday-christian-holidays, holiday-hebrew-holidays, holiday-islamic-holidays, holiday-bahai-holidays, holiday-oriental-holidays, holiday-solar-holidays, holiday-local-holidays | Which holidays show; nil turns a category off (13.5) |
| org-weather-format, org-weather-refresh-interval | Weather line in the agenda (13.5) |
| org-xx-\* | The app's own settings: extra menu, menu aliases, table indentation, extensions on or off, photos shown at startup |

### 13.3 Capture

**Templates.** Each has a key, a description, a type, a target, a template string and options.

1. **Types:** `entry` (a heading), `item` (a list item), `checkitem` (a list item with a checkbox), `table-line` (a row), `plain` (text as written).
2. **Targets:** `file+headline`, `file+olp` (an outline path), `file+function` (a Lisp function that moves point), and `file`. A missing heading or path is created, newest first when the template says `:prepend`.
3. **Options:** `:prepend`, `:empty-lines`, `:prepare-finalize` (a function run on the captured text before it is filed). Also `:immediate-finish` and `:clock-in` from the guide.
4. **Escapes:** `%^{Prompt}` asks a question (a default and a choice list may follow after `|`), `%\\1` and `%\\2` repeat the first and second answers, `%^T` asks for an active timestamp, `%<format>` inserts the current time with a strftime-style format, `%U` and `%T` insert a stamp, `%a` links back to where capture began, `%i` inserts the selected text, `%?` leaves the caret there, `%%` is a percent sign.
5. **Filing:** an entry goes under the target heading; an item or checkitem joins the list there (first or last by `:prepend`); a table-line adds a row to the table at the target, creating it first when absent; plain inserts where the function left point.
6. Blank answers are allowed. A `:prepare-finalize` function can then drop the empty fields (Appendix A does this for a vCard).

**Menu.** The capture templates appear in the app's extra menu as the config lists them. An entry is `key;label`: the key is a template key, a quoted view name such as `'calendar`, or an outline path whose parts may use `%<format>` and which means "go to that heading". `-----` is a separator. Another list renames built-in menu entries (`more:Export;label`). Labels may hold emoji.

### 13.4 Lisp text and buffer functions

The capture target and prepare functions in Appendix A run against the target document as a buffer. The Lisp interpreter therefore provides, with Emacs semantics:

- **Position:** `point`, `point-min`, `point-max`, `goto-char`, `forward-line`, `beginning-of-line`, `end-of-line`, `line-end-position`, `bolp`, `eolp`, `bobp`, `eobp`, `save-excursion`.
- **Text:** `insert`, `delete-region`, `buffer-substring`, `flush-lines`, `keep-lines`, `replace-match`.
- **Search:** `re-search-forward`, `re-search-backward` (bound and no-error arguments), `search-forward`, `looking-at`, `match-beginning`, `match-end`, `match-string`, `regexp-quote`.
- **Regexp syntax:** Emacs's own, including `\\(...\\)`, shy groups `\\(?:...\\)`, `\\|`, intervals `\\{n\\}` and `\\{n,m\\}`, character classes such as `[[:alnum:]]`, and Unicode text.
- **Other:** `format` (`%s`, `%d`, `%%`), `format-time-string` (`%Y %m %d %H %M %b %a` and the rest of the usual set), `make-string`, `defun` with a docstring and `&optional`, `let`, `let*`, `dolist`, `unless`, `when`, `1+`, comparison and arithmetic, `list`, `add-to-list`, `holiday-fixed` and the other holiday forms.

### 13.5 Calendar, holidays, diary, contacts, weather, plots, images

- **Holidays.** Categories general, christian, hebrew, islamic, bahai, oriental, solar and local, each switched on or off by its setting. `holiday-local-holidays` is a list of forms such as `(holiday-fixed 3 14 "Pi Day")`; `holiday-float` and `holiday-sexp` style forms are supported too. Holidays show on the agenda day and in a calendar view. Rules are computed offline; the Hebrew, Islamic, Bahá'í and Chinese calendars need their date conversions; solar entries use latitude and longitude.
- **Diary.** `diary-file` names a file, in any provider. Its entries appear in the agenda when `org-agenda-include-diary` is on. The full set of diary entry forms is supported: date-first lines in the usual date styles, weekday and monthly repeats, anniversaries, blocks of days, and the diary expression family (including the calendar-specific ones for the Hebrew, Islamic, Bahá'í and Chinese calendars). The manual lists each form with an example.
- **Contacts.** A contacts file holds one heading per person with properties (email, phone, birthday and others). The app lists, searches and completes contacts and shows birthdays in the agenda.
- **Weather.** `org-weather-format` shapes a weather line from a network provider, for the configured place, refreshed on the configured interval. The placeholders in Appendix A (icon, current, minimum and maximum temperature and unit, precipitation, humidity, wind, air pressure and their units) must all work. Offline it shows nothing and invents nothing. The provider is an open decision.
- **Plots.** `#+PLOT:` above a table (title, independent column, dependent columns, `with:points`, tick count) draws a chart with the app's own renderer. There is no gnuplot.
- **Inline images and photos.** Image links display inline at startup when the setting is on; a separate setting shows photos linked from entries.
- **Table formulas.** `#+TBLFM:` with several formulas joined by `::`, row references such as `@#-1`, column references, and Calc-style functions `if`, `round`, `trunc` and the arithmetic around them (Appendix A's tracking table).
- **Behavior without a native shell.** Anything here that needs the network, notifications or disk comes through the app interface (section 10); where the web build lacks it, the UI says so.

### 13.6 Calendar and contact exchange (added 2026-11-21)

The app exports calendars as `.ics` and contacts as `.vcf`, and imports both. The author's description of the contact format, taken as the requirement (modeled on org-vcard and compatible with org-contacts.el; no code from either):

- vCard 3.0, readable by any contacts app. RFC 6350 requires only FN, so an email address is not needed.
- Two export styles; **Tree is the default**.
- **Flat:** every heading with at least one recognized contact property exports: `:EMAIL:`, `:PHONE:`, `:CELL:`, `:WORK_PHONE:`, `:ADDRESS:`, `:ADR:`, `:NICKNAME:`, `:NOTE:`, `:ANNIVERSARY:` or the birthday property. `:IGNORE: t` excludes a heading. A heading with none of them is skipped.
- **Tree:** a contact heading (`:KIND: individual`, `:FIELDTYPE: name`) with each field as a descendant heading carrying its own `:FIELDTYPE:`, at any depth. A contact with no fields still exports a minimal vCard (FN and N).
- Import turns `.vcf` and `.ics` files into Org text in the chosen style, into a chosen file and heading.

Open until the contacts work package starts: the birthday property's name; the full set of `:FIELDTYPE:` values and how each maps to a vCard property; how import chooses between styles; how `.ics` import maps VEVENT and VTODO to headings and timestamps; how repeats and time zones map. These are asked of the author then; nothing is guessed.

The capture template for vCard in Appendix A writes raw vCard lines under a heading. That is a third shape; whether it imports as a contact is part of the open list above.

## 14. Open decisions

Every open item had an answer by 2026-11-21.

**Decided**

| Decision | Answer |
| --- | --- |
| Reference guide | The online Compact Guide as of 2026-11-21 |
| Code license | MIT |
| Emacs as a black box for a conformance corpus | Yes, under SPEC 11: separate data-only repository, documented interfaces only, results never read while writing a module |
| Public name | Serita, with the subtitle: reads and writes Org files |
| Manual structure | The guide's chapter order only; all prose original |
| Contacts, weather, plots, calendar and holidays | Part of the product, each documented as an extension |
| Sharing code with org-pwa | No; clean break, new code only |
| Weather provider | Open-Meteo, after checking its current terms |
| GitHub conflicts | Three-way prompt (keep mine, keep theirs, merge); one commit per save; token in the platform secure store |
| Clean-room firewall | The described process plus the provenance log |
| Native OS support | Current and previous major version of Android and iOS |

**Decided later the same day**

| Decision | Answer |
| --- | --- |
| Lisp functions beyond sections 7 and 13.4 | Add only what the guide, an example or the author's configuration requires |
| Publishing, column view, the full Org manual | Out until the guide's chapters are done; revisit after phase 10 |
| Sync beyond local files and GitHub | WebDAV is in the first release, specified and built beside the GitHub provider |
| Diary entry forms | The full diary sexp set, not only date-first lines and anniversaries |
| Calendar algorithms | Published astronomical and calendrical algorithms, cited in the provenance log, never Emacs's calendar library |
| Alternate init format | None; the plain Lisp file only |

**Decided 2026-11-21 (afternoon)**

| Decision | Answer |
| --- | --- |
| Interface layer: `secrets` and `http` | Not separate groups; folded into the providers |
| GitHub repository selection | One setting per provider (owner/repo, branch); token in the secure store; `github:` means that repository |
| Parser, undo, tooling | Lossless line-based tree; immutable state with inverse patches; `node:test`; JSDoc types checked by `tsc` |
| Phase 1 scope | As in PROPOSAL-phase1.md |
| Export formats and order | HTML first, Slides (Beamer-like) second, ASCII third; iCalendar and vCard export plus import added (13.6) |
| Markdown and OpenDocument export | Not in the plan (not in the guide) |
| Tokens and passwords | Native apps: Keychain (iOS) and Keystore (Android). Browser: the browser's own storage on this device, stated plainly on the setup screen |
| Saving | Manual Save; no autosave. The save button saves the current tab; the file menu has "Save some buffers" for the others |
| Settings export | Settings panel has Export and Import. The export is an Org file, downloaded through the browser; import reads a local file only (no storage provider). Secrets (tokens, passwords) are included, optionally encrypted with a passphrase; without a passphrase they are written in plain text and the dialog says so. A passphrase is never required. Import replaces all settings on the device; a wrong or missing passphrase stops the import and changes nothing. The Export and Import buttons sit in a "Settings file" row at the bottom of the Settings panel. The file is named `serita-settings-YYYY-MM-DD.org`. Encryption uses Web Crypto: PBKDF2 (SHA-256) to derive the key, AES-GCM to encrypt |
| Top bar and floating buttons | The top bar has three groups: Files and Save at the left, Find in the middle, View and Menu at the right. Buttons added later go into the gaps, so none move. View switches between the views of §5. The floating buttons are a layer driven by a list of actions: a back arrow for navigation history, and the extras menu, whose entries come from the config's Menu list (capture templates, quoted view names, outline paths, separators; §13). Both arrive with links and capture; the layer is built so they can be added without changing the screen |
| Labels | Sentence case everywhere: "Save as", "Save some buffers", "Settings file" |
| Device files | A fourth storage, `device`, for files the user picks with the browser's file picker (Open and Save as, under Change). The handle of each picked file is kept so Save writes back in place; a file's version is its last-modified time. App storage is the old Local, renamed so the name says what it is. A file on the device is never deleted from the app. Deviations from Emacs: only picked files are reachable, and permission is asked again after a restart |
| Updates | A new version waits; it never replaces the running one by itself. The message line says it is ready, Menu shows Restart to update with both version numbers, and Settings shows Installed version and New version. Restart applies it and reloads. The app looks for updates when it becomes visible and when it comes online. Deviation from Emacs: none to match; Emacs has no installed-version swap |
| Views and folding | Outline and Text are layers over one document and one fold state (`core/outline.js`); neither keeps folding of its own. A fold is `all` (hides everything under a heading) or `body` (hides its own text, keeps sub-headings). TAB on a heading cycles folded, children, subtree (children shows the heading's text and its sub-headings, folded; a state that looks the same as the one before is skipped); S-TAB cycles overview, contents, show all. Text before the first heading stays visible. `#+STARTUP:` (overview, content, showall, showeverything, show2levels to show5levels) sets the folds when a file opens; without it everything is shown, as the guide says. The Text view shows folded lines left out and `...` after the heading, and edits map back to the real text; an edit touching the `...` opens that fold first. Find searches the whole text and opens the folds that hide a match; cancelling the search (✕) closes them again, and accepting it (Return) leaves them open (what Emacs does on accept is still to be checked). Deviations from Emacs: taps replace keys in the Outline view; Find from the Outline view switches to the Text view |
| Heading actions | Tapping a heading's title opens a sheet: Change TODO state (the sequence the heading is in, from `#+TODO`), Promote and Demote (the heading), Promote subtree and Demote subtree, Move up, Move down, Insert heading below (after the subtree), Set tags (aligned so the line ends at column 77), Edit title. Edit title and Insert heading below open a popup with one text field holding only the title (the stars, TODO word, priority and tags stay); Enter accepts, a title is one line. Tapping a TODO word changes its state. Buttons for footnote, timer and timestamp insert come with those features (dates and markup phases). Deviation from Emacs: the popup replaces editing the headline in place |
| Checkboxes and list items | Tapping a checkbox, or C-c C-c on its line, toggles it ([ ] and [-] become [X], [X] becomes [ ]). The checkbox of each item above it becomes [ ], [-] or [X] by how many of its sub-item checkboxes are checked, and the first cookie ([n/m] or [n%]) of each such item and of the heading is rewritten; a heading's cookie counts the checkboxes of its top-level items. A list item owns the more deeply indented lines under it, and folds like a heading (TAB, or its arrow in the Outline view). M-up and M-down move an item with its sub-items past its neighbor and keep ordered numbers in order; M-left and M-right change its indentation and leave its sub-items; with Shift, the sub-items move too. Statistics cookies on a heading that count TODO sub-headings are not updated yet. To check against Emacs: the heading's cookie rule |
| Emacs keys and key row | A setting, off by default, so a keyboard's own keys are not taken over until you ask. On, the Text view answers TAB, S-TAB, M-up, M-down, M-left, M-right, M-S-left, M-S-right, C-RET, C-c C-t and C-c C-c; the C-c prefix is typed with Ctrl on the key row and then c (a keyboard's own C-c still copies; god-mode may replace this later); a pending prefix shows in the message line (`C-c-`) and C-g quits it. The key row (Meta, Ctrl, Shift, Tab, arrows, then keyboard and Float) sits above the mode line and scrolls sideways; Meta, Ctrl and Shift apply to the next key only; its buttons never take focus, so they never open the on-screen keyboard; the keyboard button shows or hides the keyboard; Float makes the row a panel that can be dragged, and Dock puts it back. Settings also has Hide leading stars (off by default, as in Emacs): all but the last star of a heading are shown as spaces. Deviation from Emacs: the key row exists only because phones lack Ctrl and Meta; TAB and the M-arrows on a line that is neither a heading nor a list item do nothing yet |
| Appearance | Settings screen: Theme System/Light/Dark (default System, follows the device); Font monospace (default), sans-serif, serif, system, or a device font name, applied to the Text and Outline views; Font size 12 to 32, default 18, shared with A−/A+; Paragraph spacing 0 to 32 px, default 10, Outline view only. Menus, tabs and buttons stay fixed. Colors are not customizable yet. |
| Tag column | Setting `org.tagsColumn`, default -77. Negative N: the line ends at column |N|; positive N: tags start at column N; 0: one space after the title; always at least one space. Verified against the oracle. |
| Session restore | Open files, current tab, folds, view and cursor are kept in local storage; unsaved edits and scratch text are kept as drafts. Setting `session.restore`, default on. A file that cannot be read is skipped and reported. Not an Emacs feature. |
| Heading swipe | A right-to-left swipe (over 60 px, mostly horizontal) on an Outline heading acts as TAB and shares its remembered state. Deviation: Emacs has no touch input. |
| Tool row | One row under the tabs (never moves the top bar): Undo, Redo, Line numbers, Wrap lines, Smaller text, Larger text, Lines and text. The Outline view keeps Undo, Redo and the two size buttons. Undo history is kept per buffer in the session: typing within one second is one step, every structure edit is a step, redo is dropped by a new edit, fold changes are not steps. Line numbers are the real line numbers, drawn by a layer behind the text that lays out like the editor, so wrapped lines work. Text size is 10 to 28 px in steps of 1, saved as a setting. Lines and text: Go to line, Select all, Copy all, Duplicate line, Delete line (kill-whole-line, into the kill ring and the clipboard), Move line up/down, Indent, Outdent (two spaces). Deviations: Copy all, Duplicate, Move line, Indent and Outdent on a plain line have no default Emacs command; the size step is ours. |
| M-RET and the TAB cycle | M-RET starts a heading at the level of the heading it is in: at the start of a heading line the new heading goes above; at the start of another line that line becomes a heading; elsewhere the line breaks at the cursor and the rest becomes the heading. The TAB cycle remembers the state it left a heading in while TAB is pressed again on it, so folded, children and subtree are three presses even when children and subtree look alike; with no sub-headings the children state is skipped. |
| Menus and prompts | Every menu, list and dialog is a panel that rises from the bottom over a dimmed screen, opaque, with rounded corners, closed by Cancel, a tap outside it or Escape; on wide screens it is centered at the bottom, at most 560 px wide. One panel implementation serves them all, including the extras menu later. One-line prompts (Find, and later query-replace and the minibuffer) are a row at the bottom above the message line, not panels |
| Find (plain search) | Incremental search, like Emacs's: case is ignored unless the query has an uppercase letter; up and down chevrons search backward and forward from the current match and wrap with the message "Wrapped"; a failed search says "Failing I-search: ..."; Return ends the search on the match; the x button cancels and returns to where the search began. Deviations: only the current match is highlighted; the match is selected, so the cursor sits at one end of it; no word, symbol or regexp modes until the Emacs regexp matcher exists Deviation: when a search is accepted, the folds around the match are opened; Emacs leaves some of them closed, depending on the earlier matches made while typing. Revisit later. |
| File menu (folder button) | New (a new buffer named *scratch*), Open (an existing file from local storage, GitHub or WebDAV), Save (to the existing file), Save as (the current buffer to another storage and/or name), Save some buffers |

Open: whether LaTeX export (a guide chapter) stays after the three; what format Slides produces; whether the guide's Introduction chapter is documentation only.

## Appendix A. The author's configuration files (verbatim)

These files are the acceptance test for section 13: with them loaded, the app must show the same menu, capture into the same targets, and display the same agenda extras. They are the author's own and are reproduced here as requirements, not as code to reuse.

### A.1 init.el

```lisp
; ==========================================
; 2026-11-09 - load global.el              =
; 2026-11-08 - load holidays and templates =
; 2026-11-06 - initial version             =
; ==========================================

; Global variables
(load "github:org/globals.el")

; Agenda
(setq org-agenda-files '("github:home.org" "github:journal.org" "github:calendar.org"))

; Contacts
(setq org-contacts-files '("github:contacts.org"))

; Refile targets
(setq org-refile-targets '((org-agenda-files :maxlevel . 2) (nil :maxlevel . 3)))

; Diary
(setq org-agenda-include-diary t diary-file "github:diary")

; Holidays
(load "github:org/holidays.el")

; Capture templates
(load "github:org/templates.el")

; Weather
(setq org-weather-format "Weather: %icon, %tcur (%tmin-%tmax) %tu, %p%pu, %h%hu, %s%su (%a%au)")
```

### A.2 org/globals.el

```lisp
; =========================
; Global variables        =
; Last update: 2026-11-09 =
;==========================

(setq calendar-time-display-form '(24-hours ":" minutes)
      display-line-numbers-mode nil
      display-time-format "%H:%M"
      display-time-mode t
      org-babel-load-languages '((emacs-lisp . t) (js . t))
      org-cycle-open-archived-trees t
      org-log-done 'time
      org-startup-truncated nil
      org-startup-with-inline-images t
      org-use-sub-superscripts '{}
      org-weather-refresh-interval 2
      org-tags-column 0
      calendar-latitude 35.994        ; Durham, NC
      calendar-longitude -78.8986
      org-startup-indented t
      org-xx-indent-tables t
      org-xx-extensions 'on
      org-xx-startup-with-show-photos t)

(setq org-xx-extra-menu
      '("a;📅 Appointment"
        "j;📔 Journal"
        "c;✅ Checklist"
        "-----"
        "t;⭐ Tracking"
        "[\"🛍️ Bag - lists and notes\", \"❤️ Health\", \"🏩 Tracking\", \"%<%Y-%m>\"];👁 Current"
        "-----"
        "'calendar;🗓️ Calendar"
        "v;📇 vCard"))

(setq org-xx-menu-aliases
      '("more:Commands;💲Commands"
        "more:Export;📤 Export"
        "more:Import;📥 Import"
        "more:Settings;⚙️ Settings"))
```

### A.3 org/holidays.el

```lisp
; ===========================
; Holidays                  =
; Last modified: 2026-11-08 =
;============================

; Holidays - enable ones you want
(setq ;holiday-general-holidays nil
      ;holiday-christian-holidays nil
      holiday-hebrew-holidays nil
      holiday-islamic-holidays nil
      holiday-bahai-holidays nil
      holiday-oriental-holidays nil
      ;holiday-solar-holidays nil
      )

; Holidays that are not in above, yet!
(setq holiday-local-holidays
      '((holiday-fixed 3 14 "Pi Day")
        (holiday-fixed 6 19 "Juneteenth")))
```

### A.4 org/templates.el

```lisp
;============================
; Capture templates         =
; Last modified: 2026-11-09 =
;============================


; Appointment
(defun my-year-heading ()
  "Find or create the heading of this year and leave point on it."
  (let ((year (format-time-string "%Y")))
    (goto-char (point-min))
    (unless (re-search-forward (format "^\\* %s\\(?: .*\\)?$" (regexp-quote year)) nil t)
      (goto-char (point-max))
      (unless (bolp) (insert "\n"))
      (insert "* " year "\n")
      (forward-line -1))
    (beginning-of-line)))

(add-to-list 'org-capture-templates
  '("a" "Appointment" entry (file+function "calendar.org" my-year-heading)
    "* %^{Description} %^T\n%?"))
; ========


; VCARD
(defun my-vcard-drop-empty ()
  "Drop the empty fields of a captured vCard, and an empty trailing tag."
  (goto-char (point-min))
  (when (re-search-forward "[ \t]+:+[ \t]*$" (line-end-position) t)
    (replace-match ""))
  (goto-char (point-min))
  (flush-lines "^[A-Za-z][A-Za-z0-9_-]*\\(;[^:\n]*\\)?:[; \t]*$"))

(add-to-list 'org-capture-templates
  '("v" "vCard Contact" entry (file+olp "github:contacts.org" "New")
    "* %^{First Name} %^{Last Name} :%^{Category/Tag}:\nBEGIN:VCARD\nVERSION:3.0\nFN:%\\1 %\\2\nN:%\\2;%\\1;;;\nEMAIL:%^{Email}\nTEL;TYPE=voice:%^{Phone Number}\nTEL;TYPE=cell:%^{Mobile Number}\nADR;TYPE=home:;;%^{Street};%^{City};%^{State};%^{Postal Code};%^{Country}\nBDAY:%^{Birthday (YYYY-MM-DD)}\nNOTE:%^{Note}\nORG:%^{Company/Organization}\nTITLE:%^{Job Title}\nEND:VCARD\n\n%?"
    :prepare-finalize my-vcard-drop-empty))
; ========

; Journal/Journal-checkitem
(defun my-olp-target (names)
  "Find or create the outline path NAMES in the file and leave point on its last heading.
A heading that has to be created goes first among its siblings (newest on top) when the template says :prepend, else last."
  (let ((level 1) (start (point-min)) (end (point-max)) (prepend t))
    (dolist (name names)
      (goto-char start)
      (if (re-search-forward (format "^\\*\\{%d\\} \\(?:[A-Z]+ \\)?\\(?:\\[#[A-Z0-9]\\] \\)?%s\\(?: +\\[[0-9/%%]*\\]\\)?\\(?:[ \t]+:[[:alnum:]_@#%%:]+:\\)?[ \t]*$" level (regexp-quote name)) end t)
          (setq start (1+ (match-end 0)))
        (goto-char start)
        (goto-char (if (and prepend (re-search-forward "^\\*+ " end t)) (match-beginning 0) end))
        (unless (bolp) (insert "\n"))
        (insert (make-string level ?*) " " name "\n")
        (setq start (point)))
      (goto-char start)
      (setq end (if (re-search-forward (format "^\\*\\{1,%d\\} " level) nil t) (match-beginning 0) (point-max)))
      (setq level (1+ level)))
    (goto-char start) (forward-line -1) (beginning-of-line)))

(defun my-journal-target ()
  "The day of today in the month of today in the journal."
  (my-olp-target (list "📔 Journal - journal and diary"
                       (format-time-string "%Y-%m %b")
                       (format-time-string "%Y-%m-%d"))))

(add-to-list 'org-capture-templates
  '("j" "Journal" item (file+function "github:home.org" my-journal-target) "%<%H:%M> - %?" :prepend nil))
(add-to-list 'org-capture-templates
  '("c" "Journal check item" checkitem (file+function "github:home.org" my-journal-target) "%?" :prepend nil))
; ========


; Tracking
(defun my-tracking-target ()
  "Find or create Bag > Health > Tracking > this month and leave point on that heading.
A new heading goes first among its siblings; a new month also gets the plot, the table and its formulas."
  (let ((level 1) (start (point-min)) (end (point-max)))
    (dolist (name (list "🛍️ Bag - lists and notes" "❤️ Health" "🏩 Tracking" (format-time-string "%Y-%m")))
      (goto-char start)
      (if (re-search-forward (format "^\\*\\{%d\\} %s[ \t]*$" level (regexp-quote name)) end t)
          (setq start (1+ (match-end 0)))
        (goto-char start)
        (goto-char (if (re-search-forward "^\\*+ " end t) (match-beginning 0) end))
        (unless (bolp) (insert "\n"))
        (insert (make-string level ?*) " " name "\n")
        (when (= level 4)
          (insert "#+PLOT: title:\"Tracking\" ind:4 deps:1 with:points ticks:6\n|   |\n|---|\n"
                  "#+TBLFM: $1=@#-1 :: $4=if(round(trunc($3/100) + 100*($3/100 - trunc($3/100)) / 60) == 24, 0, round(trunc($3/100) + 100*($3/100 - trunc($3/100)) / 60))\n"))
        (setq start (save-excursion (re-search-backward (format "^\\*\\{%d\\} " level)) (forward-line 1) (point))))
      (goto-char start)
      (setq end (if (re-search-forward (format "^\\*\\{1,%d\\} " level) nil t) (match-beginning 0) (point-max)))
      (setq level (1+ level)))
    (goto-char start) (forward-line -1) (beginning-of-line)))

(add-to-list 'org-capture-templates
  '("t" "Tracking" table-line (file+function "github:home.org" my-tracking-target)
     "| | %<%Y-%m-%d> | %<%H%M> ||"))
; ========


(add-to-list 'org-capture-templates
  '("m" "Meeting" plain (file+olp "github:home.org" "📥 Inbox - unprocessed" "Meeting Notes")
     "* %^{Meeting Title} :meeting:\n:PROPERTIES:\n:CREATED: %U\n:END:\n** Attendees\n- %?\n** Notes\n- \n** Action Items\n*** TODO [#A] %^{Top Priority Task}"
     :prepend t))

(add-to-list 'org-capture-templates
  '("w" "Web page or text" plain (file+headline "github:home.org" "📥 Inbox - unprocessed")
    "* %a%^{Title (leave blank for a web page)}\n:PROPERTIES:\n:CREATED: %U\n:END:\n  %i\n  %?"
    :empty-lines 1))
```
