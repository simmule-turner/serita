import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runContract } from './contract.js';
import { createMemoryInterface } from '../app/interface/memory.js';
import { CapabilityUnavailable } from '../app/interface/contract.js';

runContract('memory', () => createMemoryInterface());

test('memory: injected clock and time zone', () => {
  const i = createMemoryInterface({ now: () => new Date('2026-03-08T12:00:00Z'), timeZone: 'America/New_York' });
  assert.equal(i.clock.now().toISOString(), '2026-03-08T12:00:00.000Z');
  assert.equal(i.clock.timeZone(), 'America/New_York');
});

test('memory: turning a capability off reports it and makes calls throw', async () => {
  const i = createMemoryInterface({ available: { notify: false } });
  assert.equal(i.capabilities().notify.available, false);
  await assert.rejects(i.notify.schedule({ id: 'a', at: new Date(), title: 't' }), CapabilityUnavailable);
});

test('memory: scheduling a notification twice with one id keeps one', async () => {
  const i = createMemoryInterface();
  await i.notify.schedule({ id: 'a', at: new Date(0), title: 'one' });
  await i.notify.schedule({ id: 'a', at: new Date(1), title: 'two' });
  assert.equal(i._log.notifications.length, 1);
  assert.equal(i._log.notifications[0].title, 'two');
  await i.notify.cancel('a');
  assert.equal(i._log.notifications.length, 0);
});
