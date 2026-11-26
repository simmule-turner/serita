// A fetch that gives up after a while, so a stalled connection counts as the network being unavailable.

export const REQUEST_TIMEOUT_MS = 8000;

/** @param {number} [ms] @returns {typeof fetch} */
export const fetchWithin = (ms = REQUEST_TIMEOUT_MS) => async (url, init = {}) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try { return await globalThis.fetch(url, { ...init, signal: controller.signal }); } finally { clearTimeout(timer); }
};
