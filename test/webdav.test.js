import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWebdavProvider, WebdavError } from '../app/storage/webdav.js';
import { createLocalProvider } from '../app/storage/local.js';
import { createCachedProvider } from '../app/storage/cached.js';
import { createMemoryKv } from '../app/storage/kv-memory.js';
import { createBrowserInterface } from '../app/interface/browser.js';
import { CapabilityUnavailable, NetworkUnavailable } from '../app/interface/contract.js';
import { runContract } from './contract.js';
import { createFakeWebdav } from './fake-webdav.js';

const creds = async () => ({ username: 'me', password: 'pw' });
const make = (fakeOpts, opts = {}) => {
  const fake = createFakeWebdav(fakeOpts);
  const p = createWebdavProvider({ baseUrl: 'https://h.example/dav/', getCredentials: creds, fetch: fake.fetch, ...opts });
  return { fake, p };
};

test('webdav: missing reads as null; create then read round trips unicode', async () => {
  const { p } = make();
  assert.equal(await p.read('home.org'), null);
  const text = '* 📔 Journal – naïve\n';
  const w = await p.write('home.org', text);
  assert.equal(w.ok, true);
  assert.deepEqual(await p.read('home.org'), { text, version: w.version });
});

test('webdav: update sends If-Match, create sends If-None-Match', async () => {
  const { p, fake } = make();
  const a = await p.write('a.org', 'one');
  await p.write('a.org', 'two', { baseVersion: a.version });
  const puts = fake.calls.filter((c) => c.method === 'PUT');
  assert.equal(puts[0].headers['if-none-match'], '*');
  assert.equal(puts[0].headers['if-match'], undefined);
  assert.equal(puts[1].headers['if-match'], a.version);
  assert.equal(puts[1].headers['if-none-match'], undefined);
});

test('webdav: a stale save is a conflict and changes nothing', async () => {
  const { p, fake } = make();
  const a = await p.write('a.org', 'one');
  fake.setRaw('a.org', 'theirs');
  const r = await p.write('a.org', 'mine', { baseVersion: a.version });
  assert.equal(r.ok, false);
  assert.equal(r.conflict.theirs, 'theirs');
  assert.equal(fake.files.get('a.org').text, 'theirs');
});

test('webdav: creating over an existing file is a conflict', async () => {
  const { p } = make();
  await p.write('a.org', 'one');
  assert.equal((await p.write('a.org', 'two')).ok, false);
});

test('webdav: a file deleted on the server is a conflict with nothing on their side', async () => {
  const { p, fake } = make();
  const a = await p.write('a.org', 'one');
  fake.files.delete('a.org');
  assert.deepEqual(await p.write('a.org', 'mine', { baseVersion: a.version }),
    { ok: false, conflict: { theirs: null, theirsVersion: null } });
});

test('webdav: a refusal that is not a conflict is thrown with a hint about weak ETags', async () => {
  const fake = createFakeWebdav();
  const a = await createWebdavProvider({ baseUrl: 'https://h.example/dav/', getCredentials: creds, fetch: fake.fetch }).write('a.org', 'one');
  const refusing = createWebdavProvider({ baseUrl: 'https://h.example/dav/', getCredentials: creds,
    fetch: async (url, init) => (init.method === 'PUT' ? { status: 412, headers: { get: () => null }, text: async () => '' } : fake.fetch(url, init)) });
  await assert.rejects(refusing.write('a.org', 'x', { baseVersion: a.version }), (e) => e instanceof WebdavError && /weak/.test(e.message));
});

test('webdav: missing parent collections are created, once, then the save is retried', async () => {
  const { p, fake } = make();
  const w = await p.write('notes/2026/a.org', 'x');
  assert.equal(w.ok, true);
  assert.ok(fake.dirs.has('notes') && fake.dirs.has('notes/2026'));
  assert.deepEqual(fake.calls.filter((c) => c.method === 'MKCOL').map((c) => c.path), ['/dav/notes/', '/dav/notes/2026/']);
  const again = await p.write('notes/2026/b.org', 'y');
  assert.equal(again.ok, true);
});

test('webdav: an update never creates parents (a 409 on update is a real error)', async () => {
  const { p } = make();
  await assert.rejects(p.write('gone/a.org', 'x', { baseVersion: '"e1"' }), WebdavError);
});

test('webdav: paths are encoded, and a base URL with a path prefix works', async () => {
  const { p, fake } = make({ prefix: '/remote.php/dav/files/me/' }, { baseUrl: 'https://h.example/remote.php/dav/files/me' });
  await p.write('my notes/📔 j.org', 'x');
  assert.ok(fake.calls[0].path.endsWith('/my%20notes/%F0%9F%93%94%20j.org') || fake.calls.some((c) => c.path.endsWith('/%F0%9F%93%94%20j.org')));
  assert.equal((await p.read('my notes/📔 j.org')).text, 'x');
});

test('webdav: requests carry Basic credentials; no credentials is unavailable; wrong ones is an error', async () => {
  const { p, fake } = make();
  await p.read('a.org');
  assert.equal(fake.calls[0].headers.authorization, `Basic ${Buffer.from('me:pw').toString('base64')}`);
  await assert.rejects(make({}, { getCredentials: async () => null }).p.read('a.org'), CapabilityUnavailable);
  const bad = make({}, { getCredentials: async () => ({ username: 'me', password: 'no' }) }).p;
  await assert.rejects(bad.read('a.org'), (e) => e instanceof WebdavError && e.status === 401);
});

for (const [hrefStyle, xmlStyle] of [['path', 'prefixed'], ['uri', 'default'], ['path', 'default'], ['uri', 'prefixed']]) {
  test(`webdav: list walks collections (${hrefStyle} hrefs, ${xmlStyle} XML)`, async () => {
    const { p } = make({ hrefStyle, xmlStyle });
    for (const n of ['b/2.org', 'a.org', 'b/1.org', 'b/deep/3.org', 'my notes/📔 j.org']) await p.write(n, '');
    assert.deepEqual(await p.list(), ['a.org', 'b/1.org', 'b/2.org', 'b/deep/3.org', 'my notes/📔 j.org']);
    assert.deepEqual(await p.list('b/'), ['b/1.org', 'b/2.org', 'b/deep/3.org']);
    assert.deepEqual(await p.list('b/deep/'), ['b/deep/3.org']);
    assert.deepEqual(await p.list('nothing/'), []);
  });
}

test('webdav: list sends Depth 1 and never asks for infinity', async () => {
  const { p, fake } = make();
  await p.write('a/b/c.org', '');
  fake.calls.length = 0;
  await p.list();
  const pf = fake.calls.filter((c) => c.method === 'PROPFIND');
  assert.ok(pf.length >= 3);
  assert.ok(pf.every((c) => c.headers.depth === '1'));
});

test('webdav: remove deletes, and a missing file is a no-op', async () => {
  const { p, fake } = make();
  await p.write('a.org', 'x');
  await p.remove('a.org');
  assert.equal(fake.files.has('a.org'), false);
  await p.remove('a.org');
});

test('webdav: a server that sends no ETag is reported plainly', async () => {
  const { p, fake } = make({ getEtag: false });
  fake.setRaw('a.org', 'x');
  await assert.rejects(p.read('a.org'), /ETag/);
  await assert.rejects(make({ putEtag: false }).p.write('b.org', 'x'), /did not return an ETag/);
});

test('webdav: a failed fetch is NetworkUnavailable, so the cache can queue', async () => {
  const fake = createFakeWebdav();
  let down = false;
  const dav = createWebdavProvider({ baseUrl: 'https://h.example/dav/', getCredentials: creds,
    fetch: (...a) => (down ? Promise.reject(new TypeError('Failed to fetch')) : fake.fetch(...a)) });
  await assert.rejects((down = true, dav.read('a.org')), NetworkUnavailable);
  down = false;
  const p = createCachedProvider({ remote: dav, cache: createMemoryKv() });
  const a = await p.write('a.org', 'one');
  down = true;
  assert.equal((await p.write('a.org', 'two', { baseVersion: a.version })).ok, true);
  down = false;
  assert.deepEqual((await p.sync()).synced, ['a.org']);
  assert.equal(fake.files.get('a.org').text, 'two');
});

runContract('webdav via the browser interface', () => {
  const { p } = make();
  return createBrowserInterface({
    providers: { local: createLocalProvider(createMemoryKv()), github: p },
    env: { navigator: { clipboard: (() => { let c = ''; return { writeText: async (t) => { c = t; }, readText: async () => c }; })() } },
  });
});

test('webdav: every request bypasses the HTTP cache, so a reload sees the server copy', async () => {
  const fake = createFakeWebdav();
  const seen = [];
  const p = createWebdavProvider({ baseUrl: 'https://h.example/dav/', getCredentials: creds,
    fetch: (url, init) => { seen.push(init.cache); return fake.fetch(url, init); } });
  await p.write('a.org', 'one');
  await p.read('a.org');
  await p.entries();
  assert.ok(seen.length >= 3 && seen.every((c) => c === 'no-store'));
});

test('webdav: a shallow listing asks once and names the subfolders, even empty ones', async () => {
  const { fake, p } = make();
  await p.write('top.org', 'x');
  await p.write('a/one.org', 'x');
  await p.write('a/b/two.org', 'x');
  fake.calls.length = 0;
  const root = await p.entries('', { shallow: true });
  assert.deepEqual(root, [{ path: 'a', size: null, folder: true }, { path: 'top.org', size: 1 }]);
  assert.equal(fake.calls.filter((c) => c.method === 'PROPFIND').length, 1);
  assert.deepEqual((await p.entries('a/', { shallow: true })).map((e) => e.path), ['a/b', 'a/one.org']);
});
