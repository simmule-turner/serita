// Browser smoke runner. Serves the repository on localhost and runs test/browser/*.html in
// headless Chrome through Playwright. Playwright is a development tool, not a dependency:
//   PLAYWRIGHT=/path/to/playwright CHROME=/path/to/chrome node test/browser/run.mjs [page ...]
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, join, normalize } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT ?? 'playwright');
const root = process.cwd();
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json' };
const pages = process.argv.slice(2).length ? process.argv.slice(2) : ['idb'];

const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (path.includes('..')) { res.writeHead(400).end(); return; }
  try {
    const body = await readFile(join(root, path));
    res.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ executablePath: process.env.CHROME, headless: true });
let failed = 0;
for (const page of pages) {
  const tab = await browser.newPage();
  await tab.goto(`${base}/test/browser/${page}.html`);
  await tab.waitForFunction('window.__result', null, { timeout: 15000 });
  for (const [pass, msg] of await tab.evaluate('window.__result')) {
    console.log(`${pass ? 'ok    ' : 'FAIL  '}${page}: ${msg}`);
    if (!pass) failed++;
  }
}
await browser.close();
server.close();
process.exit(failed ? 1 : 0);
