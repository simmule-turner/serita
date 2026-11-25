// The app follows the visual viewport, as it must on iOS where the keyboard covers the page instead of resizing it.
import { start } from './harness.mjs';

const { base, browser, close } = await start();
let failed = 0;
const ok = (c, m) => { console.log(`${c ? 'ok    ' : 'FAIL  '}keyboard: ${m}`); if (!c) failed++; };
const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
// A stand-in visual viewport whose size and offset the test controls
await page.addInitScript(() => {
  const t = new EventTarget();
  const vv = Object.assign(t, { height: window.innerHeight, offsetTop: 0 });
  Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
  window.__vv = (h, top) => { vv.height = h; vv.offsetTop = top; vv.dispatchEvent(new Event('resize')); };
});
await page.goto(`${base}/`);
await page.waitForSelector('.tab.current');
const box = (sel) => page.evaluate((s) => { const r = document.querySelector(s).getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom) }; }, sel);
const before = await box('body');
ok(before.top === 0 && before.bottom === 800, 'without a keyboard the app fills the screen');
await page.evaluate(() => window.__vv(500, 0));
const open = await box('body');
ok(open.top === 0 && open.bottom === 500, 'with the keyboard up the app ends where the keyboard starts');
ok(await page.evaluate(() => document.documentElement.classList.contains('keyboard')), 'the page notes that the keyboard is up');
const tabs = await box('#tabs, .tabs, header');
ok(tabs.top >= 0 && tabs.bottom <= 500, 'the tabs stay in view');
await page.evaluate(() => window.__vv(500, 120));
const slid = await box('body');
ok(slid.top === 120 && slid.bottom === 620, 'when iOS slides the page, the app slides with it');
await page.evaluate(() => window.__vv(800, 0));
const back = await box('body');
ok(back.bottom === 800 && !(await page.evaluate(() => document.documentElement.classList.contains('keyboard'))), 'closing the keyboard restores the full screen');
ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.join('; ') : ''}`);
await close();
process.exit(failed ? 1 : 0);
