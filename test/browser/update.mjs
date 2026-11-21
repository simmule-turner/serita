// A new version waits until the user taps Restart: notice, Menu entry, Settings rows, then the reload.
import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const copy = await mkdtemp(join(tmpdir(), 'serita-update-'));
await cp(process.cwd(), copy, { recursive: true, filter: (p) => !p.includes('node_modules') });
process.chdir(copy);
const { start } = await import(join(copy, 'test/browser/harness.mjs'));

const { base, browser, close } = await start();
const now = JSON.parse(await readFile('package.json', 'utf8')).version;
const next = '99.0.0';
let failed = 0;
const ok = (c, m) => { console.log(`${c ? 'ok    ' : 'FAIL  '}update: ${m}`); if (!c) failed++; };
const page = await (await browser.newContext()).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${base}/`);
await page.waitForSelector('.tab.current');
await page.evaluate(() => navigator.serviceWorker.ready);
await page.reload();
await page.waitForFunction(() => navigator.serviceWorker.controller);
const sheet = page.locator('.sheet');

await page.click('#btn-menu');
ok(!(await sheet.textContent()).includes('Restart to update'), 'no Restart entry while the app is current');
await sheet.getByRole('button', { name: 'Cancel' }).click();

for (const f of ['sw.js', 'app/version.js']) await writeFile(f, (await readFile(f, 'utf8')).replace(`'${now}'`, `'${next}'`));
await page.evaluate(() => window.__serita.look());
await page.waitForFunction(() => document.getElementById('message').textContent.startsWith('Version 99.0.0 is ready'));
ok(true, 'the message line says a new version is ready');
ok((await page.evaluate(() => navigator.serviceWorker.controller.scriptURL)).endsWith('sw.js'), 'the running version keeps running');

await page.click('#btn-menu');
ok((await sheet.textContent()).includes(`${now} to ${next}`), 'Menu offers Restart to update with both versions');
await sheet.getByRole('button', { name: 'Cancel' }).click();
await page.click('#btn-menu'); await sheet.getByRole('button', { name: 'Settings' }).click();
const t = await sheet.textContent();
ok(t.includes(`Installed version${now}`) && t.includes(`New version${next}`), 'Settings shows the installed and the new version');
await sheet.getByRole('button', { name: 'Close' }).click();

await page.click('#btn-menu');
await Promise.all([page.waitForEvent('load'), sheet.getByRole('button', { name: /Restart to update/ }).click()]);
await page.waitForSelector('.tab.current');
await page.click('#btn-menu'); await sheet.getByRole('button', { name: 'Settings' }).click();
const t2 = await sheet.textContent();
ok(t2.includes(`Installed version${next}`) && !t2.includes('New version'), 'after Restart the new version is installed');
ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join('; ') : ''}`);
await close();
process.exit(failed ? 1 : 0);
