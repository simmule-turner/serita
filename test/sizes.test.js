import { test } from 'node:test';
import assert from 'node:assert/strict';
import { byteLength, formatSize } from '../core/bytes.js';
import { children, parentDir } from '../app/storage/browse.js';
import { createLocalProvider } from '../app/storage/local.js';
import { createMemoryKv } from '../app/storage/kv-memory.js';
import { createGithubProvider } from '../app/storage/github.js';
import { createWebdavProvider } from '../app/storage/webdav.js';
import { createCachedProvider } from '../app/storage/cached.js';
import { NetworkUnavailable } from '../app/interface/contract.js';
import { createFakeGithub } from './fake-github.js';
import { createFakeWebdav } from './fake-webdav.js';

test('bytes: UTF-8 length, and a short readable size', () => {
  assert.equal(byteLength('abc'), 3);
  assert.equal(byteLength('héllo'), 6);
  assert.equal(byteLength('📔'), 4);
  assert.equal(formatSize(null), '');
  assert.equal(formatSize(0), '0 B');
  assert.equal(formatSize(1023), '1023 B');
  assert.equal(formatSize(1024), '1.0 KB');
  assert.equal(formatSize(3500), '3.4 KB');
  assert.equal(formatSize(5 * 1024 * 1024), '5.0 MB');
});

test('browse: folders and files directly inside one folder', () => {
  const e = [['a.org', 1], ['org/init.el', 2], ['org/deep/x.org', 3], ['org/Globals.el', 4], ['B.org', null], ['orgs.txt', 5]]
    .map(([path, size]) => ({ path, size }));
  assert.deepEqual(children(e), {
    folders: ['org'],
    files: [{ name: 'a.org', size: 1 }, { name: 'B.org', size: null }, { name: 'orgs.txt', size: 5 }],
  });
  assert.deepEqual(children(e, 'org/'), {
    folders: ['deep'],
    files: [{ name: 'Globals.el', size: 4 }, { name: 'init.el', size: 2 }],
  });
  assert.deepEqual(children(e, 'org/deep/'), { folders: [], files: [{ name: 'x.org', size: 3 }] });
  assert.deepEqual(children([], ''), { folders: [], files: [] });
});

test('browse: parentDir', () => {
  assert.equal(parentDir('a/b/'), 'a/');
  assert.equal(parentDir('a/'), '');
  assert.equal(parentDir(''), '');
});

test('local: entries carry byte sizes', async () => {
  const p = createLocalProvider(createMemoryKv());
  await p.write('a.org', 'héllo');
  await p.write('b/c.org', '');
  assert.deepEqual(await p.entries(), [{ path: 'a.org', size: 6 }, { path: 'b/c.org', size: 0 }]);
  assert.deepEqual(await p.list('b/'), ['b/c.org']);
});

test('github: entries carry the size the tree reports', async () => {
  const fake = createFakeGithub();
  const p = createGithubProvider({ owner: 'me', repo: 'org', branch: 'main', getToken: async () => 'tok', fetch: fake.fetch });
  await p.write('a.org', 'héllo');
  assert.deepEqual(await p.entries(), [{ path: 'a.org', size: 6 }]);
});

test('webdav: entries carry getcontentlength, and null when the server leaves it out', async () => {
  for (const [sizes, expected] of [[true, 6], [false, null]]) {
    const fake = createFakeWebdav({ sizes });
    const p = createWebdavProvider({ baseUrl: 'https://h.example/dav/', getCredentials: async () => ({ username: 'me', password: 'pw' }), fetch: fake.fetch });
    await p.write('a.org', 'héllo');
    await p.write('d/b.org', 'x');
    const e = await p.entries();
    assert.deepEqual(e.map((x) => x.path), ['a.org', 'd/b.org']);
    assert.equal(e[0].size, expected);
  }
});

test('cached: an unsent edit shows its own size, a queued new file is listed with a size, and offline sizes come from the cache', async () => {
  const inner = createLocalProvider(createMemoryKv());
  let offline = false;
  const guard = (f) => async (...a) => { if (offline) throw new NetworkUnavailable(); return f(...a); };
  const remote = { read: guard(inner.read), write: guard(inner.write), list: guard(inner.list), entries: guard(inner.entries), remove: guard(inner.remove) };
  const p = createCachedProvider({ remote, cache: createMemoryKv() });
  const a = await p.write('a.org', 'one');
  assert.deepEqual(await p.entries(), [{ path: 'a.org', size: 3 }]);
  offline = true;
  await p.write('a.org', 'three!', { baseVersion: a.version });
  await p.write('new.org', 'héllo');
  assert.deepEqual(await p.entries(), [{ path: 'a.org', size: 6 }, { path: 'new.org', size: 6 }]);
  offline = false;
  assert.deepEqual(await p.entries(), [{ path: 'a.org', size: 6 }, { path: 'new.org', size: 6 }]);
});

test('a folder entry from a one-folder listing shows as a folder, empty or not', () => {
  const r = children([{ path: 'a/sub', size: null, folder: true }, { path: 'a/x.org', size: 3 }], 'a/');
  assert.deepEqual(r.folders, ['sub']);
  assert.deepEqual(r.files, [{ name: 'x.org', size: 3 }]);
});
