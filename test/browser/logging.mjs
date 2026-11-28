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

// org-log-reschedule note: saving it empty logs the line alone; Skip and the cross cancel it, so nothing is logged; the new date stays either way
await setting({ 'view.emacsKeys': 'true', 'org-log-reschedule': 'note' });
const planned = '* TODO a\nSCHEDULED: <2026-11-23 Mon>\n';
await at(planned, 1); await ctrl('c'); await ctrl('s'); await page.keyboard.type('+1d'); await page.keyboard.press('Enter');
await page.locator('.sheet').getByRole('button', { name: 'Save', exact: true }).click();
ok(/^\* TODO a\nSCHEDULED: <\d{4}-\d\d-\d\d \w{3}>\n- Rescheduled from "\[2026-11-23 Mon\]" on \[[^\]]+\]$/.test(await text()), 'saving an empty reschedule note logs the line alone');
ok((await page.textContent('#message')).includes('Note stored'), 'and says the note is stored');
await at(planned, 1); await ctrl('c'); await ctrl('s'); await page.keyboard.type('+1d'); await page.keyboard.press('Enter');
await page.locator('.sheet').getByRole('button', { name: 'Skip', exact: true }).click();
ok(/^\* TODO a\nSCHEDULED: <\d{4}-\d\d-\d\d \w{3}>\n$/.test(await text()) && !(await text()).includes('2026-11-23'), 'Skip in the reschedule note keeps the new date and logs nothing');
await at(planned, 1); await ctrl('c'); await ctrl('s'); await page.keyboard.type('+1d'); await page.keyboard.press('Enter');
await page.locator('.sheet .dismiss').click();
ok(/^\* TODO a\nSCHEDULED: <\d{4}-\d\d-\d\d \w{3}>\n$/.test(await text()) && !(await text()).includes('2026-11-23'), 'the cross in the reschedule note keeps the new date and logs nothing');

// A note sheet gives the focus back to the editor, so an open keyboard stays open
await setting({ 'view.emacsKeys': 'true', 'org-log-done': 'note' });
await at('* TODO a\n', 1);
await ctrl('c'); await ctrl('t');
ok(await page.evaluate(() => document.activeElement.tagName) === 'TEXTAREA' && await page.locator('.sheet').count() === 1, 'the note sheet takes the focus');
await page.locator('.sheet').getByRole('button', { name: 'Skip', exact: true }).click();
ok(await page.evaluate(() => document.activeElement.id) === 'editor', 'after Skip the editor has the focus again');
await at('* TODO a\n', 1);
await ctrl('c'); await ctrl('t'); await page.locator('.sheet textarea').fill('done'); await page.locator('.sheet').getByRole('button', { name: 'Save', exact: true }).click();
ok(await page.evaluate(() => document.activeElement.id) === 'editor', 'after Save the editor has the focus again');

// The cursor stays on the same text when an edit adds lines above it
await setting({ 'view.emacsKeys': 'true', 'org-log-reschedule': 'note' });
await at('* TODO a\nSCHEDULED: <2026-11-23 Mon>\nbody text\n', 3);
await page.evaluate(() => { const e = document.getElementById('editor'); const o = e.value.indexOf('text'); e.setSelectionRange(o, o); });
await ctrl('c'); await ctrl('s'); await page.keyboard.type('+2d'); await page.keyboard.press('Enter');
await page.locator('.sheet textarea').fill('moved'); await page.locator('.sheet').getByRole('button', { name: 'Save', exact: true }).click();
ok(await page.evaluate(() => { const e = document.getElementById('editor'); return e.value.slice(e.selectionStart, e.selectionStart + 4); }) === 'text', 'after a reschedule with a note the cursor is still in the body text');

// org-log-refile: texts as Emacs gave them (conformance lg-refile*): the line goes after the planning line, in the drawer when one is set
const refileWith = async (settings, input, note) => {
  await setting({ 'view.emacsKeys': 'true', ...settings });
  await at(input, 1); await ctrl('c'); await ctrl('w');
  await page.locator('.sheet').getByRole('button', { name: /^B/ }).first().click();
  if (note !== undefined) { await page.locator('.sheet textarea').fill(note); await page.locator('.sheet').getByRole('button', { name: 'Save', exact: true }).click(); }
  return text();
};
const RT = '\\[\\d{4}-\\d\\d-\\d\\d \\w{3} \\d\\d:\\d\\d\\]';
ok(new RegExp(`^\\* B\\n\\*\\* A\\n- Refiled on ${RT}$`).test(await refileWith({ 'org-log-refile': 'time' }, '* A\n* B\n')), 'org-log-refile time adds a Refiled on line under the moved heading');
ok(new RegExp(`^\\* B\\n\\*\\* C\\n\\*\\* A\\nSCHEDULED: <2026-12-01 Tue>\\n- Refiled on ${RT}\\nbody\\n$`).test(await refileWith({ 'org-log-refile': 'time' }, '* A\nSCHEDULED: <2026-12-01 Tue>\nbody\n* B\n** C\n')), 'the line comes after the planning line and before the body');
ok(new RegExp(`^\\* B\\n\\*\\* TODO A\\n- Refiled on ${RT}$`).test(await refileWith({ 'org-log-refile': 'time' }, '* TODO A\n* B\n')), 'a TODO heading gets the same line');
ok(new RegExp(`^\\* B\\n\\*\\* A\\n:LOGBOOK:\\n- Refiled on ${RT}\\n:END:$`).test(await refileWith({ 'org-log-refile': 'time', 'org-log-into-drawer': 'LOGBOOK' }, '* A\n* B\n')), 'with a log drawer the line is in it');
ok(new RegExp(`^\\* B\\n\\*\\* A\\n- Refiled on ${RT} \\\\\\\\\\n  n$`).test(await refileWith({ 'org-log-refile': 'note' }, '* A\n* B\n', 'n')), 'org-log-refile note adds the note under the line');
ok(!(await refileWith({}, '* A\n* B\n')).includes('Refiled'), 'without org-log-refile nothing is logged');

// #+STARTUP log options beat the settings; org-log-note-headings and the clock-out note
const norm = async () => (await text()).replace(/\[\d{4}-\d\d-\d\d \w{3} \d\d:\d\d\]/g, '[T]');
const saveNote = async (t) => { await page.locator('.sheet textarea').fill(t); await page.locator('.sheet').getByRole('button', { name: 'Save', exact: true }).click(); };
await setting({ 'view.emacsKeys': 'true' });
await at('#+STARTUP: lognotedone\n* TODO a\n', 2);
await ctrl('c'); await ctrl('t'); await saveNote('why');
ok((await norm()) === '#+STARTUP: lognotedone\n* DONE a\nCLOSED: [T]\n- CLOSING NOTE [T] \\\\\n  why', '#+STARTUP: lognotedone asks for a closing note');
await setting({ 'view.emacsKeys': 'true', 'org-log-done': 'time' });
await at('#+STARTUP: nologdone\n* TODO a\n', 2);
await ctrl('c'); await ctrl('t');
ok((await text()) === '#+STARTUP: nologdone\n* DONE a\n', '#+STARTUP: nologdone beats org-log-done');
await setting({ 'view.emacsKeys': 'true', 'org-log-done': 'note', 'org-log-note-headings': JSON.stringify({ done: 'CLOSE %t' }) });
await at('* TODO a\n', 1);
await ctrl('c'); await ctrl('t'); await saveNote('n');
ok((await norm()) === '* DONE a\nCLOSED: [T]\n- CLOSE [T] \\\\\n  n', 'org-log-note-headings changes the closing note heading');
await setting({ 'view.emacsKeys': 'true', 'org-log-note-clock-out': 't' });
await at('* TODO a\n', 1);
await ctrl('c'); await ctrl('x'); await ctrl('i');
await ctrl('c'); await ctrl('x'); await ctrl('o'); await saveNote('stopped');
ok((await norm()).replace(/=>  0:0\d/, '=>  0:00') === '* TODO a\n:LOGBOOK:\nCLOCK: [T]--[T] =>  0:00\n- stopped\n:END:\n', 'a clock-out note goes under the clock line');

// C-u C-c C-s and C-u C-c C-d take the date away and log it (Emacs: ds-*); a log mark on any keyword makes leaving done drop CLOSED
await setting({ 'view.emacsKeys': 'true', 'org-log-reschedule': 'time', 'org-log-redeadline': 'time' });
await at('* TODO a\nSCHEDULED: <2026-11-20 Fri>\n', 1);
await ctrl('u'); await ctrl('c'); await ctrl('s');
ok(/^\* TODO a\n- Not scheduled, was "\[2026-11-20 Fri\]" on \[[^\]]+\]$/.test(await text()), 'C-u C-c C-s removes the schedule and logs it');
ok((await page.textContent('#message')).includes('Entry is no longer scheduled.'), 'and says so');
await at('* TODO a\nDEADLINE: <2026-11-20 Fri>\n', 1);
await ctrl('u'); await ctrl('c'); await ctrl('d');
ok(/^\* TODO a\n- Removed deadline, was "\[2026-11-20 Fri\]" on \[[^\]]+\]$/.test(await text()), 'C-u C-c C-d removes the deadline and logs it');
await at('* TODO a\n', 1);
await ctrl('u'); await ctrl('c'); await ctrl('s');
ok((await text()) === '* TODO a\n' && (await page.textContent('#message')).includes('Entry was not scheduled'), 'with nothing scheduled it only says so');
await setting({ 'view.emacsKeys': 'true' });
await at('#+TODO: TODO(t) WAIT(w@/!) | DONE(d!)\n* DONE a\nCLOSED: [2026-11-01 Sun 08:00]\n', 2);
await page.evaluate(() => document.getElementById('editor').dispatchEvent(new Event('input')));
await ctrl('c'); await ctrl('t');
ok(!(await text()).includes('CLOSED'), 'leaving a done keyword that has a log mark drops CLOSED');


ok(errors.length === 0, 'no page errors');
await close();
process.exit(failed ? 1 : 0);
