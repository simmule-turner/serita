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

await page.evaluate(() => document.activeElement.blur());
await tool('Larger text').click(); await tool('Smaller text').click(); await tool('Line numbers').click(); await tool('Line numbers').click();
ok((await page.evaluate(() => document.activeElement.id)) !== 'editor', 'pressing tool buttons does not focus the text, so the keyboard stays down');
await tool('Larger text').click();
ok((await page.evaluate(() => getComputedStyle(document.getElementById('editor')).fontSize)) === '19px', 'Larger text makes the text 19px');
await tool('Smaller text').click(); await tool('Smaller text').click();
ok((await page.evaluate(() => getComputedStyle(document.getElementById('editor')).fontSize)) === '17px', 'Smaller text makes it 17px');

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
await page.locator('#findbar input').fill('3'); // the Text view asks in the minibuffer
await page.keyboard.press('Enter');
ok((await page.evaluate(() => document.getElementById('editor').selectionStart)) === 8, 'Go to line puts the cursor at the start of line 3');

await tool('Undo').click();
ok((await value()) === 'one\ntwo\ntwo\nthree\n', 'Undo brings back the deleted line');
await tool('Redo').click();
ok((await value()) === 'one\ntwo\nthree\n', 'Redo deletes it again');

const fixed = await page.evaluate(() => {
  window.scrollTo(0, 500);
  const d = document.scrollingElement;
  return { y: window.scrollY, over: d.scrollHeight - d.clientHeight, top: document.getElementById('toolbar').getBoundingClientRect().top };
});
ok(fixed.y === 0 && fixed.over <= 0 && fixed.top === 0, 'the page itself never scrolls, so the bars stay put');

// A menu over an open keyboard: focus stays in the text, and the x stays on screen when the space is short
await page.evaluate(() => document.getElementById('editor').focus());
await page.setViewportSize({ width: 390, height: 360 });
await tool('Lines and text').click();
const cancel = await page.locator('.sheet').getByLabel('Dismiss').boundingBox();
ok(cancel !== null && cancel.y + cancel.height <= 360, 'the x stays on screen in a short window');
ok((await page.evaluate(() => document.activeElement.id)) === 'editor', 'opening the menu leaves the focus in the text');
await page.locator('.sheet').getByLabel('Dismiss').click();
ok((await page.evaluate(() => document.activeElement.id)) === 'editor', 'closing it leaves the focus in the text');
await page.setViewportSize({ width: 390, height: 800 });

await page.click('#btn-menu'); await btn('Settings').click(); await btn(/Tool row in the Text view/).click(); await btn('Close').click();
ok(await page.locator('#tools').isHidden(), 'the Text view tool row can be hidden');
await page.click('#btn-menu'); await btn('Settings').click(); await btn(/Tool row in the Text view/).click(); await btn('Close').click();
ok(await page.locator('#tools').isVisible(), 'and shown again');

await page.click('#btn-view'); await btn('Outline').click();
ok(await page.locator('#tools').isHidden(), 'the Outline view has no tool row until it is turned on');
await page.click('#btn-menu'); await btn('Settings').click(); await btn(/Tool row in the Outline view/).click(); await btn('Close').click();
ok(!(await page.locator('#tools').textContent()).includes('null'), 'no stray text in the Outline row');
ok((await page.locator('#tools button').count()) === 4, 'the Outline view keeps Undo, Redo and the two size buttons');

ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join('; ') : ''}`);
await close();
process.exit(failed ? 1 : 0);
