import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRecent, MAX_RECENT } from '../app/ui/recent.js';

const store = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; };

test('newest first, a repeat moves to the front, remove and clear work', () => {
  const r = createRecent(store());
  assert.deepEqual(r.list(), []);
  r.add('local:a.org'); r.add('github:b.org'); r.add('local:a.org');
  assert.deepEqual(r.list(), ['local:a.org', 'github:b.org']);
  r.remove('github:b.org');
  assert.deepEqual(r.list(), ['local:a.org']);
  r.clear();
  assert.deepEqual(r.list(), []);
});

test('keeps at most 20, dropping the oldest', () => {
  assert.equal(MAX_RECENT, 20);
  const r = createRecent(store());
  for (let i = 1; i <= 25; i++) r.add(`local:${i}.org`);
  assert.equal(r.list().length, 20);
  assert.equal(r.list()[0], 'local:25.org');
  assert.equal(r.list()[19], 'local:6.org');
});

test('the list survives a new instance on the same storage', () => {
  const s = store();
  createRecent(s).add('local:a.org');
  assert.deepEqual(createRecent(s).list(), ['local:a.org']);
});
