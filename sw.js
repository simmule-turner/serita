// Offline cache. The version below must equal package.json's version (a test checks this),
// so every release gets a new cache and replaces the old one.
const VERSION = '0.1.0';
const CACHE = `serita-${VERSION}`;
const FILES = [
  './',
  'index.html',
  'app.css',
  'manifest.webmanifest',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'app/main.js',
  'app/interface/browser.js',
  'app/interface/contract.js',
  'app/storage/browse.js',
  'app/storage/cached.js',
  'app/storage/conflict.js',
  'app/storage/github.js',
  'app/storage/kv-idb.js',
  'app/storage/local.js',
  'app/storage/webdav.js',
  'app/storage/xml.js',
  'app/ui/config.js',
  'app/ui/find.js',
  'app/ui/providers.js',
  'app/ui/session.js',
  'core/bytes.js',
  'core/names.js',
  'core/parse.js',
  'core/settings-file.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('serita-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit ?? fetch(req)));
});
