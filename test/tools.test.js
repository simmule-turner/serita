import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const root = process.cwd();

function run(script, cwd) {
  return spawnSync('node', [join(root, 'tools', script)], { cwd, encoding: 'utf8' });
}

function project(files) {
  const dir = mkdtempSync(join(tmpdir(), 'serita-'));
  mkdirSync(join(dir, 'tools'));
  cpSync(join(root, 'tools/denylist.txt'), join(dir, 'tools/denylist.txt'));
  writeFileSync(join(dir, 'PROVENANCE.md'), '# log\n');
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

test('denylist-check passes on clean code and fails on a license marker', () => {
  assert.equal(run('denylist-check.mjs', project({ 'core/a.js': 'export const a = 1;\n' })).status, 0);
  const marker = ['SPDX-License-', 'Identifier: G', 'PL-3.0-or-later'].join('');
  const bad = project({ 'core/b.js': `// ${marker}\n` });
  assert.equal(run('denylist-check.mjs', bad).status, 1);
});

test('provenance-check fails until the file has an entry', () => {
  const dir = project({ 'core/c.js': 'export {};\n' });
  assert.equal(run('provenance-check.mjs', dir).status, 1);
  writeFileSync(join(dir, 'PROVENANCE.md'), '## `core/c.js`\n');
  assert.equal(run('provenance-check.mjs', dir).status, 0);
});

test('license-check passes for this project', () => {
  assert.equal(run('license-check.mjs', root).status, 0);
});

test('dco-check skips outside a git repository', () => {
  const r = run('dco-check.mjs', project({}));
  assert.equal(r.status, 0);
  assert.match(r.stdout, /skipped/);
});

test('dco-check skips commits listed in .dco-exempt and fails on others', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dco-'));
  const git = (...a) => execFileSync('git', ['-C', dir, '-c', 'user.name=T', '-c', 'user.email=t@example.com', ...a], { encoding: 'utf8' });
  git('init', '-q');
  git('commit', '-q', '--allow-empty', '-m', 'unsigned');
  const sha = git('rev-parse', 'HEAD').trim();
  const check = () => spawnSync('node', [join(root, 'tools/dco-check.mjs')], { cwd: dir, encoding: 'utf8' });
  assert.equal(check().status, 1);
  writeFileSync(join(dir, '.dco-exempt'), `# old\n${sha.slice(0, 12)}\n`);
  assert.equal(check().status, 0);
});

test('the commit-msg hook refuses a commit when the git name or email is unset', async () => {
  const { mkdtempSync, writeFileSync } = await import('node:fs');
  const { spawnSync } = await import('node:child_process');
  const { tmpdir } = await import('node:os');
  const { join, resolve } = await import('node:path');
  const dir = mkdtempSync(join(tmpdir(), 'hook-'));
  const msg = join(dir, 'MSG');
  writeFileSync(msg, 'x\n');
  const hook = resolve('.githooks/commit-msg');
  const env = { ...process.env, HOME: dir, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
  const r = spawnSync('sh', [hook, msg], { cwd: dir, env, encoding: 'utf8' });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /user\.name/);
});
