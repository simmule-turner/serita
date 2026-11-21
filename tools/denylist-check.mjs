// Fails when a source file contains a string from tools/denylist.txt.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const ROOTS = ['core', 'app', 'shells', 'tools', 'test'];
const EXT = new Set(['.js', '.mjs', '.css', '.html', '.kt', '.swift', '.json']);
const patterns = readFileSync('tools/denylist.txt', 'utf8')
  .split('\n').filter((l) => l.trim() && !l.startsWith('#')).map((l) => l.trim().toLowerCase());

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

const hits = [];
for (const root of ROOTS) {
  for (const file of walk(root)) {
    if (file === 'tools/denylist.txt') continue;
    const text = readFileSync(file, 'utf8').toLowerCase();
    for (const p of patterns) if (text.includes(p)) hits.push(`${file}: contains "${p}"`);
  }
}

if (hits.length) { console.error('denylist-check failed:\n- ' + hits.join('\n- ')); process.exit(1); }
console.log('denylist-check ok');
