// Offline cache. The version below must equal package.json's version (a test checks this),
// so every release gets a new cache and replaces the old one.
const VERSION = '0.11.6';
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
  'app/storage/device.js',
  'app/storage/github.js',
  'app/storage/kv-idb.js',
  'app/storage/local.js',
  'app/storage/webdav.js',
  'app/storage/xml.js',
  'app/ui/config.js',
  'app/ui/dom.js',
  'app/ui/find.js',
  'app/ui/keyrow.js',
  'app/ui/keys.js',
  'app/ui/history.js',
  'app/ui/minibuffer.js',
  'app/ui/outline-view.js',
  'app/ui/providers.js',
  'app/ui/recent.js',
  'app/ui/session.js',
  'app/ui/update.js',
  'app/ui/viewport.js',
  'app/version.js',
  'core/bytes.js',
  'core/names.js',
  'core/agenda.js',
  'core/agenda-filter.js',
  'core/diary.js',
  'core/contacts.js',
  'core/holidays.js',
  'core/solar.js',
  'examples/clocking.org',
  'examples/capture.org',
  'examples/agenda-birthdays.org',
  'examples/tables.org',
  'examples/config.org',
  'examples/contacts.org',
  'examples/dates.org',
  'examples/diary.org',
  'examples/outline.org',
  'examples/project.org',
  'examples/refile-archive.org',
  'examples/search-replace.org',
  'examples/weekly-review.org',
  'core/body.js',
  'core/calendar.js',
  'core/capture.js',
  'core/refile.js',
  'core/lisp-read.js',
  'core/clock.js',
  'core/effort.js',
  'core/lisp-list.js',
  'core/outline-edit.js',
  'core/table.js',
  'core/universal.js',
  'core/prefix.js',
  'core/lines.js',
  'core/killring.js',
  'core/motion.js',
  'core/properties.js',
  'core/regexp.js',
  'core/replace.js',
  'core/sparse.js',
  'core/timestamp.js',
  'core/outline.js',
  'core/parse.js',
  'core/projection.js',
  'core/settings-file.js',
  'app/storage/timeout.js',
  'core/calc.js',
  'core/tblfm.js',
  'core/tblcmd.js',
  'core/tblexport.js',
  'core/init.js',
  'core/subtree.js',
  'core/orgmarkup.js',
  'core/entities.js',
  'core/datetree.js',
  'core/extra-menu.js',
  'core/elisp.js',
  'core/plot.js',
  'core/units.js',
  'core/tblisp.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k.startsWith('serita-') && k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// A new version waits until the page asks it to take over (the user chose Restart).
self.addEventListener('message', (event) => {
  if (event.data?.type === 'version') event.ports[0].postMessage(VERSION);
  else if (event.data?.type === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit ?? fetch(req)));
});
