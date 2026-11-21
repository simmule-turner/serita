import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

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
