// Browser smoke runner for the small pages in test/browser/*.html.
//   node test/browser/run.mjs [page ...]
import { start } from './harness.mjs';

const pages = process.argv.slice(2).length ? process.argv.slice(2) : ['idb'];
const { base, browser, close } = await start();
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
await close();
process.exit(failed ? 1 : 0);
