import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithin } from '../app/storage/timeout.js';

test('a request that does not answer in time is given up on, and one that does is passed through', async () => {
  const real = globalThis.fetch;
  try {
    globalThis.fetch = (url, { signal }) => new Promise((resolve, reject) => {
      if (url === 'fast') resolve('ok');
      else signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
    assert.equal(await fetchWithin(20)('fast'), 'ok');
    await assert.rejects(fetchWithin(20)('slow'), { name: 'AbortError' });
  } finally { globalThis.fetch = real; }
});
