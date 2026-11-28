// org-log-done and C-c C-z in headless Chrome. The text layouts are what Emacs gave (conformance cases lg-*); the time is the clock's.
import { start } from './harness.mjs';

const { base, browser, close } = await start();
let failed = 0;
const ok = (c, m) => { console.log(`${c ? 'ok    ' : 'FAIL  '}logging: ${m}`); if (!c) failed++; };
const page = await (await browser.newContext({ viewport: { width: 393, height: 800 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${base}/`);
await page.waitForSelector('.tab.current');
const sheet = page.locator('.sheet');
const btn = (n) => sheet.getByRole('button', { name: n, exact: true });
await page.click('#btn-menu'); await btn('Settings').click(); await btn(/\d+ settings/).click(); await btn(/Emacs keys/).click(); await btn('‹ Settings').click(); await btn('Close').click();
const setting = async (s) => { await page.evaluate((v) => localStorage.setItem('serita.settings', JSON.stringify(v)), s); await page.reload(); await page.waitForSelector('.tab.current'); };
const at = async (text, line) => {
  await page.fill('#editor', text);
  await page.evaluate((l) => { const e = document.getElementById('editor'); const o = e.value.split('\n').slice(0, l - 1).reduce((n, s) => n + s.length + 1, 0); e.focus(); e.setSelectionRange(o, o); }, line);
};
const text = () => page.inputValue('#editor');
const ctrl = async (k) => { await page.locator('#keyrow button', { hasText: 'Ctrl' }).click(); await page.keyboard.press(k); };
const STAMP = '\\[\\d{4}-\\d\\d-\\d\\d \\w{3} \\d\\d:\\d\\d\\]';

await setting({ 'view.emacsKeys': 'true', 'org-log-done': 'time' });
await at('* TODO a\n* b\n', 1);
await ctrl('c'); await ctrl('t');
ok(new RegExp(`^\\* DONE a\\nCLOSED: ${STAMP}\\n\\* b\\n$`).test(await text()), 'org-log-done time adds CLOSED');
await ctrl('c'); await ctrl('t'); await page.keyboard.press('Enter').catch(() => {});

await setting({ 'view.emacsKeys': 'true', 'org-log-done': 'note' });
await at('* TODO a\n* b\n', 1);
await ctrl('c'); await ctrl('t');
await page.locator('.sheet textarea').fill('a note');
await page.locator('.sheet').getByRole('button', { name: 'Save', exact: true }).click();
ok(new RegExp(`^\\* DONE a\\nCLOSED: ${STAMP}\\n- CLOSING NOTE ${STAMP} \\\\\\\\\\n  a note\\n\\* b\\n$`).test(await text()), 'org-log-done note adds CLOSED and a closing note');

await setting({ 'view.emacsKeys': 'true' });
await at('* a\n', 1);
await ctrl('c'); await ctrl('z');
await page.locator('.sheet textarea').fill('n');
await page.locator('.sheet').getByRole('button', { name: 'Save', exact: true }).click();
ok(new RegExp(`^\\* a\\n- Note taken on ${STAMP} \\\\\\\\\\n  n$`).test(await text()), 'C-c C-z adds a note');

await setting({ 'view.emacsKeys': 'true' });
await at('#+TODO: TODO(t) WAIT(w@/!) | DONE(d!)\n* TODO a\n', 2);
await ctrl('c'); await ctrl('t');
await page.locator('.sheet textarea').fill('why');
await page.locator('.sheet').getByRole('button', { name: 'Save', exact: true }).click();
const plain = async () => (await text()).replace(/\[\d{4}-\d\d-\d\d \w{3} \d\d:\d\d\]/g, '[T]');
ok((await plain()) === '#+TODO: TODO(t) WAIT(w@/!) | DONE(d!)\n* WAIT a\n- State "WAIT"       from "TODO"       [T] \\\\\n  why', 'WAIT(w@/!) asks a note on entering');
await page.waitForSelector('.sheet', { state: 'detached' });
await page.focus('#editor');
await ctrl('c'); await ctrl('t');
ok((await plain()).startsWith('#+TODO: TODO(t) WAIT(w@/!) | DONE(d!)\n* DONE a\n- State "DONE"       from "WAIT"       [T]\n- State "WAIT"'), 'DONE(d!) logs the time, newest first');

// The date prompt starts from the date already set: RET keeps it, ++1d counts from it
await setting({ 'view.emacsKeys': 'true' });
await at('* TODO a\nSCHEDULED: <2026-11-23 Mon>\n', 1);
await ctrl('c'); await ctrl('s');
ok(/Date\+time \[2026-11-23\]/.test(await page.locator('#findbar').textContent()), 'the prompt offers the scheduled date as its default');
await page.keyboard.type('++1d'); await page.keyboard.press('Enter');
ok((await text()).includes('SCHEDULED: <2026-11-24 Tue>'), '++1d counts from the date already set');

// org-log-reschedule note: Skip logs the line alone, the cross leaves it out; the new date stays either way
await setting({ 'view.emacsKeys': 'true', 'org-log-reschedule': 'note' });
const planned = '* TODO a\nSCHEDULED: <2026-11-23 Mon>\n';
await at(planned, 1); await ctrl('c'); await ctrl('s'); await page.keyboard.type('+1d'); await page.keyboard.press('Enter');
await page.locator('.sheet').getByRole('button', { name: 'Skip', exact: true }).click();
ok(/^\* TODO a\nSCHEDULED: <\d{4}-\d\d-\d\d \w{3}>\n- Rescheduled from "\[2026-11-23 Mon\]" on \[[^\]]+\]$/.test(await text()), 'Skip in the reschedule note logs the line alone');
await at(planned, 1); await ctrl('c'); await ctrl('s'); await page.keyboard.type('+1d'); await page.keyboard.press('Enter');
await page.locator('.sheet .dismiss').click();
ok(/^\* TODO a\nSCHEDULED: <\d{4}-\d\d-\d\d \w{3}>\n$/.test(await text()) && !(await text()).includes('2026-11-23'), 'the cross in the reschedule note keeps the new date and logs nothing');

ok(errors.length === 0, 'no page errors');
await close();
process.exit(failed ? 1 : 0);
