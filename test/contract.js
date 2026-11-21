// Shared contract tests. Every implementation of the app interface runs this same suite.
// Usage: import { runContract } from './contract.js'; runContract('name', () => createX());

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CAPABILITIES, CapabilityUnavailable } from '../app/interface/contract.js';

/**
 * @param {string} label
 * @param {() => import('../app/interface/contract.js').AppInterface} make  a fresh interface per call
 */
export function runContract(label, make) {
  test(`${label}: reports every capability`, () => {
    const caps = make().capabilities();
    assert.deepEqual(Object.keys(caps).sort(), [...CAPABILITIES].sort());
    for (const c of Object.values(caps)) {
      assert.equal(typeof c.available, 'boolean');
      if (!c.available) assert.equal(typeof c.reason, 'string');
    }
  });

  test(`${label}: a missing file reads as null`, async () => {
    assert.equal(await make().storage.read('nope.org'), null);
  });

  test(`${label}: create, read, update with the version last read`, async () => {
    const s = make().storage;
    const a = await s.write('a.org', 'one');
    assert.equal(a.ok, true);
    const r = await s.read('a.org');
    assert.equal(r.text, 'one');
    assert.equal(r.version, a.version);
    const b = await s.write('a.org', 'two', { baseVersion: r.version });
    assert.equal(b.ok, true);
    assert.notEqual(b.version, a.version);
    assert.equal((await s.read('a.org')).text, 'two');
  });

  test(`${label}: a stale or missing base version is a conflict that changes nothing`, async () => {
    const s = make().storage;
    const a = await s.write('a.org', 'one');
    const b = await s.write('a.org', 'two', { baseVersion: a.version });
    const stale = await s.write('a.org', 'mine', { baseVersion: a.version });
    assert.equal(stale.ok, false);
    assert.equal(stale.conflict.theirs, 'two');
    assert.equal(stale.conflict.theirsVersion, b.version);
    const none = await s.write('a.org', 'mine');
    assert.equal(none.ok, false);
    assert.equal((await s.read('a.org')).text, 'two');
  });

  test(`${label}: writing against a file that is gone is a conflict`, async () => {
    const s = make().storage;
    const gone = await s.write('x.org', 'q', { baseVersion: 'v-old' });
    assert.equal(gone.ok, false);
    assert.equal(gone.conflict.theirs, null);
  });

  test(`${label}: a bare name and local: name are the same file`, async () => {
    const s = make().storage;
    await s.write('n.org', 'hi');
    assert.equal((await s.read('local:n.org')).text, 'hi');
  });

  test(`${label}: list is sorted and filtered by prefix; remove deletes`, async () => {
    const s = make().storage;
    await s.write('github:b.org', '1');
    await s.write('github:a.org', '1');
    await s.write('local:c.org', '1');
    assert.deepEqual(await s.list('github:'), ['github:a.org', 'github:b.org']);
    assert.deepEqual(await s.list(), ['github:a.org', 'github:b.org', 'local:c.org']);
    await s.remove('github:a.org');
    assert.equal(await s.read('github:a.org'), null);
  });

  test(`${label}: watch fires on change and stops after unsubscribe`, async () => {
    const s = make().storage;
    const seen = [];
    const off = s.watch('w.org', (n) => seen.push(n));
    const w = await s.write('w.org', '1');
    off();
    await s.write('w.org', '2', { baseVersion: w.version });
    assert.deepEqual(seen, ['local:w.org']);
  });

  test(`${label}: providers lists the three`, () => {
    assert.deepEqual(make().storage.providers().sort(), ['github', 'local', 'webdav']);
  });

  test(`${label}: clock gives a Date and a zone name`, () => {
    const c = make().clock;
    assert.ok(c.now() instanceof Date);
    assert.equal(typeof c.timeZone(), 'string');
  });

  test(`${label}: clipboard round trip`, async () => {
    const c = make().clipboard;
    await c.write('copied');
    assert.equal(await c.read(), 'copied');
  });

  test(`${label}: an unavailable capability throws CapabilityUnavailable, never pretends`, async () => {
    const i = make();
    for (const [name, cap] of Object.entries(i.capabilities())) {
      if (cap.available) continue;
      const calls = { files: () => i.files.pickOpen(), script: () => i.script.run({ language: 'js', code: '1' }) };
      if (!calls[name]) continue;
      await assert.rejects(calls[name](), (e) => e instanceof CapabilityUnavailable && e.capability === name);
    }
  });
}
