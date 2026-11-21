// Fails when a code file has no entry in PROVENANCE.md (its path must appear there).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOTS = ['core', 'app', 'shells', 'tools', 'test'];
const EXT = new Set(['.js', '.mjs', '.kt', '.swift']);
const log = readFileSync('PROVENANCE.md', 'utf8');

function* walk(dir) {
  let entries;
  try { entries = readdirSync(dir); } catch { return; }
  for (const e of entries) {
    if (e === 'node_modules' || e === '.git') continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (EXT.has(extname(p))) yield p;
  }
}

const missing = [];
let count = 0;
for (const root of ROOTS) {
  for (const file of walk(root)) {
    count++;
    if (!log.includes('`' + file + '`')) missing.push(file);
  }
}

if (missing.length) { console.error('provenance-check failed, no entry for:\n- ' + missing.join('\n- ')); process.exit(1); }
console.log(`provenance-check ok (${count} files)`);
