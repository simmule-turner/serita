// Scripts and entities in the Outline view (org-pretty-entities, org-use-sub-superscripts) and C-c / c, in headless Chrome. The drawing follows Emacs 30.1 (conformance v0.1.88: dsp-*, sp2-*).
import { start } from './harness.mjs';

const { base, browser, close } = await start();
let failed = 0;
const ok = (c, m) => { console.log(`${c ? 'ok    ' : 'FAIL  '}scripts: ${m}`); if (!c) failed++; };
const page = await (await browser.newContext({ viewport: { width: 393, height: 800 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${base}/`);
await page.waitForSelector('.tab.current');
const sheet = page.locator('.sheet');
const btn = (n) => sheet.getByRole('button', { name: n, exact: true });
const setting = async (s) => { await page.evaluate((v) => localStorage.setItem('serita.settings', JSON.stringify(v)), s); await page.reload(); await page.waitForSelector('.tab.current'); };
const outlineOf = async (text) => { await page.fill('#editor', text); await page.click('#btn-view'); await btn('Outline').click(); };
const SRC = '* A\nx_{1} y_2 z^{3} \\alpha a_b\n';

await setting({});
await outlineOf(SRC);
ok((await page.locator('#outline sub, #outline sup').count()) === 0 && /\\alpha/.test(await page.locator('#outline').innerText()), 'by default the Outline shows the text as typed, as Emacs does');

await setting({ 'org-pretty-entities': 't' });
await page.click('#btn-view'); await btn('Outline').click().catch(() => {});
let t = await page.locator('#outline').innerText();
ok((await page.locator('#outline sub').count()) === 3 && (await page.locator('#outline sup').count()) === 1 && /x1 y2 z3 α ab/.test(t.replace(/\s+/g, ' ')), 'with org-pretty-entities t, _ and ^ scripts are lowered or raised, their markers and braces hidden, and \\alpha is α');

await setting({ 'org-pretty-entities': 't', 'org-use-sub-superscripts': '{}' });
await page.click('#btn-view'); await btn('Outline').click().catch(() => {});
t = await page.locator('#outline').innerText();
ok((await page.locator('#outline sub').count()) === 1 && (await page.locator('#outline sup').count()) === 1 && /y_2/.test(t) && /a_b/.test(t), 'with {} only the braced scripts are drawn');

await setting({ 'org-pretty-entities': 't', 'org-pretty-entities-include-sub-superscripts': 'nil' });
await page.click('#btn-view'); await btn('Outline').click().catch(() => {});
t = await page.locator('#outline').innerText();
ok((await page.locator('#outline sub, #outline sup').count()) === 0 && /x_\{1\}/.test(t) && /α/.test(t), 'without scripts the entities still draw');

// C-c / c cycles the date type for the next C-c / b, and the sparse menu stays open for it (sp2-*)
await setting({ 'view.mode': 'text' });
await page.click('#btn-menu'); await btn('Settings').click(); await btn(/\d+ settings/).click(); await btn(/Emacs keys/).click(); await btn('‹ Settings').click(); await btn('Close').click();
await page.fill('#editor', '* TODO a\nSCHEDULED: <2026-11-20 Fri>\n* b\nDEADLINE: <2026-11-22 Sun>\n');
const ctrl = async (k) => { await page.locator('#keyrow button', { hasText: 'Ctrl' }).click(); await page.keyboard.press(k); };
await page.evaluate(() => { const e = document.getElementById('editor'); e.focus(); e.setSelectionRange(0, 0); });
await ctrl('c'); await page.keyboard.press('/'); await page.keyboard.press('c');
ok(/\]ycle through date types: all timestamps/.test(await page.locator('#message').innerText()), 'C-c / c names the next date type in the echo area');
await page.keyboard.press('c');
ok(/only scheduled/.test(await page.locator('#message').innerText()), 'and pressing c again goes on to the next');
await ctrl('g');
await page.fill('#editor', '* TODO a\nDEADLINE: <2026-11-27 Fri>\n');
await page.evaluate(() => { const e = document.getElementById('editor'); e.focus(); e.setSelectionRange(0, 0); });
await ctrl('3'); await ctrl('c'); await page.keyboard.press('/'); await page.keyboard.press('d');
ok(/deadlines past-due or due within 3 days/.test(await page.locator('#message').innerText()), 'C-3 C-c / d takes the days from the prefix (dd-3)');

ok(errors.length === 0, `no page errors ${errors.join('; ')}`);
await close();
process.exit(failed ? 1 : 0);
