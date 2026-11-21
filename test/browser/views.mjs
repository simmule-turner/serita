// The Outline view, folding in the Text view, the Emacs keys and the key row, in headless Chrome.
import { start } from './harness.mjs';

const { base, browser, close } = await start();
let failed = 0;
const ok = (c, m) => { console.log(`${c ? 'ok    ' : 'FAIL  '}views: ${m}`); if (!c) failed++; };
const page = await (await browser.newContext({ viewport: { width: 390, height: 800 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${base}/`);
await page.waitForSelector('.tab.current');
const sheet = page.locator('.sheet');
const btn = (name) => sheet.getByRole('button', { name, exact: true });
const msg = () => page.locator('#message').textContent();
const value = () => page.locator('#editor').inputValue();
const caretAt = (needle) => page.evaluate((n) => { const e = document.getElementById('editor'); const i = e.value.indexOf(n); e.setSelectionRange(i, i); }, needle);
const view = async (name) => { await page.click('#btn-view'); await btn(name).click(); };

await page.fill('#editor', '#+TITLE: t\n* TODO A\nbody\n** B\nb body\n* D\n');
await view('Outline');
ok((await page.locator('.ol-head').count()) === 3, 'the Outline view lists the three headings');
ok((await page.locator('.ol-line').allTextContents()).some((t) => t.includes('b body')), 'the text under an open heading is shown');
ok((await page.locator('#modeline').textContent()).includes('Outline'), 'the mode line names the view');

await page.locator('.ol-head').first().locator('.chev').click();
ok((await msg()) === 'FOLDED' && (await page.locator('.ol-head').count()) === 2, 'tapping the chevron folds the subtree and says FOLDED');
ok((await page.locator('.ol-head .dots').count()) === 1, 'a folded heading shows an ellipsis');

await view('Text');
ok((await value()).includes('* TODO A...') && !(await value()).includes('body'), 'the Text view shows the same fold, with "..." after the heading');
await caretAt('* D'); await page.evaluate(() => { const e = document.getElementById('editor'); e.setSelectionRange(e.value.indexOf('* D') + 3, e.value.indexOf('* D') + 3); });
await page.locator('#editor').press('x');
ok((await value()).includes('* Dx') && (await value()).includes('* TODO A...'), 'typing in the Text view keeps the fold');
await view('Outline');
ok((await page.locator('.ol-head .title').allTextContents()).includes('Dx'), 'the edit is in the document the Outline view shows');

await page.locator('.ol-head .title').first().click();
ok((await sheet.textContent()).includes('Promote subtree') && (await sheet.textContent()).includes('TODO to DONE'), 'tapping a heading opens its actions');
await btn(/Change TODO state/).click();
ok((await page.locator('.ol-head .st').first().textContent()) === 'DONE', 'Change TODO state moves TODO to DONE');

await page.locator('.ol-head .title').nth(1).click();
await btn('Move up').click();
ok((await page.locator('.ol-head .title').allTextContents())[0] === 'Dx', 'Move up moves the subtree above its sibling');

await page.locator('.ol-head .title').first().click();
await btn('Edit in Text view').click();
ok((await page.locator('#editor').isVisible()) && (await value()).startsWith('#+TITLE: t\n* Dx'), 'Edit in Text view switches to the text');

// Emacs keys and the key row
ok(!(await page.locator('#keyrow').isVisible()), 'the key row is hidden while Emacs keys are off');
await page.click('#btn-menu'); await btn('Settings').click(); await btn(/Emacs keys/).click();
await btn('Close').click();
ok(await page.locator('#keyrow').isVisible(), 'Emacs keys on shows the key row');
ok((await page.locator('#keyrow button').allTextContents()).join(',') === 'Meta,Ctrl,Shift,Tab,←,↑,↓,→,⌨,Float', 'the key row has the keys in order, with the keyboard and Float buttons last');

await page.evaluate(() => document.getElementById('editor').blur());
await caretAt('* TODO A');
await page.locator('#keyrow button', { hasText: 'Tab' }).click();
ok(await page.evaluate(() => document.activeElement !== document.getElementById('editor')), 'pressing a key-row button does not bring up the keyboard');
const afterTab = await msg();
ok(['FOLDED', 'CHILDREN', 'SUBTREE'].includes(afterTab) || afterTab === 'Not at a heading', `Tab on the key row runs the command (${afterTab})`);

await page.locator('#keyrow button', { hasText: 'Meta' }).click();
ok((await page.locator('#keyrow button.on').count()) === 1, 'Meta stays down until the next key');
await page.locator('#keyrow button', { hasText: '↓' }).click();
ok((await page.locator('#keyrow button.on').count()) === 0, 'the next key releases it');

await page.locator('#editor').focus();
await page.keyboard.press('Shift+Tab');
ok((await msg()) === 'OVERVIEW', 'S-TAB cycles the whole buffer and says OVERVIEW');
await page.keyboard.press('Shift+Tab');
ok((await msg()) === 'CONTENTS', 'S-TAB again says CONTENTS');
await page.keyboard.press('Shift+Tab');
ok((await msg()) === 'SHOW ALL' && (await value()).includes('b body'), 'S-TAB a third time shows everything');

await page.keyboard.press('Control+c');
ok((await msg()) === 'C-c-', 'C-c shows the pending prefix in the message line');
await page.keyboard.press('Control+g');
ok((await msg()) === 'Quit', 'C-g quits the prefix');

await page.locator('#keyrow button', { hasText: 'Float' }).click();
ok((await page.locator('#keyrow.float').count()) === 1 && (await page.locator('#keyrow button', { hasText: 'Dock' }).count()) === 1, 'Float makes the keys a floating panel');
const box = await page.locator('#keyrow').boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + 4); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 - 60, box.y - 80, { steps: 4 }); await page.mouse.up();
const moved = await page.locator('#keyrow').boundingBox();
ok(Math.abs(moved.x - box.x) > 30 && moved.y < box.y - 40, 'the floating panel can be dragged');
await page.locator('#keyrow button', { hasText: 'Dock' }).click();
ok((await page.locator('#keyrow.float').count()) === 0, 'Dock puts the row back above the mode line');

// Hide leading stars
await page.click('#btn-menu'); await btn('Settings').click(); await btn(/Hide leading stars/).click(); await btn('Close').click();
ok((await value()).includes('\n * B') && !(await value()).includes('** B'), 'Hide leading stars shows only the last star of a deeper heading');

ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join('; ') : ''}`);
await close();
process.exit(failed ? 1 : 0);
