import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';

const read = (p) => readFileSync(p, 'utf8');
const sw = read('sw.js');
const listed = new Set([...sw.slice(sw.indexOf('const FILES')).matchAll(/^\s+'([^']+)',$/gm)].map((m) => m[1]));
const version = JSON.parse(read('package.json')).version;

function graph(entry, seen = new Set()) {
  if (seen.has(entry)) return seen;
  seen.add(entry);
  for (const m of read(entry).matchAll(/^import[^;]*?from\s+'(\.[^']+)'/gms)) graph(normalize(join(dirname(entry), m[1])), seen);
  return seen;
}

test('the cache version equals the package version and app/version.js', () => {
  assert.equal(/VERSION = '([^']+)'/.exec(read('app/version.js'))[1], version);
  assert.equal(/const VERSION = '([^']+)'/.exec(sw)[1], version);
});

test('every module the app imports is cached, and every cached file exists', () => {
  const need = [...graph('app/main.js')].map((p) => relative('.', p));
  for (const f of need) assert.ok(listed.has(f), `${f} is imported but not in sw.js`);
  for (const f of listed) if (f !== './') assert.doesNotThrow(() => readFileSync(f), `${f} is cached but missing`);
});

test('the page, style, manifest and icons the manifest names are cached', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'));
  for (const f of ['index.html', 'app.css', 'manifest.webmanifest', ...manifest.icons.map((i) => i.src)]) assert.ok(listed.has(f), `${f} not cached`);
  const html = read('index.html');
  for (const m of html.matchAll(/(?:href|src)="([^"#]+)"/g)) assert.ok(listed.has(m[1]), `${m[1]} used by index.html is not cached`);
});
