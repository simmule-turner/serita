// Storage names: "provider:path". A bare path means local app storage; device is a file picked on the device.

/** Providers the app knows. A prefix that is not in this list is part of a local path. */
export const PROVIDERS = Object.freeze(['local', 'device', 'github', 'webdav']);

/**
 * @param {string} name
 * @returns {{ provider: string, path: string }}
 */
export function parseName(name) {
  const m = /^([a-z][a-z0-9]*):(.+)$/.exec(name);
  if (m && PROVIDERS.includes(m[1])) return { provider: m[1], path: m[2] };
  return { provider: 'local', path: name };
}

/**
 * @param {string} provider
 * @param {string} path
 * @returns {string}
 */
export function formatName(provider, path) {
  if (!PROVIDERS.includes(provider)) throw new Error(`unknown provider: ${provider}`);
  return `${provider}:${path}`;
}
