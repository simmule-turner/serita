# Working in this repository

- Commit with `git commit -s`. The commit-msg hook (installed by `npm install`) adds the sign-off if it is missing; any attribution lines go after it.
- Follow CONTRIBUTING.md and SPEC section 3: no Emacs or Org source, ever.

## Release zips
Every delivered zip is `serita-vX.Y.Z.zip` with the files at the top level (no wrapping `serita/` folder). Build it from inside the repository: `zip -qr ../serita-vX.Y.Z.zip . -x "node_modules/*" ".git/*"`, then check the first lines of `unzip -l` before sending.
