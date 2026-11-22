// Points git at the repository's hooks (.githooks), which sign off every commit. Runs on npm install.
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

if (!existsSync('.git')) { console.log('install-hooks skipped (not a git repository)'); process.exit(0); }
execFileSync('git', ['config', 'core.hooksPath', '.githooks']);
console.log('install-hooks ok (commits are signed off automatically)');
