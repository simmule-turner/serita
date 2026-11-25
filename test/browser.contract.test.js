import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runContract } from './contract.js';
import { createBrowserInterface } from '../app/interface/browser.js';
import { createLocalProvider } from '../app/storage/local.js';
import { createMemoryKv } from '../app/storage/kv-memory.js';
import { CapabilityUnavailable } from '../app/interface/contract.js';

const fakeEnv = () => {
  let clip = '';
  return { navigator: { clipboard: { writeText: async (t) => { clip = t; }, readText: async () => clip } } };
};
const local = () => createLocalProvider(createMemoryKv());
// The contract suite stores to github: too, so the test configures a second provider.
const make = (extra = {}) => createBrowserInterface({ providers: { local: local(), github: local() }, env: fakeEnv(), ...extra });

runContract('browser', () => make());

test('browser: an unconfigured provider is unavailable, not silently local', async () => {
  const i = createBrowserInterface({ providers: { local: local() }, env: fakeEnv() });
  await assert.rejects(i.storage.read('github:home.org'), (e) => e instanceof CapabilityUnavailable && /github/.test(e.message));
  await assert.rejects(i.storage.write('webdav:x.org', 'q'), CapabilityUnavailable);
});

test('browser: capabilities follow what the environment has', () => {
  const none = createBrowserInterface({ providers: { local: local() }, env: {} }).capabilities();
  assert.equal(none.clipboard.available, false);
  assert.equal(none.links.available, false);
  assert.equal(none.files.available, false);
  assert.equal(none.notify.available, false);
  const some = make().capabilities();
  assert.equal(some.clipboard.available, true);
});

test('browser: links open in a new tab without an opener', async () => {
  const calls = [];
  const i = createBrowserInterface({ providers: { local: local() }, env: { open: (...a) => calls.push(a) } });
  await i.links.open('https://example.com');
  assert.deepEqual(calls, [['https://example.com', '_blank', 'noopener']]);
});

test('browser: file pickers return content, and cancelling is null or false', async () => {
  const abort = Object.assign(new Error('x'), { name: 'AbortError' });
  let written = '';
  const env = {
    showOpenFilePicker: async () => [{ getFile: async () => ({ name: 'n.org', text: async () => '* hi\n' }) }],
    showSaveFilePicker: async () => ({ createWritable: async () => ({ write: async (t) => { written = t; }, close: async () => {} }) }),
  };
  const i = createBrowserInterface({ providers: { local: local() }, env });
  assert.deepEqual(await i.files.pickOpen(), { name: 'n.org', text: '* hi\n' });
  assert.equal(await i.files.pickSave('out.org', 'text'), true);
  assert.equal(written, 'text');
  const cancelling = createBrowserInterface({ providers: { local: local() }, env: {
    showOpenFilePicker: async () => { throw abort; }, showSaveFilePicker: async () => { throw abort; } } });
  assert.equal(await cancelling.files.pickOpen(), null);
  assert.equal(await cancelling.files.pickSave('o', 't'), false);
});

test('browser: a real error from a picker is not swallowed', async () => {
  const i = createBrowserInterface({ providers: { local: local() }, env: {
    showOpenFilePicker: async () => { throw new Error('disk'); }, showSaveFilePicker: async () => {} } });
  await assert.rejects(i.files.pickOpen(), /disk/);
});

test('browser: folders need the native apps', async () => {
  await assert.rejects(make().files.pickFolder(), CapabilityUnavailable);
});

test('browser: list with no prefix spans the configured providers only', async () => {
  const i = createBrowserInterface({ providers: { local: local() }, env: fakeEnv() });
  await i.storage.write('a.org', '1');
  assert.deepEqual(await i.storage.list(), ['local:a.org']);
});

test('browser: a watcher hears a change made in another tab, marked external, and not its own as external', async () => {
  const peers = new Set();
  class FakeChannel {
    constructor() { peers.add(this); }
    postMessage(data) { for (const p of peers) if (p !== this) p.onmessage?.({ data }); }
  }
  const tab = () => createBrowserInterface({ providers: { local: local() }, env: { ...fakeEnv(), BroadcastChannel: FakeChannel } });
  const a = tab();
  const b = tab();
  const seen = [];
  b.storage.watch('x.org', (n, external) => seen.push([n, external]));
  a.storage.watch('x.org', () => seen.push(['a heard']));
  await a.storage.write('x.org', '1');
  await b.storage.write('x.org', '2');
  assert.deepEqual(seen, [['a heard'], ['local:x.org', true], ['local:x.org', false], ['a heard']]);
});
