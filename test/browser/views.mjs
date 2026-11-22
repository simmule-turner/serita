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

await page.fill('#editor', '#+TITLE: t\n* TODO A\nbody\n** B\nb body\n* D\n- [ ] one\n- [ ] two\n');
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
await btn('Edit title').click();
ok(await page.locator('.sheet textarea').inputValue() === 'Dx', 'Edit title opens a popup holding only the title');
await page.locator('.sheet textarea').fill('Done list');
await page.locator('.sheet textarea').press('Enter');
ok((await page.locator('.ol-head .title').first().textContent()) === 'Done list' && (await page.locator('#editor').isHidden()), 'Enter accepts it, and the Outline view stays');

await page.locator('.ol-head .title').first().click();
await btn('Insert heading below').click();
await page.locator('.sheet textarea').fill('Fresh');
await sheet.getByRole('button', { name: 'OK', exact: true }).click();
ok((await page.locator('.ol-head .title').allTextContents()).includes('Fresh') && (await page.locator('#editor').isHidden()), 'Insert heading below adds a heading from the popup, without leaving the Outline view');

// The heading actions are grouped Text, Structure, Dates and clock, State; Edit body edits the text under the heading
await page.locator('.ol-head .title', { hasText: 'Fresh' }).click();
ok(JSON.stringify(await page.locator('.sheet .group').allTextContents()) === '["Text","Structure","Dates and clock","State"]', 'the heading actions are grouped Text, Structure, Dates and clock, State');
await btn('Edit body').click();
await page.locator('.sheet textarea').fill('first\nsecond');
await sheet.getByRole('button', { name: 'Save', exact: true }).click();
await view('Text');
ok((await value()).includes('Fresh\nfirst\nsecond\n'), 'Edit body writes the text under the heading');
await view('Outline');
await page.locator('.ol-line .box').first().click();
ok((await page.locator('.ol-line .box').first().textContent()) === '[X]', 'tapping a checkbox in the Outline view toggles it');
await view('Text');
ok((await value()).includes('- [X] one') && (await value()).includes('- [ ] two'), 'the Text view shows the same checkbox');

// Emacs keys and the key row
ok(!(await page.locator('#keyrow').isVisible()), 'the key row is hidden while Emacs keys are off');
await page.click('#btn-menu'); await btn('Settings').click(); await btn(/5 settings/).click(); await btn(/Emacs keys/).click(); await btn('‹ Settings').click();
await btn('Close').click();
ok(await page.locator('#keyrow').isVisible(), 'Emacs keys on shows the key row');
ok((await page.locator('#keyrow button').allTextContents()).join(',') === 'Meta,Ctrl,Shift,Tab,←,↑,↓,→,⌨,Float', 'the key row has the keys in order, with the keyboard and Float buttons last');

await page.evaluate(() => document.getElementById('editor').blur());
await caretAt('* DONE A');
await page.locator('#keyrow button', { hasText: 'Tab' }).click();
ok(await page.evaluate(() => document.getElementById('editor').inputMode === 'none'), 'pressing a key-row button does not bring up the keyboard (the text keeps focus with the keyboard disallowed)');
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
ok((await msg()) !== 'C-c-', 'a keyboard\'s own C-c is left alone, so it still copies');
await page.locator('#keyrow button', { hasText: 'Ctrl' }).click();
await page.keyboard.press('c');
ok((await msg()) === 'C-c-', 'Ctrl on the key row, then c, starts the C-c prefix');
await page.keyboard.press('Control+g');
ok((await msg()) === 'Quit', 'C-g quits the prefix');

await caretAt('- [ ] two');
await page.locator('#keyrow button', { hasText: 'Ctrl' }).click(); await page.keyboard.press('c');
await page.locator('#keyrow button', { hasText: 'Ctrl' }).click(); await page.keyboard.press('c');
ok((await value()).includes('- [X] two'), 'C-c C-c from the key row toggles the checkbox at the cursor');

await caretAt('- [X] two');
await page.keyboard.press('Alt+ArrowUp');
ok((await value()).includes('- [X] two\n- [X] one'), 'M-up moves a list item above its neighbor');

await page.keyboard.press('Shift+Tab');
ok((await msg()) === 'OVERVIEW' && !(await value()).includes('b body'), 'S-TAB shows only the top-level headings');
await page.click('#btn-find');
await page.getByLabel('Search', { exact: true }).fill('b body');
ok((await value()).includes('b body'), 'Find opens the fold that hides a match');
await page.getByLabel('Cancel search').click();
ok(!(await value()).includes('b body'), 'cancelling the search closes it again');
await page.locator('#editor').focus();
await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Shift+Tab');
ok((await msg()) === 'SHOW ALL', 'S-TAB twice more shows everything');

await page.locator('#keyrow button', { hasText: 'Float' }).click();
ok((await page.locator('#keyrow.float').count()) === 1 && (await page.locator('#keyrow button', { hasText: 'Dock' }).count()) === 1, 'Float makes the keys a floating panel');
const box = await page.locator('#keyrow').boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + 4); await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 - 60, box.y - 80, { steps: 4 }); await page.mouse.up();
const moved = await page.locator('#keyrow').boundingBox();
ok(Math.abs(moved.x - box.x) > 30 && moved.y < box.y - 40, 'the floating panel can be dragged');
await page.locator('#keyrow button', { hasText: 'Dock' }).click();
ok((await page.locator('#keyrow.float').count()) === 0, 'Dock puts the row back above the mode line');

// The keyboard button and the arrows: focus stays in the text, and only the keyboard button raises the keyboard
const mode = () => page.evaluate(() => document.getElementById('editor').inputMode);
const focused = () => page.evaluate(() => document.activeElement.id);
ok((await mode()) === 'none', 'with the key row shown, tapping the text does not raise the keyboard');
await page.evaluate(() => document.activeElement.blur());
await page.locator('#keyrow button[aria-label="Left"]').click();
ok((await focused()) === 'editor' && (await mode()) === 'none', 'an arrow on the key row focuses the text without allowing the keyboard');
await page.locator('#keyrow .kbd').click();
ok((await focused()) === 'editor' && (await mode()) === 'text', 'the keyboard button allows the keyboard and keeps the focus in the text');
await page.locator('#keyrow .kbd').click();
ok((await focused()) === 'editor' && (await mode()) === 'none', 'pressed again, it stops the keyboard and the focus stays, so the arrows still work');

// Hide leading stars
await page.click('#btn-menu'); await btn('Settings').click(); await btn(/5 settings/).click(); await btn(/Hide leading stars/).click(); await btn('‹ Settings').click(); await btn('Close').click();
ok((await value()).includes('\n * B') && !(await value()).includes('** B'), 'Hide leading stars shows only the last star of a deeper heading');

// C-RET in a heading's body starts a sibling heading after the subtree (checked against Emacs)
await page.fill('#editor', '* A\nbody\n* Z\n');
await page.evaluate(() => document.getElementById('editor').focus());
await caretAt('body');
await page.keyboard.press('Control+Enter');
ok((await value()) === '* A\nbody\n* \n* Z\n', 'C-RET on a body line adds a heading after the subtree');

ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join('; ') : ''}`);
await close();
process.exit(failed ? 1 : 0);
