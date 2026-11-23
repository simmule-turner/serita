// Movement keys, the beep and C-g in the Text view, in headless Chrome.
import { start } from './harness.mjs';

const { base, browser, close } = await start();
let failed = 0;
const ok = (c, m) => { console.log(`${c ? 'ok    ' : 'FAIL  '}motion: ${m}`); if (!c) failed++; };
const page = await (await browser.newContext({ viewport: { width: 390, height: 800 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.addInitScript(() => {
  window.__beeps = 0;
  const Real = window.AudioContext;
  window.AudioContext = class extends Real { createOscillator() { window.__beeps++; return super.createOscillator(); } };
});
await page.goto(`${base}/`);
await page.waitForSelector('.tab.current');
const sheet = page.locator('.sheet');
const btn = (n) => sheet.getByRole('button', { name: n, exact: true });
await page.click('#btn-menu'); await btn('Settings').click(); await btn(/8 settings/).click(); await btn(/Emacs keys/).click(); await btn('‹ Settings').click(); await btn('Close').click();
const at = (text, offset) => page.evaluate(([t, o]) => { const e = document.getElementById('editor'); e.value = t; e.dispatchEvent(new Event('input')); e.focus(); e.setSelectionRange(o, o); }, [text, offset]);
const pos = () => page.evaluate(() => { const e = document.getElementById('editor'); const b = e.value.slice(0, e.selectionStart).split('\n'); return `${b.length}:${b.at(-1).length}`; });
const msg = () => page.locator('#message').textContent();
const beeps = () => page.evaluate(() => window.__beeps);

await at('long line here\nab\nlong line here\n', 8);
await page.keyboard.press('Control+p'); // hardware C-p is Emacs movement here
await page.keyboard.press('Control+n');
ok((await pos()) === '2:2', 'C-n goes down and stops at the end of a short line');
await page.keyboard.press('Control+n');
ok((await pos()) === '3:8', 'the goal column comes back on the next C-n');
await at('foo, bar-baz qux\n', 0);
await page.keyboard.press('Alt+f'); await page.keyboard.press('Alt+f');
ok((await pos()) === '1:8', 'M-f twice goes to the end of the second word');
await page.keyboard.press('Control+e');
ok((await pos()) === '1:16', 'C-e goes to the end of the line');
await page.keyboard.press('Control+a');
ok((await pos()) === '1:0', 'C-a goes to the start of the line');
await at('ab', 2);
const before = await beeps();
await page.keyboard.press('Control+f');
ok((await msg()) === 'End of buffer' && (await pos()) === '1:2', 'C-f at the end says End of buffer');
ok((await beeps()) === before + 1, 'and beeps once');
await page.keyboard.press('Control+g');
ok((await msg()) === 'Quit' && (await beeps()) === before + 2, 'C-g says Quit and beeps');
await at('a\nb', 2);
await page.keyboard.press('Control+n');
ok((await pos()) === '2:1' && (await msg()) === 'End of buffer', 'C-n on the last line goes to its end, then says End of buffer');
await page.click('#btn-menu'); await btn('Settings').click(); await btn(/8 settings/).click(); await btn(/Beep on errors/).click(); await btn('‹ Settings').click(); await btn('Close').click();
const quiet = await beeps();
await page.keyboard.press('Control+g');
ok((await beeps()) === quiet, 'with Beep on errors off, nothing sounds');

await at('x'.repeat(100) + '\nend\n', 5);
await page.keyboard.press('Control+n');
const wrapped = await pos();
ok(wrapped.startsWith('1:') && Number(wrapped.slice(2)) > 5, `C-n moves down one screen line of a wrapped line (${wrapped})`);

await at('* A\nbody\n** B\nbody B\n* Z\n', 0);
await page.keyboard.press('Shift+Tab');
await page.keyboard.press('Control+n');
ok((await pos()).startsWith('2:'), 'C-n skips the folded subtree');

ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join('; ') : ''}`);
await close();
process.exit(failed ? 1 : 0);
