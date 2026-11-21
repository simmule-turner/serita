// Drives the real app in headless Chrome: tabs, Save as, Open, Find, Settings export and import,
// and offline use through the service worker.
import { readFile } from 'node:fs/promises';
import { start } from './harness.mjs';

const { base, browser, close } = await start();
let failed = 0;
const ok = (c, m) => { console.log(`${c ? 'ok    ' : 'FAIL  '}app: ${m}`); if (!c) failed++; };
const context = await browser.newContext({ acceptDownloads: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${base}/`);
await page.waitForSelector('.tab.current');
const sheet = page.locator('.sheet');
const btn = (name) => sheet.getByRole('button', { name, exact: true });

ok((await page.locator('.tab.current .title').textContent()) === '*scratch*', 'starts with a *scratch* tab');
await page.fill('#editor', '* Notes\n  Buy plant food\n  Water the Plant\n');
ok((await page.locator('#modeline').textContent()).startsWith('**'), 'mode line shows the buffer is modified');

await page.click('#btn-files'); await btn('Save as').click();
await sheet.getByLabel('File name').fill('notes.org');
await btn('Save').click();
await page.waitForFunction(() => document.getElementById('message').textContent.startsWith('Wrote local:notes.org'));
ok((await page.locator('#modeline').textContent()).includes('notes.org (Local)'), 'Save as names the buffer and the mode line shows the storage');

await page.click('#btn-files'); await btn('New').click();
await page.click('#btn-files'); await btn('Open').click();
await sheet.getByText('43 B').waitFor();
ok((await sheet.textContent()).includes('notes.org'), 'Open lists the file with its size');
await btn(/notes\.org/).click();
ok((await page.locator('.tab').count()) === 2, 'Open switches to the already open file instead of opening it twice');

await page.click('#btn-files');
ok((await sheet.textContent()).includes('notes.org (Local)') && (await sheet.textContent()).includes('open'), 'the File sheet lists recent files with their storage and whether they are open');
ok((await page.locator('.sheet .recent').count()) === 1, 'the recent list is its own scrolling area');
await btn('Cancel').click();

await page.click('#btn-find');
await page.locator('#findbar input').fill('plant');
ok(await page.evaluate(() => { const e = document.getElementById('editor'); return e.value.slice(e.selectionStart, e.selectionEnd) === 'plant'; }), 'Find selects the first match, ignoring case');
ok((await page.locator('#hl mark').textContent()) === 'plant', 'the current match is highlighted');
await page.getByLabel('Next match').click();
ok(await page.evaluate(() => { const e = document.getElementById('editor'); return e.value.slice(e.selectionStart, e.selectionEnd) === 'Plant'; }), 'the down button goes to the next match');
await page.getByLabel('Next match').click();
ok((await page.locator('#message').textContent()) === 'Wrapped', 'the search wraps and says so');
await page.getByLabel('Cancel search').click();
ok(await page.locator('#findbar').isHidden(), 'the x button closes the search');

await page.click('#btn-menu'); await btn('Settings').click();
await sheet.getByRole('button', { name: 'GitHub' }).click();
await sheet.getByLabel('Owner').fill('me'); await sheet.getByLabel('Repository').fill('notes');
await sheet.getByLabel('Access token').fill('tok-123');
await btn('Save').click();
await btn('Export').click();
await sheet.getByLabel('Passphrase').fill('pw');
const [dl] = await Promise.all([page.waitForEvent('download'), btn('Export').click()]);
const exported = await readFile(await dl.path(), 'utf8');
ok(/^serita-settings-\d{4}-\d\d-\d\d\.org$/.test(dl.suggestedFilename()) && !exported.includes('tok-123') && exported.includes('begin_encrypted'), 'Export downloads a dated Org file with the token encrypted');

await page.evaluate(() => localStorage.clear());
await page.reload();
await page.waitForSelector('.tab.current');
await page.setInputFiles('#import-file', { name: 'settings.org', mimeType: 'text/plain', buffer: Buffer.from(exported) });
await sheet.getByLabel('Passphrase').fill('wrong');
await btn('Import').click();
await sheet.getByText('does not open this file').waitFor();
ok(await page.evaluate(() => localStorage.getItem('serita.secrets') === null), 'a wrong passphrase is refused and nothing changes');
await sheet.getByLabel('Passphrase').fill('pw');
await btn('Import').click();
await page.waitForFunction(() => document.getElementById('message').textContent.startsWith('Settings imported'));
ok(await page.evaluate(() => JSON.parse(localStorage.getItem('serita.secrets'))['github.token'] === 'tok-123'), 'Import restores the token on this device');

await page.evaluate(() => navigator.serviceWorker.ready);
await page.reload();
await page.evaluate(() => navigator.serviceWorker.ready);
await context.setOffline(true);
await page.reload();
await page.waitForSelector('.tab.current');
ok(true, 'the app starts offline from the service worker cache');
ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join('; ') : ''}`);
await close();
process.exit(failed ? 1 : 0);
