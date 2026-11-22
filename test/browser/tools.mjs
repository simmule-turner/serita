// The tool row under the tabs and the Lines and text menu, in headless Chrome.
import { start } from './harness.mjs';

const { base, browser, close } = await start();
let failed = 0;
const ok = (c, m) => { console.log(`${c ? 'ok    ' : 'FAIL  '}tools: ${m}`); if (!c) failed++; };
const page = await (await browser.newContext({ viewport: { width: 390, height: 800 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${base}/`);
await page.waitForSelector('.tab.current');
const sheet = page.locator('.sheet');
const btn = (name) => sheet.getByRole('button', { name, exact: true });
const tool = (name) => page.locator('#tools').getByRole('button', { name, exact: true });
const value = () => page.locator('#editor').inputValue();
const msg = () => page.locator('#message').textContent();

ok((await page.locator('#tools button').count()) === 7, 'the row has seven buttons in the Text view');
await page.fill('#editor', 'one\ntwo\nthree\n');
await page.evaluate(() => { const e = document.getElementById('editor'); e.setSelectionRange(5, 5); });

await tool('Larger text').click();
ok((await page.evaluate(() => getComputedStyle(document.getElementById('editor')).fontSize)) === '16px', 'Larger text makes the text 16px');
await tool('Smaller text').click(); await tool('Smaller text').click();
ok((await page.evaluate(() => getComputedStyle(document.getElementById('editor')).fontSize)) === '14px', 'Smaller text makes it 14px');

await tool('Line numbers').click();
ok((await page.locator('.hl-line').evaluateAll((els) => els.map((e) => e.dataset.n))).join() === '1,2,3,4', 'Line numbers shows a number for every line');
await tool('Wrap lines').click();
ok((await page.evaluate(() => document.getElementById('editor').wrap)) === 'off', 'Wrap lines off stops wrapping');

await tool('Lines and text').click();
ok((await sheet.textContent()).includes('Line 2 of 4'), 'the Lines menu says where the cursor is');
await btn(/Duplicate line/).click();
ok((await value()) === 'one\ntwo\ntwo\nthree\n', 'Duplicate line copies the line below itself');
await tool('Lines and text').click(); await btn(/Move line up/).click();
ok((await value()) === 'one\ntwo\ntwo\nthree\n', 'Move line up swaps equal lines (text unchanged)');
await tool('Lines and text').click(); await btn(/Delete line/).click();
ok((await value()) === 'one\ntwo\nthree\n', 'Delete line removes the line');
await tool('Lines and text').click(); await btn(/Go to line/).click();
await sheet.getByLabel('Line number').fill('3');
await btn('Go').click();
ok((await page.evaluate(() => document.getElementById('editor').selectionStart)) === 8, 'Go to line puts the cursor at the start of line 3');

await tool('Undo').click();
ok((await value()) === 'one\ntwo\ntwo\nthree\n', 'Undo brings back the deleted line');
await tool('Redo').click();
ok((await value()) === 'one\ntwo\nthree\n', 'Redo deletes it again');

await page.click('#btn-view'); await btn('Outline').click();
ok((await page.locator('#tools button').count()) === 4, 'the Outline view keeps Undo, Redo and the two size buttons');

ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join('; ') : ''}`);
await close();
process.exit(failed ? 1 : 0);
