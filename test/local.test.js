import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLocalProvider } from '../app/storage/local.js';
import { createMemoryKv } from '../app/storage/kv-memory.js';

const make = () => {
  let n = 0;
  return createLocalProvider(createMemoryKv(), { newVersion: () => `v${++n}` });
};

test('local: create, update with base version, conflict on stale', async () => {
  const p = make();
  const a = await p.write('a.org', 'one');
  assert.deepEqual(a, { ok: true, version: 'v1' });
  assert.deepEqual(await p.read('a.org'), { text: 'one', version: 'v1' });
  const b = await p.write('a.org', 'two', { baseVersion: 'v1' });
  assert.equal(b.ok, true);
  const stale = await p.write('a.org', 'mine', { baseVersion: 'v1' });
  assert.deepEqual(stale, { ok: false, conflict: { theirs: 'two', theirsVersion: 'v2' } });
  assert.equal((await p.read('a.org')).text, 'two');
});

test('local: creating over an existing file without a base version is a conflict', async () => {
  const p = make();
  await p.write('a.org', 'one');
  assert.equal((await p.write('a.org', 'x')).ok, false);
});

test('local: a version is not reused after delete and recreate', async () => {
  const p = make();
  const a = await p.write('a.org', 'one');
  await p.remove('a.org');
  const b = await p.write('a.org', 'again');
  assert.notEqual(a.version, b.version);
  assert.equal((await p.write('a.org', 'late', { baseVersion: a.version })).ok, false);
});

test('local: list filters by path prefix and sorts', async () => {
  const p = make();
  for (const n of ['b/2.org', 'a.org', 'b/1.org']) await p.write(n, '');
  assert.deepEqual(await p.list('b/'), ['b/1.org', 'b/2.org']);
  assert.deepEqual(await p.list(), ['a.org', 'b/1.org', 'b/2.org']);
});

test('local: removing a missing file is harmless', async () => {
  await make().remove('nope.org');
});

test('local: default version ids are unique', async () => {
  const p = createLocalProvider(createMemoryKv());
  const a = await p.write('a', '1');
  const b = await p.write('b', '1');
  assert.notEqual(a.version, b.version);
});
