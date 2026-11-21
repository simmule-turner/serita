import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCachedProvider } from '../app/storage/cached.js';
import { createLocalProvider } from '../app/storage/local.js';
import { createMemoryKv } from '../app/storage/kv-memory.js';
import { createBrowserInterface } from '../app/interface/browser.js';
import { createGithubProvider } from '../app/storage/github.js';
import { NetworkUnavailable } from '../app/interface/contract.js';
import { merge3, resolve as settle } from '../app/storage/conflict.js';
import { runContract } from './contract.js';
import { createFakeGithub } from './fake-github.js';

/** A remote that can be switched offline, backed by a local provider so versions behave. */
function setup() {
  let n = 0;
  const inner = createLocalProvider(createMemoryKv(), { newVersion: () => `r${++n}` });
  const state = { offline: false, calls: 0 };
  const guard = (f) => async (...a) => { state.calls++; if (state.offline) throw new NetworkUnavailable(); return f(...a); };
  const remote = { read: guard(inner.read), write: guard(inner.write), list: guard(inner.list), entries: guard(inner.entries), remove: guard(inner.remove) };
  const cache = createMemoryKv();
  const p = createCachedProvider({ remote, cache, isOnline: () => !state.offline || state.forceOnlineFlag });
  // a change made by someone else, straight on the server
  const external = async (path, text) => {
    const cur = await inner.read(path);
    return inner.write(path, text, cur ? { baseVersion: cur.version } : {});
  };
  return { p, inner, state, cache, external };
}

test('online: reads and writes pass through; offline reads come from the cache', async () => {
  const { p, state } = setup();
  const w = await p.write('a.org', 'one');
  assert.equal(w.ok, true);
  assert.equal((await p.read('a.org')).text, 'one');
  state.offline = true;
  assert.deepEqual(await p.read('a.org'), { text: 'one', version: w.version });
});

test('offline with nothing cached is a clear network error, not null', async () => {
  const { p, state } = setup();
  state.offline = true;
  await assert.rejects(p.read('never.org'), NetworkUnavailable);
});

test('an offline save is queued, readable, and sent by sync', async () => {
  const { p, state, inner } = setup();
  const a = await p.write('a.org', 'one');
  state.offline = true;
  const q = await p.write('a.org', 'two', { baseVersion: a.version });
  assert.equal(q.ok, true);
  assert.equal((await p.read('a.org')).text, 'two');
  assert.deepEqual(await p.pending(), [{ path: 'a.org', kind: 'write' }]);
  assert.equal((await inner.read('a.org')).text, 'one');

  state.offline = false;
  const r = await p.sync();
  assert.deepEqual(r, { synced: ['a.org'], conflicts: [], pending: 0, offline: false });
  assert.equal((await inner.read('a.org')).text, 'two');
  const again = await p.read('a.org');
  assert.equal(again.text, 'two');
});

test('a second offline save must carry the version it was given', async () => {
  const { p, state } = setup();
  const a = await p.write('a.org', 'one');
  state.offline = true;
  const q1 = await p.write('a.org', 'two', { baseVersion: a.version });
  const stale = await p.write('a.org', 'x', { baseVersion: a.version });
  assert.equal(stale.ok, false);
  assert.equal(stale.conflict.theirs, 'two');
  const q2 = await p.write('a.org', 'three', { baseVersion: q1.version });
  assert.equal(q2.ok, true);
  assert.equal((await p.read('a.org')).text, 'three');
});

test('a file created offline is listed and sent later', async () => {
  const { p, state, inner } = setup();
  await p.write('keep.org', 'k');
  state.offline = true;
  await p.write('new.org', 'n');
  assert.deepEqual(await p.list(), ['keep.org', 'new.org']);
  state.offline = false;
  assert.deepEqual(await p.list(), ['keep.org', 'new.org']);
  await p.sync();
  assert.equal((await inner.read('new.org')).text, 'n');
});

test('sync reports a conflict with base, mine and theirs; merge settles it', async () => {
  const { p, state, inner, external } = setup();
  const base = 'a\nb\nc\nd\n';
  const w = await p.write('a.org', base);
  state.offline = true;
  await p.write('a.org', 'A\nb\nc\nd\n', { baseVersion: w.version });
  state.offline = false;
  await external('a.org', 'a\nb\nc\nD\n');

  const r = await p.sync();
  assert.equal(r.synced.length, 0);
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.pending, 1);
  const c = r.conflicts[0];
  assert.deepEqual([c.base, c.mine, c.theirs], [base, 'A\nb\nc\nd\n', 'a\nb\nc\nD\n']);

  const m = merge3(c.base, c.mine, c.theirs);
  assert.equal(m.clean, true);
  const res = await p.resolve('a.org', m.text, c.theirsVersion);
  assert.equal(res.ok, true);
  assert.equal((await inner.read('a.org')).text, 'A\nb\nc\nD\n');
  assert.equal((await p.pending()).length, 0);
});

test('keep mine against a true clash, then a further server change is a new conflict', async () => {
  const { p, state, inner, external } = setup();
  const w = await p.write('a.org', 'x\n');
  state.offline = true;
  await p.write('a.org', 'mine\n', { baseVersion: w.version });
  state.offline = false;
  const e1 = await external('a.org', 'theirs\n');
  const c = (await p.sync()).conflicts[0];
  assert.equal(c.theirsVersion, e1.version);
  await external('a.org', 'theirs again\n');
  const again = await p.resolve('a.org', settle(merge3(c.base, c.mine, c.theirs).segments, () => 'mine'), c.theirsVersion);
  assert.equal(again.ok, false);
  assert.equal(again.conflict.theirs, 'theirs again\n');
  assert.equal((await inner.read('a.org')).text, 'theirs again\n');
});

test('keep theirs drops the local change', async () => {
  const { p, state, external } = setup();
  const w = await p.write('a.org', 'x\n');
  state.offline = true;
  await p.write('a.org', 'mine\n', { baseVersion: w.version });
  state.offline = false;
  await external('a.org', 'theirs\n');
  await p.sync();
  await p.discard('a.org');
  assert.equal((await p.read('a.org')).text, 'theirs\n');
  assert.equal((await p.pending()).length, 0);
});

test('an online read does not replace an unsent local edit', async () => {
  const { p, state, external } = setup();
  const w = await p.write('a.org', 'x\n');
  state.offline = true;
  await p.write('a.org', 'mine\n', { baseVersion: w.version });
  state.offline = false;
  await external('a.org', 'theirs\n');
  assert.equal((await p.read('a.org')).text, 'mine\n');
});

test('an online save that meets a newer server copy is a conflict and changes nothing', async () => {
  const { p, inner, external } = setup();
  const w = await p.write('a.org', 'x\n');
  await external('a.org', 'theirs\n');
  const r = await p.write('a.org', 'mine\n', { baseVersion: w.version });
  assert.equal(r.ok, false);
  assert.equal((await inner.read('a.org')).text, 'theirs\n');
  assert.deepEqual(await p.pending(), []);
});

test('an offline delete is queued and sent; a changed server copy makes it a conflict', async () => {
  const s = setup();
  await s.p.write('a.org', '1');
  const w = await s.p.write('b.org', '1');
  s.state.offline = true;
  await s.p.remove('a.org');
  await s.p.remove('b.org');
  assert.equal(await s.p.read('a.org'), null);
  assert.deepEqual(await s.p.list(), []);
  assert.deepEqual((await s.p.pending()).map((x) => x.kind), ['delete', 'delete']);
  s.state.offline = false;
  await s.external('b.org', 'changed');
  const r = await s.p.sync();
  assert.deepEqual(r.synced, ['a.org']);
  assert.equal(r.conflicts[0].path, 'b.org');
  assert.equal(r.conflicts[0].mine, null);
  assert.equal(await s.inner.read('a.org'), null);
  assert.equal((await s.inner.read('b.org')).text, 'changed');
  assert.ok(w.ok);
});

test('removing a file that was only ever local drops it without queuing a delete', async () => {
  const { p, state } = setup();
  state.offline = true;
  await p.write('tmp.org', 'x');
  await p.remove('tmp.org');
  assert.deepEqual(await p.pending(), []);
});

test('sync stops cleanly when the network drops partway', async () => {
  const { p, state } = setup();
  const a = await p.write('a.org', '1');
  const b = await p.write('b.org', '1');
  state.offline = true;
  await p.write('a.org', '2', { baseVersion: a.version });
  await p.write('b.org', '2', { baseVersion: b.version });
  const r = await p.sync();
  assert.equal(r.offline, true);
  assert.equal(r.pending, 2);
});

test('errors that are not network errors are thrown and nothing is queued', async () => {
  const cache = createMemoryKv();
  const boom = async () => { throw new Error('boom'); };
  const p = createCachedProvider({ remote: { read: boom, write: boom, list: boom, remove: boom }, cache });
  await assert.rejects(p.write('a.org', 'x'), /boom/);
  await assert.rejects(p.read('a.org'), /boom/);
  assert.deepEqual(await p.pending(), []);
});

test('isOnline false skips the server entirely', async () => {
  const { state, inner } = setup();
  let calls = 0;
  const remote = { read: async () => { calls++; return null; }, write: async () => { calls++; }, list: async () => { calls++; return []; }, remove: async () => { calls++; } };
  const p = createCachedProvider({ remote, cache: createMemoryKv(), isOnline: () => false });
  await p.write('a.org', 'x');
  assert.equal(calls, 0);
  assert.equal((await p.read('a.org')).text, 'x');
  assert.ok(state && inner);
});

test('github: a failed fetch is NetworkUnavailable, so the cache can queue', async () => {
  const fake = createFakeGithub();
  let down = false;
  const gh = createGithubProvider({ owner: 'me', repo: 'org', branch: 'main', getToken: async () => 'tok',
    fetch: (...a) => (down ? Promise.reject(new TypeError('Failed to fetch')) : fake.fetch(...a)) });
  const p = createCachedProvider({ remote: gh, cache: createMemoryKv() });
  const a = await p.write('a.org', 'one');
  down = true;
  const q = await p.write('a.org', 'two', { baseVersion: a.version });
  assert.equal(q.ok, true);
  down = false;
  assert.deepEqual((await p.sync()).synced, ['a.org']);
  assert.equal(fake.files.get('a.org').text, 'two');
  assert.equal(fake.calls.filter((c) => c.method === 'PUT').length, 2, 'one commit per save, queued or not');
});

runContract('cached provider via the browser interface', () => {
  const { p } = setup();
  return createBrowserInterface({
    providers: { local: createLocalProvider(createMemoryKv()), github: p },
    env: { navigator: { clipboard: (() => { let c = ''; return { writeText: async (t) => { c = t; }, readText: async () => c }; })() } },
  });
});
