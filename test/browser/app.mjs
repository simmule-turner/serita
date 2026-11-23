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
// typing must not redraw the sheet: the field keeps focus (the keyboard stays up) and is the same element
await page.evaluate(() => { const i = document.querySelector('input[aria-label="File name"]'); i.focus(); window.__nameField = i; });
await page.keyboard.type('x'); await page.keyboard.press('Backspace');
ok(await page.evaluate(() => document.activeElement === window.__nameField && document.body.contains(window.__nameField)), 'typing in the Save as name keeps the field and its focus');
await btn('Save').click();
await page.waitForFunction(() => document.getElementById('message').textContent.startsWith('Wrote local:notes.org'));
ok((await page.locator('#modeline').textContent()).includes('notes.org (App storage)'), 'Save as names the buffer and the mode line shows the storage');

await page.click('#btn-files'); await btn('New').click();
await page.click('#btn-files'); await btn('Open').click();
await sheet.getByText('43 B').waitFor();
ok((await sheet.textContent()).includes('notes.org'), 'Open lists the file with its size');
await btn(/notes\.org/).click();
ok((await page.locator('.tab').count()) === 2, 'Open switches to the already open file instead of opening it twice');

await page.click('#btn-files');
ok((await sheet.textContent()).includes('notes.org (App storage)') && (await sheet.textContent()).includes('open'), 'the File sheet lists recent files with their storage and whether they are open');
ok((await page.locator('.sheet .recent').count()) === 1, 'the recent list is its own scrolling area');
await btn('Cancel').click();

await page.evaluate(() => document.getElementById('editor').setSelectionRange(0, 0));
await page.click('#btn-find');
await page.locator('#findbar input').fill('plant');
ok(await page.evaluate(() => { const e = document.getElementById('editor'); return e.value.slice(e.selectionStart, e.selectionEnd) === 'plant'; }), 'Find selects the first match, ignoring case');
ok((await page.locator('#hl mark').textContent()) === 'plant', 'the current match is highlighted');
await page.getByLabel('Next match').click();
ok(await page.evaluate(() => { const e = document.getElementById('editor'); return e.value.slice(e.selectionStart, e.selectionEnd) === 'Plant'; }), 'the down button goes to the next match');
await page.getByLabel('Next match').click();
await page.getByLabel('Next match').click(); // the first one fails, as in Emacs
ok((await page.locator('#findbar .prompt').textContent()) === 'Wrapped I-search:', 'the search wraps and says so in its prompt');
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

// Saves made offline that clash with a newer server copy (a fake WebDAV server answers for dav.test).
const { createFakeWebdav } = await import('../fake-webdav.js');
const dav = createFakeWebdav();
const ctx2 = await browser.newContext();
await ctx2.route('https://dav.test/**', async (route) => {
  const req = route.request();
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': 'etag' };
  if (req.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: cors }); return; }
  const r = await dav.fetch(req.url(), { method: req.method(), headers: await req.allHeaders(), body: req.postData() ?? undefined });
  const etag = r.headers.get('etag');
  await route.fulfill({ status: r.status, headers: { ...cors, ...(etag ? { etag } : {}), 'content-type': 'application/xml' }, body: await r.text() });
});
const p2 = await ctx2.newPage();
p2.on('pageerror', (e) => errors.push(e.message));
await p2.goto(`${base}/`);
await p2.waitForSelector('.tab.current');
const sheet2 = p2.locator('.sheet');
const b2 = (name) => sheet2.getByRole('button', { name, exact: true });
await p2.click('#btn-menu'); await b2('Settings').click(); await sheet2.getByRole('button', { name: 'WebDAV' }).click();
await sheet2.getByLabel('Server address').fill('https://dav.test/dav/');
await sheet2.getByLabel('User name').fill('me');
await sheet2.getByLabel('Password').fill('pw');
await b2('Save').click();
await b2('Close').click();
await p2.fill('#editor', 'base\n');
await p2.click('#btn-files'); await b2('Save as').click();
await sheet2.getByRole('button', { name: /Storage/ }).click();
await sheet2.getByRole('button', { name: /WebDAV/ }).click();
await sheet2.getByLabel('File name').fill('q.org');
await b2('Save').click();
await p2.waitForFunction(() => document.getElementById('message').textContent.startsWith('Wrote webdav:q.org'));
ok(dav.files.get('q.org')?.text === 'base\n', 'a save online reaches the WebDAV server');

await ctx2.setOffline(true);
await p2.fill('#editor', 'mine\n');
await p2.click('#btn-save');
await p2.waitForFunction(() => document.getElementById('message').textContent.includes('offline'));
ok((await p2.locator('#modeline').textContent()).includes('1 to send'), 'the mode line says one save is waiting to be sent');
dav.setRaw('q.org', 'theirs\n');
await ctx2.setOffline(false);
await sheet2.getByText('Saves that could not be sent').waitFor();
ok((await sheet2.textContent()).includes('q.org (WebDAV)'), 'coming back online lists the clashing file');
await sheet2.getByRole('button', { name: /q\.org/ }).click();
await b2('Keep mine').click();
await p2.waitForFunction(() => document.getElementById('message').textContent.startsWith('Settled'));
ok(dav.files.get('q.org')?.text === 'mine\n', 'Keep mine sends the offline copy to the server');
ok(!(await p2.locator('#modeline').textContent()).includes('to send'), 'the waiting marker goes away');


// Device files in a browser without the file picker: the sheet says so instead of doing nothing.
const ctx3 = await browser.newContext();
await ctx3.addInitScript(() => { delete window.showOpenFilePicker; delete window.showSaveFilePicker; });
const p3 = await ctx3.newPage();
p3.on('pageerror', (e) => errors.push(e.message));
await p3.goto(`${base}/`);
await p3.waitForSelector('.tab.current');
const sheet3 = p3.locator('.sheet');
await p3.click('#btn-files'); await sheet3.getByRole('button', { name: 'Open', exact: true }).click();
await sheet3.getByRole('button', { name: /Storage/ }).click();
await sheet3.getByRole('button', { name: /Device files/ }).click();
await sheet3.getByText('cannot open and save files on the device').waitFor();
ok(true, 'Device files says plainly when the browser has no file picker');

// Open starts in the folder of the last file saved or opened, not at the root of App storage
const p4 = await (await browser.newContext()).newPage();
p4.on('pageerror', (e) => errors.push(e.message));
await p4.goto(`${base}/`);
await p4.waitForSelector('.tab.current');
const sheet4 = p4.locator('.sheet');
await p4.fill('#editor', 'x\n');
await p4.click('#btn-files'); await sheet4.getByRole('button', { name: 'Save as', exact: true }).click();
await sheet4.getByLabel('File name').fill('work/plan.org');
await sheet4.getByRole('button', { name: 'Save', exact: true }).click();
await p4.waitForFunction(() => document.getElementById('message').textContent.startsWith('Wrote'));
await p4.click('#btn-files'); await sheet4.getByRole('button', { name: 'New', exact: true }).click();
await p4.click('#btn-files'); await sheet4.getByRole('button', { name: 'Open', exact: true }).click();
ok((await sheet4.locator('.path').textContent()) === 'local:work/', 'Open starts in the folder of the last saved file');

// The first open offers the sample documents once; they open as unsaved tabs, and File offers them again
const ctx5 = await browser.newContext({ firstRun: true });
const p5 = await ctx5.newPage();
await p5.goto(`${base}/`);
const sheet5 = p5.locator('.sheet');
await sheet5.getByText('Sample documents').first().waitFor();
ok((await sheet5.getByRole('button', { name: /Weekly review/ }).count()) === 1 && (await sheet5.getByRole('button', { name: 'Start empty', exact: true }).count()) === 1, 'the first open lists the examples and Start empty');
await sheet5.getByRole('button', { name: /Weekly review/ }).click();
await p5.waitForSelector('.tab.current');
ok((await p5.locator('.tab.current').textContent()).includes('weekly-review.org') && (await p5.locator('#editor').inputValue()).includes('#+TITLE: Weekly review'), 'choosing an example opens it as a new tab');
await p5.reload();
await p5.waitForSelector('.tab.current');
ok((await p5.locator('.sheet').count()) === 0, 'the examples are offered only the first time');
await p5.click('#btn-files'); await sheet5.getByRole('button', { name: 'Sample documents', exact: true }).click();
ok((await sheet5.getByRole('button', { name: /Outline and folding/ }).count()) === 1, 'File lists the sample documents');
await ctx5.close();


ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join('; ') : ''}`);
await close();
process.exit(failed ? 1 : 0);
