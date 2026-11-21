# Phase 1 proposal: repository layout and interface layer (for approval, no code yet)

Date: 2026-11-21. Written from SPEC.md sections 3, 4, 10, 11, 12 and 13.1 only.

## 1. Repository layout

    serita/
      LICENSE                MIT
      CONTRIBUTING.md        DCO sign-off, clean-room rules (spec section 3)
      README.org  CHANGELOG.org  ROADMAP.org  SPEC.org
      PROVENANCE.md  GUIDE-NODES.org
      core/                  pure JS, no DOM, no platform calls
        parse.js             text -> document tree (lossless)
        serialize.js         document tree -> text
        document.js          document state object, edits, undo/redo
        names.js             "provider:path" storage-name parsing
      app/
        interface/
          contract.js        the app interface (JSDoc typedefs, error type)
          browser.js         browser implementation
          memory.js          in-memory implementation for tests
        storage/
          local.js           IndexedDB provider
          github.js          GitHub provider
          webdav.js          WebDAV provider
          conflict.js        three-way merge helper
        ui/                  PWA shell only in phase 1 (list, open, edit raw text)
        sw.js  manifest.webmanifest  index.html
      shells/android/  shells/ios/    empty until phase 9
      manual/  examples/              empty until phase 3 / first chapter
      test/                  node:test files, one per module
      tools/                 license-check, provenance-check, gpl-denylist, precache-check
      .github/workflows/     CI

## 2. Choices needing your approval

1. **Tests:** Node's built-in `node:test`, no dependencies. Types by JSDoc checked with `tsc --checkJs` (TypeScript as a dev tool only, MIT/Apache).
2. **Parser shape:** a lossless line-based tree. Every node keeps its original text, so parse then serialize returns the input exactly, including odd spacing. Structure (headings, lists, tables, drawers, blocks, keywords) is layered on top. Later chapters add recognizers; none rewrite text on parse.
3. **Undo:** document state is an immutable value; each edit returns a new state plus an inverse patch. Undo and redo are shared by all views.
4. **Phase-1 UI:** minimal: file list, open a document, edit as plain text, save, conflict dialog, install and offline. Any layout or control gets a mockup for approval before it is built (your standing rule).
5. **GitHub repo selection:** init files say `github:home.org` with no repository. I propose one settings entry per provider (owner/repo, branch) stored in app settings, with the token in the secure store. `github:` always means that configured repository.
6. **Tooling:** no bundler. Plain ES modules; a Node script only builds the manuals (phase 3) and the release zip.

## 3. The interface layer

One object, passed explicitly into the core and UI (no module-level state). Every method is async unless noted. A capability the platform lacks is reported by `capabilities()` and, if called anyway, throws `CapabilityUnavailable` with a code and a plain-language reason. There is no fallback path.

| Group | Methods | Notes |
| --- | --- | --- |
| capabilities | `capabilities()` returns `{ name: { available, reason? } }` | The UI reads this to grey out or explain |
| storage | `read(name)` returns `{ text, version }`; `write(name, text, { baseVersion })` returns `{ ok, version }` or `{ ok:false, conflict:{ theirs, theirsVersion } }`; `list(prefix)`; `remove(name)`; `watch(name, cb)` returns unsubscribe; `providers()` | `name` is `provider:path` or a bare local path. Offline cache and queued writes live inside the providers |
| clock | `now()`, `timeZone()` (sync) | Injected so date logic tests in several zones and across DST |
| notify | `schedule({ id, at, title, body })`, `cancel(id)` | Absent in the web build where the browser cannot do it; native shells fill it |
| links | `open(url)` | OS handlers (mailto, irc, others) in the shells |
| clipboard | `read()`, `write(text)` | |
| files | `pickOpen()`, `pickSave(suggestedName)`, `pickFolder()` | File System Access in Chromium; shells elsewhere |
| script | `run({ language, code, vars, limits })` returns `{ value, output }` | Babel workers, phase 6. Declared now so the contract does not change later |

**Decided 2026-11-21:** secrets and network access live inside the providers, not in the interface. Each provider is constructed with what it needs (its settings, a secure-store handle from the platform, a fetch function), so the interface stays at the spec's list.

**Conflict flow:** a provider write sends the version it last read. If the remote version differs, `write` returns the conflict and the UI offers keep mine, keep theirs, or merge. `core` supplies a three-way text merge over lines; the base is the last synced copy the provider caches.

**Contract tests:** one suite runs against every implementation (`memory`, `browser`, later Android and iOS). The phase 9 gate is that the shells pass it unchanged.

## 4. Phase 1 build order

1. LICENSE, CONTRIBUTING, CI with license check, provenance check, GPL deny-list, precache check.
2. `core/names.js`, `core/parse.js`, `core/serialize.js` with round-trip tests.
3. `core/document.js` with undo and metamorphic tests.
4. `app/interface/contract.js` and `memory.js`, contract tests.
5. `local` provider, then `browser.js`.
6. `github` and `webdav` providers with conflict handling, against mocked `http`.
7. PWA shell and service worker; offline check.
8. Release 0.1.0 (new version number, cache name changes with it).

Each module gets its PROVENANCE.md entry when it lands. Test run policy: only the tests for a change, by name, with CI running everything.

## 5. Spec items to settle (found while recording the guide nodes)

- The guide has no Markdown or OpenDocument export node and has a Publishing chapter; the spec lists the first two and excludes Publishing. Keep the spec's Markdown and OpenDocument as extras, or drop them?
- The guide's Introduction chapter has no row in spec section 5. Treat it as documentation only?
