// Appearance, tag column, heading swipe and session restore, in headless Chrome.
import { start } from './harness.mjs';

const { base, browser, close } = await start();
let failed = 0;
const ok = (c, m) => { console.log(`${c ? 'ok    ' : 'FAIL  '}appearance: ${m}`); if (!c) failed++; };
const ctx = await browser.newContext({ viewport: { width: 390, height: 800 }, colorScheme: 'light' });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${base}/`);
await page.waitForSelector('.tab.current');
const sheet = page.locator('.sheet');
const btn = (name) => sheet.getByRole('button', { name, exact: true });
const css = (sel, prop) => page.evaluate(([s, p]) => getComputedStyle(document.querySelector(s))[p], [sel, prop]);

ok((await css('#editor', 'fontSize')) === '18px', 'the text is 18px by default');
ok(await page.evaluate(() => document.documentElement.dataset.theme) === 'light', 'System follows a light device');
await page.emulateMedia({ colorScheme: 'dark' });
await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark').catch(() => {});
ok(await page.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'System follows a dark device');
await page.emulateMedia({ colorScheme: 'light' });

await page.click('#btn-menu'); await btn('Settings').click(); await sheet.getByRole('button', { name: /Appearance/ }).click();
await btn('Dark').click();
ok(await page.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'choosing Dark switches the theme');
await btn('Light').click();
ok(await page.evaluate(() => document.documentElement.dataset.theme) === 'light', 'choosing Light switches it back');
await btn('Font size larger').click();
ok((await css('#editor', 'fontSize')) === '19px', 'the size stepper changes the text size');
await btn('Paragraph spacing larger').click();
ok((await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--ps').trim())) === '11px', 'the paragraph spacing stepper changes the gap');
await btn('‹ Settings').click();
await btn('Close').click();

// Heading swipe
await page.evaluate(() => document.getElementById('editor').focus());
await page.fill('#editor', '* One\nbody\n** Sub\n');
await page.click('#btn-view'); await btn('Outline').click();
const head = page.locator('.ol-head').first();
const box = await head.boundingBox();
const before = await page.locator('.ol-line').count();
await page.mouse.move(box.x + box.width - 20, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + 20, box.y + box.height / 2, { steps: 6 });
await page.mouse.up();
ok((await page.locator('.ol-line').count()) !== before, 'swiping a heading right to left changes what is shown, like TAB');

// Restore
await page.waitForTimeout(700);
await page.reload();
await page.waitForSelector('.tab.current');
ok((await page.locator('.tab').count()) === 1, 'a reload reopens the tabs');
await page.click('#btn-view'); await btn('Text').click();
ok((await page.locator('#editor').inputValue()) === '* One...\n', 'and the unsaved text and the fold come back');

ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join('; ') : ''}`);
await close();
process.exit(failed ? 1 : 0);
