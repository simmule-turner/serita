import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGithubProvider, GithubError } from '../app/storage/github.js';
import { createLocalProvider } from '../app/storage/local.js';
import { createMemoryKv } from '../app/storage/kv-memory.js';
import { createBrowserInterface } from '../app/interface/browser.js';
import { CapabilityUnavailable } from '../app/interface/contract.js';
import { runContract } from './contract.js';
import { createFakeGithub } from './fake-github.js';

const make = (fakeOpts, providerOpts = {}) => {
  const fake = createFakeGithub(fakeOpts);
  const p = createGithubProvider({ owner: 'me', repo: 'org', branch: 'main', getToken: async () => 'tok', fetch: fake.fetch, ...providerOpts });
  return { fake, p };
};

test('github: missing file reads as null; create then read round trips unicode', async () => {
  const { p } = make();
  assert.equal(await p.read('home.org'), null);
  const text = '* 📔 Journal – naïve\n' + 'x'.repeat(200) + '\n';
  const w = await p.write('home.org', text);
  assert.equal(w.ok, true);
  const r = await p.read('home.org');
  assert.equal(r.text, text);
  assert.equal(r.version, w.version);
});

for (const staleStatus of [409, 422, 404]) {
  test(`github: a stale save is a conflict however the server reports it (${staleStatus})`, async () => {
    const { p, fake } = make({ staleStatus });
    const a = await p.write('a.org', 'one');
    fake.setRaw('a.org', 'theirs');
    const r = await p.write('a.org', 'mine', { baseVersion: a.version });
    assert.equal(r.ok, false);
    assert.equal(r.conflict.theirs, 'theirs');
    assert.equal(fake.files.get('a.org').text, 'theirs');
  });
}

for (const missingWithShaStatus of [404, 409, 422]) {
  test(`github: a file deleted remotely is a conflict with nothing on their side (${missingWithShaStatus})`, async () => {
    const { p, fake } = make({ missingWithShaStatus });
    const a = await p.write('a.org', 'one');
    fake.files.delete('a.org');
    const r = await p.write('a.org', 'mine', { baseVersion: a.version });
    assert.deepEqual(r, { ok: false, conflict: { theirs: null, theirsVersion: null } });
  });
}

test('github: creating over an existing file is a conflict', async () => {
  const { p } = make();
  await p.write('a.org', 'one');
  assert.equal((await p.write('a.org', 'two')).ok, false);
});

test('github: a failure that is not a conflict is thrown, not reported as one', async () => {
  const { p } = make();
  const a = await p.write('a.org', 'one');
  const bad = createGithubProvider({ owner: 'me', repo: 'org', branch: 'main', getToken: async () => 'tok',
    fetch: async (url, init) => (init?.method === 'PUT'
      ? { status: 422, json: async () => ({ message: 'Validation Failed' }) }
      : { status: 200, json: async () => ({ type: 'file', encoding: 'base64', content: btoa('one'), sha: a.version }) }) });
  await assert.rejects(bad.write('a.org', 'x', { baseVersion: a.version }), (e) => e instanceof GithubError && e.status === 422);
});

test('github: one commit per save, with a readable message', async () => {
  const { p, fake } = make();
  const a = await p.write('notes/a.org', 'one');
  await p.write('notes/a.org', 'two', { baseVersion: a.version });
  const puts = fake.calls.filter((c) => c.method === 'PUT');
  assert.equal(puts.length, 2);
  assert.deepEqual(puts.map((c) => c.body.message), ['Create notes/a.org', 'Update notes/a.org']);
  assert.ok(puts.every((c) => c.body.branch === 'main'));
});

test('github: paths are encoded segment by segment', async () => {
  const { p, fake } = make();
  await p.write('my notes/📔 j.org', 'x');
  assert.ok(fake.calls[0].path.endsWith('/contents/my%20notes/%F0%9F%93%94%20j.org'));
  assert.equal((await p.read('my notes/📔 j.org')).text, 'x');
});

test('github: requests carry the token and the documented headers', async () => {
  const { p, fake } = make();
  await p.read('a.org');
  const h = fake.calls[0].headers;
  assert.equal(h.Authorization, 'Bearer tok');
  assert.equal(h.Accept, 'application/vnd.github+json');
  assert.equal(h['X-GitHub-Api-Version'], '2026-03-10');
  assert.match(fake.calls[0].search, /ref=main/);
});

test('github: no token means unavailable; a rejected token is an error with its status', async () => {
  const { p } = make({}, { getToken: async () => null });
  await assert.rejects(p.read('a.org'), CapabilityUnavailable);
  const wrong = make({ token: 'other' }).p;
  await assert.rejects(wrong.read('a.org'), (e) => e instanceof GithubError && e.status === 401);
});

test('github: list returns files only, filtered and sorted; a truncated tree is an error', async () => {
  const { p } = make();
  for (const n of ['b/2.org', 'a.org', 'b/1.org']) await p.write(n, '');
  assert.deepEqual(await p.list('b/'), ['b/1.org', 'b/2.org']);
  assert.deepEqual(await p.list(), ['a.org', 'b/1.org', 'b/2.org']);
  await assert.rejects(make({ truncated: true }).p.list(), /too large/);
});

test('github: remove deletes, ignores a missing file, and retries once after a race', async () => {
  const { p, fake } = make();
  await p.write('a.org', 'one');
  await p.remove('a.org');
  assert.equal(fake.files.has('a.org'), false);
  await p.remove('a.org');

  const raced = make();
  await raced.p.write('b.org', 'one');
  const realFetch = raced.fake.fetch;
  let bumped = false;
  const p2 = createGithubProvider({ owner: 'me', repo: 'org', branch: 'main', getToken: async () => 'tok',
    fetch: async (url, init) => {
      if (init?.method === 'DELETE' && !bumped) { bumped = true; raced.fake.setRaw('b.org', 'changed'); }
      return realFetch(url, init);
    } });
  await p2.remove('b.org');
  assert.equal(raced.fake.files.has('b.org'), false);
});

test('github: a file the contents API will not inline is a clear error', async () => {
  const p = createGithubProvider({ owner: 'me', repo: 'org', branch: 'main', getToken: async () => 'tok',
    fetch: async () => ({ status: 200, json: async () => ({ type: 'file', encoding: 'none', content: '', sha: 's' }) }) });
  await assert.rejects(p.read('big.org'), /larger than 1 MB/);
});

runContract('github via the browser interface', () => {
  const { p } = make();
  return createBrowserInterface({
    providers: { local: createLocalProvider(createMemoryKv()), github: p },
    env: { navigator: { clipboard: (() => { let c = ''; return { writeText: async (t) => { c = t; }, readText: async () => c }; })() } },
  });
});
