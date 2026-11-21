// Builds the storage providers from the saved settings. GitHub and WebDAV are wrapped in the
// offline cache; each cache is kept per repository or server, so changing the repository never
// shows another one's files. The map is updated in place because the app interface reads it on every call.

import { createLocalProvider } from '../storage/local.js';
import { createGithubProvider } from '../storage/github.js';
import { createWebdavProvider } from '../storage/webdav.js';
import { createCachedProvider } from '../storage/cached.js';
import { createDeviceProvider } from '../storage/device.js';
import { openIdbKv } from '../storage/kv-idb.js';

const slug = (s) => s.replace(/[^A-Za-z0-9._-]+/g, '_');

/**
 * @param {{ config: ReturnType<import('./config.js').createConfig>, indexedDB: IDBFactory, env: any, isOnline: () => boolean }} opts
 * @returns {Promise<{ providers: Record<string, any>, rebuild: () => Promise<void> }>}
 */
export async function createProviders({ config, indexedDB, env, isOnline }) {
  const providers = {
    local: createLocalProvider(await openIdbKv({ indexedDB, name: 'serita-local' })),
    device: createDeviceProvider({ kv: await openIdbKv({ indexedDB, name: 'serita-device' }), env }),
  };
  async function rebuild() {
    delete providers.github;
    delete providers.webdav;
    const s = config.settings();
    if (config.githubReady()) {
      const branch = s['github.branch'] || 'main';
      const remote = createGithubProvider({
        owner: s['github.owner'], repo: s['github.repo'], branch,
        getToken: async () => config.secrets()['github.token'],
      });
      const cache = await openIdbKv({ indexedDB, name: `serita-cache-github-${slug(`${s['github.owner']}-${s['github.repo']}-${branch}`)}` });
      providers.github = createCachedProvider({ remote, cache, isOnline });
    }
    if (config.webdavReady()) {
      const remote = createWebdavProvider({
        baseUrl: s['webdav.url'],
        getCredentials: async () => ({ username: config.settings()['webdav.username'], password: config.secrets()['webdav.password'] }),
      });
      const cache = await openIdbKv({ indexedDB, name: `serita-cache-webdav-${slug(s['webdav.url'])}` });
      providers.webdav = createCachedProvider({ remote, cache, isOnline });
    }
  }
  await rebuild();
  return { providers, rebuild };
}
