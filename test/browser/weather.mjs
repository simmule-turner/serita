// M-x org-weather-refresh in headless Chrome, with Open-Meteo answered by the test.
import { start } from './harness.mjs';

const { base, browser, close } = await start();
let failed = 0;
const ok = (c, m) => { console.log(`${c ? 'ok    ' : 'FAIL  '}weather: ${m}`); if (!c) failed++; };
const context = await browser.newContext({ viewport: { width: 393, height: 800 }, timezoneId: 'America/New_York' });
let answer = 'ok';
const requests = [];
await context.route('https://api.open-meteo.com/**', (route) => {
  requests.push(route.request().url());
  if (answer === 'fail') return route.abort();
  return route.fulfill({ contentType: 'application/json', body: JSON.stringify({
    utc_offset_seconds: -18000,
    current: { time: '2026-11-26T04:15', temperature_2m: 12.4, relative_humidity_2m: 71, apparent_temperature: 10, surface_pressure: 1012.6, wind_speed_10m: 14.2, weather_code: 61 },
    hourly: { temperature_2m: Array.from({ length: 24 }, (_, i) => i) },
    daily: { temperature_2m_min: [8.2], temperature_2m_max: [15.7], apparent_temperature_min: [6], apparent_temperature_max: [14] },
  }) });
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${base}/`);
await page.waitForSelector('.tab.current');
const sheet = page.locator('.sheet');
const setting = async (s) => { await page.evaluate((v) => localStorage.setItem('serita.settings', JSON.stringify(v)), s); await page.reload(); await page.waitForSelector('.tab.current'); };
const command = async (name) => { await page.click('#btn-menu'); await sheet.getByRole('button', { name: /Commands/ }).click(); await page.keyboard.type(name); await page.keyboard.press('Enter'); };
const said = () => page.locator('#message').innerText();

await setting({});
await command('org-weather-refresh');
await page.waitForFunction(() => /calendar-latitude/.test(document.getElementById('message').innerText));
ok(requests.length === 0, 'without a place nothing is asked of Open-Meteo and the message says how to set one');

await setting({ 'calendar-latitude': '35.994', 'calendar-longitude': '-78.8986', 'org-weather-temperature-unit': 'fahrenheit', 'org-weather-speed-unit': 'mph' });
await command('org-weather-refresh');
await page.waitForFunction(() => /Weather refreshed/.test(document.getElementById('message').innerText));
ok(requests.length === 1 && /temperature_unit=fahrenheit/.test(requests[0]) && /wind_speed_unit=mph/.test(requests[0]) && /latitude=35.994/.test(requests[0]), 'the request carries the place and the units');
const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('serita.weather')));
ok(saved.tcur === 12.4 && saved.code === 61 && saved.dataAt === Date.UTC(2026, 10, 26, 9, 15), 'the forecast is kept on the device with the time of its data');

answer = 'fail';
await command('org-weather-refresh');
await page.waitForFunction(() => /Weather not refreshed/.test(document.getElementById('message').innerText));
ok((await page.evaluate(() => JSON.parse(localStorage.getItem('serita.weather')).tcur)) === 12.4, 'a failed refresh keeps the saved forecast and says so');

ok(errors.length === 0, `no page errors ${errors.join('; ')}`);
await close();
process.exit(failed ? 1 : 0);
