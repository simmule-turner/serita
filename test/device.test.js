import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDeviceProvider } from '../app/storage/device.js';
import { createMemoryKv } from '../app/storage/kv-memory.js';
import { CapabilityUnavailable } from '../app/interface/contract.js';

class Handle {
  constructor(name, text = '') { this.name = name; this.text = text; this.mtime = 1000; this.granted = 'granted'; this.asked = 0; }
  async queryPermission() { return this.granted; }
  async requestPermission() { this.asked++; return this.granted; }
  async isSameEntry(o) { return o === this; }
  async getFile() { const t = this.text; return { lastModified: this.mtime, text: async () => t }; }
  async createWritable() { let buf = ''; return { write: async (x) => { buf = x; }, close: async () => { this.text = buf; this.mtime += 1; } }; }
}
const make = (opts = {}) => {
  const env = { showOpenFilePicker: async () => [opts.open], showSaveFilePicker: async () => opts.save, ...opts.env };
  return createDeviceProvider({ kv: createMemoryKv(), env });
};

test('pick, read, write, and a stale version is refused', async () => {
  const h = new Handle('notes.org', 'one');
  const p = make({ open: h });
  const path = await p.pickOpen();
  assert.equal(path, 'notes.org');
  const r = await p.read(path);
  assert.deepEqual(r, { text: 'one', version: '1000' });
  const w = await p.write(path, 'two', { baseVersion: r.version });
  assert.deepEqual(w, { ok: true, version: '1001' });
  assert.equal(h.text, 'two');
  h.text = 'changed outside'; h.mtime = 5000;
  const stale = await p.write(path, 'three', { baseVersion: '1001' });
  assert.deepEqual(stale, { ok: false, conflict: { theirs: 'changed outside', theirsVersion: '5000' } });
  assert.equal(h.text, 'changed outside');
});

test('the same file picked twice is one name; a different file with the same name gets <2>', async () => {
  const a = new Handle('n.org'); const b = new Handle('n.org');
  let next = a;
  const p = make({ env: { showOpenFilePicker: async () => [next] } });
  assert.equal(await p.pickOpen(), 'n.org');
  assert.equal(await p.pickOpen(), 'n.org');
  next = b;
  assert.equal(await p.pickOpen(), 'n.org<2>');
  assert.deepEqual(await p.list(), ['n.org', 'n.org<2>']);
  assert.deepEqual(await p.entries('n.org<'), [{ path: 'n.org<2>', size: null }]);
});

test('a cancelled picker gives null, and an unsupported browser says so', async () => {
  const p = make({ env: { showOpenFilePicker: async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); } } });
  assert.equal(await p.pickOpen(), null);
  const none = createDeviceProvider({ kv: createMemoryKv(), env: {} });
  await assert.rejects(none.pickOpen(), CapabilityUnavailable);
});

test('permission is asked for again, and refusing stops the read and the write', async () => {
  const h = new Handle('n.org', 'x');
  const p = make({ open: h });
  const path = await p.pickOpen();
  h.granted = 'prompt';
  await assert.rejects(p.read(path), CapabilityUnavailable);
  await assert.rejects(p.write(path, 'y', { baseVersion: '1000' }), CapabilityUnavailable);
  assert.equal(h.asked, 2);
  assert.equal(h.text, 'x');
});

test('save as: the picked new file reads empty and takes the first write', async () => {
  const h = new Handle('new.org', '');
  const p = make({ save: h });
  const path = await p.pickSave('new.org');
  const r = await p.read(path);
  assert.equal(r.text, '');
  assert.equal((await p.write(path, 'hello', { baseVersion: r.version })).ok, true);
  assert.equal(h.text, 'hello');
});

test('unknown names read as missing, write throws, and remove is not offered', async () => {
  const p = make({ open: new Handle('a.org') });
  assert.equal(await p.read('nope.org'), null);
  await assert.rejects(p.write('nope.org', 'x'), /not picked/);
  await assert.rejects(p.remove('nope.org'), CapabilityUnavailable);
});
