import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createConfig } from '../app/ui/config.js';

const store = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };

test('update merges, empty removes, unknown keys are ignored', () => {
  const c = createConfig(store());
  c.update({ settings: { 'github.owner': 'me', 'github.repo': 'r', bogus: 'x' }, secrets: { 'github.token': 't' } });
  assert.deepEqual(c.settings(), { 'github.owner': 'me', 'github.repo': 'r' });
  c.update({ settings: { 'github.repo': '' } });
  assert.deepEqual(c.settings(), { 'github.owner': 'me' });
  assert.equal(c.githubReady(), false);
  c.update({ settings: { 'github.repo': 'r2' } });
  assert.equal(c.githubReady(), true);
  assert.equal(c.webdavReady(), false);
});

test('replaceAll drops what is not in the import, and onChange fires', () => {
  const c = createConfig(store());
  let n = 0; c.onChange(() => n++);
  c.update({ settings: { 'webdav.url': 'https://h/', 'webdav.username': 'u' }, secrets: { 'webdav.password': 'p' } });
  assert.equal(c.webdavReady(), true);
  c.replaceAll({ settings: { 'github.owner': 'o' }, secrets: {} });
  assert.deepEqual(c.settings(), { 'github.owner': 'o' });
  assert.deepEqual(c.secrets(), {});
  assert.equal(n, 2);
});
