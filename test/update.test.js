import { test } from 'node:test';
import assert from 'node:assert/strict';
import { askVersion, watchUpdates } from '../app/ui/update.js';

function fakeRegistration(waiting = null) {
  const listeners = {};
  return { waiting, installing: null, addEventListener: (t, f) => { listeners[t] = f; }, fire: (t) => listeners[t]() };
}
const fakeWorker = () => { const l = {}; return { state: 'installing', addEventListener: (t, f) => { l[t] = f; }, set(s) { this.state = s; l.statechange(); } }; };

test('a worker already waiting is reported when an older one is in control', () => {
  const found = [];
  watchUpdates(fakeRegistration('w'), { controller: {} }, (w) => found.push(w));
  assert.deepEqual(found, ['w']);
});

test('nothing is reported on the first install, when no older worker is in control', () => {
  const found = [];
  watchUpdates(fakeRegistration('w'), { controller: null }, (w) => found.push(w));
  assert.deepEqual(found, []);
});

test('a worker that finishes installing later is reported once', () => {
  const found = [];
  const reg = fakeRegistration();
  watchUpdates(reg, { controller: {} }, (w) => found.push(w));
  const w = fakeWorker();
  reg.installing = w;
  reg.fire('updatefound');
  w.set('installing');
  assert.deepEqual(found, []);
  w.set('installed');
  w.set('installed');
  assert.deepEqual(found, [w]);
});

test('askVersion returns what the worker answers on the port', async () => {
  class Channel { constructor() { this.port1 = {}; this.port2 = { reply: (v) => this.port1.onmessage({ data: v }) }; } }
  const worker = { postMessage: (m, [port]) => { assert.equal(m.type, 'version'); port.reply('9.9.9'); } };
  assert.equal(await askVersion(worker, Channel), '9.9.9');
});
