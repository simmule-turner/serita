// Lists from the keys, in headless Chrome. The text results are what Emacs gave (conformance cases li-*).
import { start } from './harness.mjs';

const { base, browser, close } = await start();
let failed = 0;
const ok = (c, m) => { console.log(`${c ? 'ok    ' : 'FAIL  '}lists: ${m}`); if (!c) failed++; };
const page = await (await browser.newContext({ viewport: { width: 393, height: 800 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${base}/`);
await page.waitForSelector('.tab.current');
const sheet = page.locator('.sheet');
const btn = (n) => sheet.getByRole('button', { name: n, exact: true });
await page.click('#btn-menu'); await btn('Settings').click(); await btn(/28 settings/).click(); await btn(/Emacs keys/).click(); await btn('‹ Settings').click(); await btn('Close').click();
const at = async (text, line, col = 0) => {
  await page.fill('#editor', text);
  await page.evaluate(([l, c]) => { const e = document.getElementById('editor'); const o = e.value.split('\n').slice(0, l - 1).reduce((n, s) => n + s.length + 1, 0) + c; e.focus(); e.setSelectionRange(o, o); }, [line, col]);
};
const text = () => page.inputValue('#editor');
const cursor = () => page.evaluate(() => document.getElementById('editor').selectionStart);
const ctrl = async (k) => { await page.locator('#keyrow button', { hasText: 'Ctrl' }).click(); await page.keyboard.press(k); };
const meta = async (k) => { await page.locator('#keyrow button', { hasText: 'Meta' }).click(); await page.keyboard.press(k); };

// M-RET at the end of an item (li-mret-end), and in a numbered list (li-mret-ord)
await at('* H\n- one\n- two\n- three\n', 3, 5);
await meta('Enter');
ok((await text()) === '* H\n- one\n- two\n- \n- three\n' && (await cursor()) === '* H\n- one\n- two\n- '.length, 'M-RET adds an item below');
await at('* H\n1. one\n2. two\n3. three\n', 3, 6);
await meta('Enter');
ok((await text()) === '* H\n1. one\n2. two\n3. \n4. three\n', 'M-RET in a numbered list renumbers');

// M-S-RET adds a checkbox (li-msret)
await at('* H\n- one\n- two\n', 2, 5);
await page.locator('#keyrow button', { hasText: 'Meta' }).click(); await page.locator('#keyrow button', { hasText: 'Shift' }).click(); await page.keyboard.press('Enter');
ok((await text()) === '* H\n- one\n- [ ] \n- two\n', 'M-S-RET adds an item with a checkbox');

// C-c - cycles the bullet (li-cminus-1, li-cminus-2) and makes an item of text (li-cminus-text)
await at('* H\n- one\n- two\n- three\n', 2, 3);
await ctrl('c'); await page.keyboard.press('-');
ok((await text()) === '* H\n+ one\n+ two\n+ three\n', 'C-c - changes the bullet of the whole list');
await ctrl('c'); await page.keyboard.press('-');
ok((await text()) === '* H\n1. one\n2. two\n3. three\n', 'again it numbers the list');
await at('* H\nplain text\n', 2, 3);
await ctrl('c'); await page.keyboard.press('-');
ok((await text()) === '* H\n- plain text\n', 'C-c - on text makes an item');

// C-c * on an item (li-heading), C-c C-c on a numbered list renumbers (li-cc-ord)
await at('* H\n- one\n- two\n', 2, 3);
await ctrl('c'); await page.keyboard.press('*');
ok((await text()) === '* H\n** one\n- two\n', 'C-c * turns an item into a heading');
await at('* H\n1. a\n5. b\n9. c\n', 2, 3);
await ctrl('c'); await ctrl('c');
ok((await text()) === '* H\n1. a\n2. b\n3. c\n', 'C-c C-c renumbers');

// C-c ^ sorts (li-sort-a); a key in the sheet picks how
await at('* H\n- pear\n- apple\n- fig\n', 2, 3);
await ctrl('c'); await page.keyboard.press('^');
await page.locator('.sheet').getByRole('button', { name: 'Alphabetically', exact: true }).click();
ok((await text()) === '* H\n- apple\n- fig\n- pear\n', 'C-c ^ sorts the list');

// S-RIGHT on a bullet cycles it, like C-c - (li-sright)
await at('* H\n- one\n- two\n', 2, 0);
await page.keyboard.press('Shift+ArrowRight');
ok((await text()) === '* H\n+ one\n+ two\n', 'S-RIGHT on a bullet changes the bullet of the list');

// Bold over two lines shows its closing marker once in the Outline view
await at('* H\nsome *bold\ntext* end\n', 1);
await page.click('#btn-view'); await sheet.getByRole('button', { name: 'Outline', exact: true }).click();
ok((await page.locator('#outline .ol-line').allTextContents()).includes('text* end'), 'the closing marker of multi-line bold is printed once');
ok(errors.length === 0, 'no page errors');
await close();
process.exit(failed ? 1 : 0);
