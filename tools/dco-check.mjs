// Fails when a commit in the checked range has no Signed-off-by line.
// Commits listed in .dco-exempt (made before sign-off was automatic) are skipped.
// Usage: node tools/dco-check.mjs [range]   (default: all commits)
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

if (!existsSync('.git')) { console.log('dco-check skipped (not a git repository)'); process.exit(0); }

const exempt = existsSync('.dco-exempt')
  ? readFileSync('.dco-exempt', 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  : [];
const range = process.argv[2];
const args = ['log', '--format=%H%x00%B%x01', ...(range ? [range] : [])];
const out = execFileSync('git', args, { encoding: 'utf8' });
const bad = out.split('\x01').map((s) => s.trim()).filter(Boolean).filter((entry) => {
  const [, body = ''] = entry.split('\x00');
  return !/^Signed-off-by: .+ <.+>$/m.test(body);
}).map((entry) => entry.split('\x00')[0]).filter((sha) => !exempt.some((x) => sha.startsWith(x))).map((sha) => sha.slice(0, 12));

if (bad.length) { console.error('dco-check failed, no sign-off on: ' + bad.join(', ')); process.exit(1); }
console.log('dco-check ok');
