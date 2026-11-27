// Links, footnotes and emphasis from the keys, in headless Chrome. The text results are what Emacs gave (conformance cases ij-*, fb-*, fm-*, em-*).
import { start } from './harness.mjs';

const { base, browser, close } = await start();
let failed = 0;
const ok = (c, m) => { console.log(`${c ? 'ok    ' : 'FAIL  '}links: ${m}`); if (!c) failed++; };
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
const select = (a, b) => page.evaluate(([x, y]) => { const e = document.getElementById('editor'); e.focus(); e.setSelectionRange(x, y); }, [a, b]);
const text = () => page.inputValue('#editor');
const ctrl = async (k) => { await page.locator('#keyrow button', { hasText: 'Ctrl' }).click(); await page.keyboard.press(k); };
const chord = async (...keys) => { for (const k of keys) await ctrl(k); };
const cursor = () => page.evaluate(() => document.getElementById('editor').selectionStart);
const prompt = () => page.locator('#findbar .prompt').textContent();
const typeAnswer = async (s) => { await page.keyboard.type(s); await page.keyboard.press('Enter'); };

// C-c C-x C-f around the region (em-emphasize-b)
await at('one two three\n', 1); await select(4, 7);
await ctrl('c'); await ctrl('x'); await ctrl('f');
await sheet.getByRole('button', { name: /^\*/ }).first().click();
ok((await text()) === 'one *two* three\n', 'C-c C-x C-f * wraps the region');

// C-c C-x f on a new footnote (fm-new-key)
await at('* Alpha\nsome text\n', 2, 4);
await ctrl('c'); await ctrl('x'); await page.keyboard.press('f');
ok((await text()) === '* Alpha\nsome[fn:1] text\n\n* Footnotes\n\n[fn:1] \n', 'C-c C-x f adds the reference and the definition');
ok((await cursor()) === (await text()).indexOf('[fn:1] \n') + 6, 'the cursor is in the definition');

// C-c C-l inserts a link (ij-http)
await at('one two three\n', 1);
await ctrl('c'); await ctrl('l');
ok((await prompt()).startsWith('Insert link'), 'C-c C-l asks for the link');
await typeAnswer('http://x.y');
ok((await prompt()) === 'Description:', 'then for the description');
await typeAnswer('d');
ok((await text()) === '[[http://x.y][d]]one two three\n', 'the link is inserted');

// C-c C-o follows a heading link, and C-x C-SPC comes back (o2-mark-ring)
await at('* Alpha\n[[*Beta]]\n* Beta\n', 2, 3);
await ctrl('c'); await ctrl('o');
ok((await cursor()) === '* Alpha\n[[*Beta]]\n'.length, 'C-c C-o goes to the heading');
await ctrl('c'); await page.keyboard.press('&');
ok((await cursor()) === '* Alpha\n'.length + 3, 'C-c & goes back to where the link was');

// C-c l (sl-nonfile)
await at('* Alpha\n', 1);
await ctrl('c'); await page.keyboard.press('l');
ok((await page.locator('#message').textContent()) === 'No method for storing a link from this buffer', 'C-c l in a buffer without a file says so, as Emacs does');

// The Outline view shows a link by its description and a tap follows it (en-*, lo-*)
await at('* Alpha\n[[*Beta][see Beta]] and *bold*\n* Beta\n', 1);
await page.click('#btn-view'); await btn('Outline').click();
const link = page.locator('#outline .ol-link', { hasText: 'see Beta' });
ok((await link.count()) === 1 && (await page.locator('#outline b', { hasText: '*bold*' }).count()) === 1, 'the Outline shows the description and the bold text');
await link.click();
ok((await page.locator('#outline .ol-head[data-line="2"]').count()) === 1, 'a tap on the link goes to the heading');

ok(errors.length === 0, `no page errors ${errors.join('; ')}`);
await close();
process.exit(failed ? 1 : 0);
