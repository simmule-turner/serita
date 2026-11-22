# Contributing

Serita is MIT licensed. Documentation and examples are CC BY 4.0 or CC0. This project is a clean-room implementation; the rules below come from SPEC section 3 and are enforced in CI where a machine can check them.

## Rules

1. Do not read, paste, port or translate GNU Emacs or Org source, the org-pwa source, or data generated from them. The one exception is the separate conformance corpus (SPEC 11): it is never read while writing a module, and only the mismatch report from the comparer is used afterward.
2. The Org Mode Compact Guide is the behavioral reference. Do not copy its text (it is GFDL). Write all documentation and help in your own words.
3. Key names, command names and file syntax are interfaces and may be used. Prose, examples and data tables from GPL or GFDL sources may not.
4. Write parsers, the Lisp interpreter, the date reader, the table calculator and the export engine from the written description of what they accept and produce.
5. Add a PROVENANCE.md entry for every module: who wrote it, which documents it came from, and a statement that no encumbered code was consulted.
6. Every commit carries a DCO sign-off (`git commit -s`). `npm install` installs a commit-msg hook that adds it when missing; `.dco-exempt` lists the few commits made before that.

## Dependencies

Only MIT, BSD, ISC, Apache-2.0 or similar. `npm run check` fails on anything else.

## Checks

    npm run check        license, deny-list, provenance, DCO
    npm test             all tests
    node --test test/<file>.test.js    one module's tests
