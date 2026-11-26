import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGithubProvider } from '../app/storage/github.js';
import { createWebdavProvider } from '../app/storage/webdav.js';
import { createCachedProvider } from '../app/storage/cached.js';
import { createMemoryKv } from '../app/storage/kv-memory.js';

/** A fetch that serves one file with an ETag, answers 304 to a matching If-None-Match, and records the requests. */
function server(makeBody) {
  const state = { etag: '"e1"', text: 'hello', seen: [] };
  const fetch = async (url, init = {}) => {
    state.seen.push(init.headers?.['If-None-Match']);
    if (init.headers?.['If-None-Match'] === state.etag) return new Response(null, { status: 304 });
    return new Response(makeBody(state), { status: 200, headers: { ETag: state.etag } });
  };
  return { state, fetch };
}
const b64 = (s) => Buffer.from(s).toString('base64');

test('github: a copy that is still current comes back as notModified', async () => {
  const s = server((st) => JSON.stringify({ type: 'file', encoding: 'base64', content: b64(st.text), sha: 'sha1' }));
  const p = createGithubProvider({ owner: 'o', repo: 'r', branch: 'main', getToken: async () => 't', fetch: s.fetch });
  const first = await p.read('a.org');
  assert.deepEqual([first.text, first.version, first.etag], ['hello', 'sha1', '"e1"']);
  assert.deepEqual(await p.read('a.org', { etag: first.etag }), { notModified: true });
  s.state.etag = '"e2"'; s.state.text = 'changed';
  assert.equal((await p.read('a.org', { etag: first.etag })).text, 'changed');
});

test('webdav: the version is the ETag and is sent back as If-None-Match', async () => {
  const s = server((st) => st.text);
  const p = createWebdavProvider({ baseUrl: 'https://h.example/dav/', getCredentials: async () => ({ username: 'u', password: 'p' }), fetch: s.fetch });
  const first = await p.read('a.org');
  assert.equal(first.version, '"e1"');
  assert.deepEqual(await p.read('a.org', { etag: first.version }), { notModified: true });
});

test('cached: a second read asks conditionally and serves the saved copy on 304', async () => {
  const s = server((st) => st.text);
  const remote = createWebdavProvider({ baseUrl: 'https://h.example/dav/', getCredentials: async () => ({ username: 'u', password: 'p' }), fetch: s.fetch });
  const p = createCachedProvider({ remote, cache: createMemoryKv() });
  assert.equal((await p.read('a.org')).text, 'hello');
  const again = await p.read('a.org');
  assert.deepEqual([again.text, again.version], ['hello', '"e1"']);
  assert.deepEqual(s.state.seen, [undefined, '"e1"']);
  s.state.etag = '"e2"'; s.state.text = 'new';
  assert.equal((await p.read('a.org')).text, 'new');
});
