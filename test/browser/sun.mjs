// M-x sunrise-sunset, C-u M-x sunrise-sunset, calendar-sunrise-sunset-month and the S key in the Calendar, in headless Chrome.
import { start } from './harness.mjs';

const { base, browser, close } = await start();
let failed = 0;
const ok = (c, m) => { console.log(`${c ? 'ok    ' : 'FAIL  '}sun: ${m}`); if (!c) failed++; };
const page = await (await browser.newContext({ viewport: { width: 393, height: 800 }, timezoneId: 'America/New_York' })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${base}/`);
await page.waitForSelector('.tab.current');
const sheet = page.locator('.sheet');
const btn = (n) => sheet.getByRole('button', { name: n, exact: true });
const setting = async (s) => { await page.evaluate((v) => localStorage.setItem('serita.settings', JSON.stringify(v)), s); await page.reload(); await page.waitForSelector('.tab.current'); };
const command = async (name) => { await page.click('#btn-menu'); await sheet.getByRole('button', { name: /Commands/ }).click(); await page.keyboard.type(name); await page.keyboard.press('Enter'); };
const said = () => page.locator('#message').innerText();

await setting({ 'calendar-latitude': '35.994', 'calendar-longitude': '-78.8986', 'calendar-location-name': 'Durham' });
await command('sunrise-sunset');
await page.waitForFunction(() => /^Sunrise/.test(document.getElementById('message').innerText));
ok(/^Sunrise \d+:\d\d[ap]m \(E[SD]T\), sunset \d+:\d\d[ap]m \(E[SD]T\) at Durham \(\d+:\d\d hrs daylight\)$/.test(await said()), 'M-x sunrise-sunset says today\'s times');

await command('calendar-sunrise-sunset-month');
await sheet.locator('textarea').waitFor();
const title = await sheet.locator('h2').innerText();
const lines = (await sheet.locator('textarea').inputValue()).split('\n');
ok(/^Sunrise\/sunset times for \w+ \d{4} at Durham:$/.test(title), 'the month sheet has the heading as its title');
ok(lines.length >= 28 && /^\w{3} {1,2}1: Sunrise \d+:\d\d[ap]m \(E[SD]T\), sunset \d+:\d\d[ap]m \(E[SD]T\) \(\d+:\d\d hrs daylight\)$/.test(lines[0]), 'one line a day, without the place');
await btn('Copy').click();
await page.waitForFunction(() => document.getElementById('message').innerText.trim() !== '');
ok(await page.evaluate(() => getComputedStyle(document.getElementById('message')).zIndex === '11'), 'the message line is above the dimming layer behind any sheet, such as this one');
await btn('Close').click();

await setting({});
await command('sunrise-sunset');
await page.waitForFunction(() => /calendar-latitude/.test(document.getElementById('message').innerText));
ok(/Set calendar-latitude and calendar-longitude/.test(await said()), 'without a place it says how to set one');

await setting({ 'calendar-latitude': '35.994', 'calendar-longitude': '-78.8986' });
await page.click('#btn-menu'); await sheet.getByRole('button', { name: 'Calendar', exact: true }).click().catch(async () => { await sheet.getByRole('button', { name: /Commands/ }).click(); await page.keyboard.type('calendar'); await page.keyboard.press('Enter'); });
await page.locator('.sheet.calendar').waitFor();
await page.keyboard.press('Shift+S');
await page.waitForFunction(() => /^\w{3} \d+, \d{4}: Sunrise/.test(document.getElementById('message').innerText));
ok(/^\w{3} \d+, \d{4}: Sunrise .* at 36\.0N, 78\.9W /.test(await said()), 'S in the Calendar says the times of the chosen day, starting with its date');

await page.locator('.sheet.calendar').getByRole('button', { name: 'Sun', exact: true }).click();
await page.waitForFunction(() => /^\w{3} \d+, \d{4}: Sunrise/.test(document.getElementById('message').innerText));
ok(/^\w{3} \d+, \d{4}: Sunrise .* at 36\.0N, 78\.9W /.test(await said()), 'the Sun button in the Calendar says the same');
const clear = await page.evaluate(() => { const r = document.getElementById('message').getBoundingClientRect(); return document.elementFromPoint(r.left + 20, r.top + r.height / 2)?.id === 'message'; });
ok(clear, 'the message is not under the dimming layer in the Calendar');
const names = await page.locator('.sheet.calendar .abar:last-child button').allInnerTexts();
ok(names.join(',') === 'Sun,Agenda,Today', `the bottom row is ${names.join(',')}`);
const boxes = await page.locator('.sheet.calendar .abar:last-child button').evaluateAll((b) => b.map((x) => Math.round(x.getBoundingClientRect().width)));
await page.screenshot({ path: '/tmp/cal-sun.png' });
const right = await page.locator('.sheet.calendar .abar:last-child button').last().evaluate((x) => Math.round(x.getBoundingClientRect().right));
ok(right <= 393, `the row fits the phone (${boxes.join(', ')} px wide, ends at ${right})`);
// The × is the last button of the title row on both screens; the Agenda has a Calendar button to go back
ok((await page.locator('.sheet.calendar .abar:first-child button').last().getAttribute('aria-label')) === 'Close', 'the Calendar has × at the end of its title row');
await page.locator('.sheet.calendar').getByRole('button', { name: 'Agenda', exact: true }).click();
await page.locator('.sheet.agenda').waitFor();
ok((await page.locator('.sheet.agenda .abar:first-child button').last().getAttribute('aria-label')) === 'Close', 'the Agenda has × at the end of its title row');
const agendaRow = await page.locator('.sheet.agenda .abar:last-child button').allInnerTexts();
ok(agendaRow.join(',') === 'Filter,Mark,Views,Calendar,Today', `the Agenda's bottom row is ${agendaRow.join(',')}`);
const todayRight = await page.locator('.sheet.agenda .abar:last-child button', { hasText: 'Today' }).evaluate((x) => Math.round(innerWidth - x.getBoundingClientRect().right));
ok(todayRight >= 0 && todayRight <= 12, `Today sits at the far right of the Agenda's bottom row (${todayRight} px from the edge)`);
await page.locator('.sheet.agenda .abar:last-child button', { hasText: 'Calendar' }).click();
await page.locator('.sheet.calendar').waitFor();
ok(true, 'the Calendar button on the Agenda opens the Calendar');
await page.locator('.sheet.calendar .abar button[aria-label="Close"]').click();
ok((await page.locator('.sheet').count()) === 0, '× closes the screen');

ok(errors.length === 0, `no page errors ${errors.join('; ')}`);
await close();
process.exit(failed ? 1 : 0);
