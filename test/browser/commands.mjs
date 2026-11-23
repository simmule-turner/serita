// The minibuffer, Find row, priorities, properties, the shifted arrows and the command palette in headless Chrome.
// Expected texts are what Emacs 29.3 gave for the same keys (cases pri-*, prop-*, todo2-*).
import { start } from './harness.mjs';

const { base, browser, close } = await start();
let failed = 0;
const ok = (c, m) => { console.log(`${c ? 'ok    ' : 'FAIL  '}commands: ${m}`); if (!c) failed++; };
const page = await (await browser.newContext({ viewport: { width: 393, height: 800 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(`${base}/`);
await page.waitForSelector('.tab.current');
const sheet = page.locator('.sheet');
const btn = (n) => sheet.getByRole('button', { name: n, exact: true });
await page.click('#btn-menu'); await btn('Settings').click(); await btn(/22 settings/).click(); await btn(/Emacs keys/).click(); await btn('‹ Settings').click(); await btn('Close').click();
const at = async (text, line) => {
  await page.fill('#editor', text);
  await page.evaluate((l) => { const e = document.getElementById('editor'); const o = e.value.split('\n').slice(0, l - 1).reduce((n, s) => n + s.length + 1, 0); e.focus(); e.setSelectionRange(o, o); }, line);
};
const text = () => page.inputValue('#editor');
const ctrl = async (k) => { await page.locator('#keyrow button', { hasText: 'Ctrl' }).click(); await page.keyboard.press(k); };
const mini = () => page.locator('#findbar input');
const sel = () => page.evaluate(() => { const e = document.getElementById('editor'); return `${e.selectionStart}-${e.selectionEnd}`; });
const prompt = () => page.locator('#findbar .prompt').textContent();

// Priorities and TODO from the shifted arrows (Emacs: pri-*, todo2-*)
await at('* TODO A :work:\n', 1); await page.keyboard.press('Shift+ArrowUp');
ok((await text()) === `* TODO [#B] A${' '.repeat(58)}:work:\n`, 'S-up gives [#B] and keeps the tags aligned');
await at('* TODO [#C] A\n', 1); await page.keyboard.press('Shift+ArrowDown');
ok((await text()) === '* TODO A\n', 'S-down past C removes the priority');
await at('#+TODO: TODO NEXT | DONE\n* DONE A\n', 2); await page.keyboard.press('Shift+ArrowLeft');
ok((await text()) === '#+TODO: TODO NEXT | DONE\n* NEXT A\n', 'S-left goes back one state');
await at('* A\nbody\n', 2); await ctrl('c'); await ctrl('t');
ok((await text()) === '* TODO A\nbody\n', 'C-c C-t on a body line changes its heading');
await at('abc\n', 1); await page.keyboard.press('Shift+ArrowRight');
ok(await page.evaluate(() => document.getElementById('editor').selectionEnd === 1), 'off a heading S-right still selects');

// Priority prompt (pri-set, pri-clear)
await at('* TODO A\n', 1); await ctrl('c'); await page.keyboard.press(',');
ok(await page.locator('#findbar .prompt').textContent() === 'Priority A-C, SPC to remove:', 'C-c , opens the priority prompt in the minibuffer');
await page.keyboard.type('B'); await page.keyboard.press('Enter');
ok((await text()) === '* TODO [#B] A\n', 'the prompt sets [#B]');
await ctrl('c'); await page.keyboard.press(','); await page.keyboard.type(' '); await page.keyboard.press('Enter');
ok((await text()) === '* TODO A\n', 'SPC removes the priority');

// Properties (prop-*)
await at('* H\nbody\n', 2); await ctrl('c'); await ctrl('x'); await page.keyboard.press('p');
ok(await page.locator('#findbar .prompt').textContent() === 'Property:', 'C-c C-x p asks for the property');
await page.keyboard.type('Foo'); await page.keyboard.press('Enter'); await page.keyboard.type('bar'); await page.keyboard.press('Enter');
ok((await text()) === '* H\n:PROPERTIES:...\nbody\n', 'the property goes into a new drawer under the heading, which starts folded');
await at('* H\n:PROPERTIES:\n:Foo: bar\n:Baz: qux\n:END:\n', 1);
await page.keyboard.press('Alt+x'); await page.keyboard.type('org-delete-property'); await page.keyboard.press('Enter');
await page.keyboard.type('Foo'); await page.keyboard.press('Enter');
ok(!(await text()).includes('Foo') && (await text()).includes('PROPERTIES'), 'M-x org-delete-property removes the property and keeps the drawer');

// M-x
await page.keyboard.press('Alt+x'); await page.keyboard.type('tags');
ok((await page.locator('#completions .choice').count()) >= 1, 'M-x lists matching commands as you type');
await page.keyboard.press('Escape');
ok(await page.locator('#findbar').isHidden() && await page.locator('#completions').isHidden(), 'Escape closes the minibuffer');

// Find row
await at('plant Plant\n', 1); await page.click('#btn-find');
const box = await page.locator('#findbar button').first().boundingBox();
ok(Math.round(box.width) === 36 && Math.round(box.height) === 36, 'the Find buttons are 36 px');
await page.keyboard.type('zzz');
ok(await page.locator('#findbar .prompt').textContent() === 'Failing I-search:', 'a failing search says so in the prompt');
await page.keyboard.press('Control+a'); await page.keyboard.type('plant');
ok(await page.locator('#findbar .prompt').textContent() === 'I-search:', 'a hit shows the plain prompt');
await page.keyboard.press('Escape');

// C-s and C-r start a search from the keyboard; the cancel button goes back to where it began
await at('one two one two one\n', 1);
await page.evaluate(() => { const e = document.getElementById('editor'); e.setSelectionRange(8, 8); });
await page.keyboard.press('Control+s'); await page.keyboard.type('one');
ok(await page.locator('#findbar .prompt').textContent() === 'I-search:', 'C-s opens Find');
await page.keyboard.press('Control+s');
await page.getByLabel('Cancel search').click();
ok(await page.evaluate(() => { const e = document.getElementById('editor'); return e.selectionStart === 8 && e.selectionEnd === 8; }), 'cancelling returns the cursor to where the search began');
await page.keyboard.press('Control+r'); await page.keyboard.type('two');
ok(await page.locator('#findbar .prompt').textContent() === 'I-search backward:', 'C-r opens a backward search');
ok(await page.evaluate(() => { const e = document.getElementById('editor'); return e.selectionStart === 4; }), 'C-r finds the match before the cursor');
await page.keyboard.press('Escape');

// Letters from an on-screen keyboard arrive as an Unidentified key press (code 229) and then typed text: with Ctrl held on the key row they are chords
const soft = (c) => page.evaluate(() => document.getElementById('editor').dispatchEvent(new KeyboardEvent('keydown', { key: 'Unidentified', keyCode: 229, bubbles: true, cancelable: true }))).then(() => page.keyboard.insertText(c));
await at('ab\ncd\n', 1);
await page.locator('#keyrow button', { hasText: 'Ctrl' }).click(); await soft('n');
ok((await text()) === 'ab\ncd\n' && await page.evaluate(() => document.getElementById('editor').selectionStart === 3), 'Ctrl on the key row and a typed n is C-n');
await page.locator('#keyrow button', { hasText: 'Ctrl' }).click(); await soft('s');
ok(await page.locator('#findbar .prompt').textContent() === 'I-search:', 'Ctrl and a typed s is C-s');
await page.keyboard.press('Escape');
await at('* H\n', 1);
await page.locator('#keyrow button', { hasText: 'Ctrl' }).click(); await soft('c');
await page.locator('#keyrow button', { hasText: 'Ctrl' }).click(); await soft('t');
ok((await text()) === '* TODO H\n', 'C-c C-t from typed letters changes the TODO state');

// The key event log shows what the keyboard sends
await page.click('#btn-menu'); await btn('Settings').click(); await btn(/Key event log/).click(); await btn('Turn on').click(); await btn('Close').click(); await btn('Close').click();
await at('x\n', 1); await page.keyboard.press('Control+e');
await page.click('#btn-menu'); await btn('Settings').click(); await btn(/Key event log/).click();
const logged = await page.locator('.keylogtext').textContent();
ok(logged.includes('keydown') && logged.includes('chord C-e run end-of-line'), 'the key event log screen lists key events and the chord they became');
ok(await btn('Copy').count() === 1 && await btn('Clear').count() === 1, 'the log can be copied and cleared');
await btn('Close').click(); await btn('Close').click();

// Movement and search scroll the text to the cursor
const long = Array.from({ length: 200 }, (_, i) => `line ${i + 1}`).join('\n') + '\nneedle\n';
await at(long, 1);
const visible = () => page.evaluate(() => { const e = document.getElementById('editor'); const lh = parseFloat(getComputedStyle(e).lineHeight); const row = e.value.slice(0, e.selectionStart).split('\n').length - 1; const y = 10 + row * lh; return y >= e.scrollTop && y <= e.scrollTop + e.clientHeight; });
await page.keyboard.press('Alt+>');
ok(await visible() && await page.evaluate(() => document.getElementById('editor').scrollTop > 1000), 'M-> shows the end of the buffer');
await page.keyboard.press('Alt+<');
ok(await visible() && await page.evaluate(() => document.getElementById('editor').scrollTop === 0), 'M-< shows the start of the buffer');
await page.keyboard.press('Control+s'); await page.keyboard.type('needle');
ok(await visible(), 'a search scrolls to the match');
await page.keyboard.press('Escape');

// The key row's arrows are next-line, previous-line, forward-char and backward-char
await at('long line here\nab\nlong line here\n', 1);
await page.evaluate(() => document.getElementById('editor').setSelectionRange(8, 8));
const rowKey = (n) => page.locator('#keyrow button', { hasText: n }).click();
const where = () => page.evaluate(() => { const e = document.getElementById('editor'); const b = e.value.slice(0, e.selectionStart).split('\n'); return `${b.length}:${b.at(-1).length}`; });
await rowKey('↓'); ok((await where()) === '2:2', 'the down arrow stops at the end of a short line');
await rowKey('↓'); ok((await where()) === '3:8', 'and keeps the goal column, as C-n does');
await rowKey('→'); await rowKey('←'); ok((await where()) === '3:8', 'the right and left arrows move one character');

// The first C-g in a failing search removes the failing text (Emacs: is2-fail-g1, is2-fail-g2)
await at('one two one two one\nthree\n', 1);
await page.keyboard.press('Control+s'); await page.keyboard.type('onx');
await page.keyboard.press('Control+g');
ok(await page.locator('#findbar input').inputValue() === 'on' && await page.locator('#findbar .prompt').textContent() === 'I-search:', 'the first C-g in a failing search removes the failing text');
await page.keyboard.press('Control+g');
ok(await page.locator('#findbar').isHidden(), 'a second C-g ends the search');

// Query replace (M-%): Emacs's keys y n ! q
await at('a a a a\n', 1);
await page.keyboard.press('Alt+%');
ok((await prompt()) === 'Query replace:', 'M-% asks for the text to replace');
await page.keyboard.type('a'); await page.keyboard.press('Enter');
ok((await prompt()) === 'Query replace a with:', 'then for the replacement');
await page.keyboard.type('b'); await page.keyboard.press('Enter');
ok((await prompt()) === 'Query replacing a with b: (? for help)', 'the per-match prompt is Emacs\'s');
ok(await page.evaluate(() => { const f = document.querySelector('#findbar .field').getBoundingClientRect(); const b = document.querySelector('#findbar button').getBoundingClientRect(); return b.top >= f.bottom - 1; }), 'the answer buttons sit on a row below the prompt');
await page.keyboard.press('y'); await page.keyboard.press('n'); await page.keyboard.press('y');
ok((await text()) === 'b a b a\n', 'y replaces, n skips');
await page.keyboard.press('q');
ok((await text()) === 'b a b a\n' && (await page.locator('#findbar').isHidden()), 'q stops and closes the row');
await at('a a a\n', 1);
await page.keyboard.press('Alt+%'); await page.keyboard.type('a'); await page.keyboard.press('Enter'); await page.keyboard.type('b'); await page.keyboard.press('Enter');
await page.locator('#findbar button[aria-label="Answer !"]').click();
ok((await text()) === 'b b b\n', 'the ! button replaces the rest');

// Timestamps: S-up on a stamp, C-c C-s, C-c C-d, C-c . (Emacs: ts-* cases)
await at('* TODO Pay rent\nSCHEDULED: <2026-11-30 Mon>\n', 2);
await page.evaluate(() => { const e = document.getElementById('editor'); const o = e.value.indexOf('30'); e.focus(); e.setSelectionRange(o, o); });
await page.keyboard.press('Shift+ArrowUp');
ok((await text()) === '* TODO Pay rent\nSCHEDULED: <2026-12-01 Tue>\n', 'S-up on the day of a stamp makes it the next day');
await at('* TODO Pay rent\nSCHEDULED: <2026-11-30 Mon>\n', 2);
await page.evaluate(() => { const e = document.getElementById('editor'); const o = e.value.indexOf('30'); e.focus(); e.setSelectionRange(o, o); });
await page.locator('#keyrow button', { hasText: 'Shift' }).click(); await page.locator('#keyrow button[aria-label*="up" i], #keyrow button:has-text("↑")').first().click();
ok((await text()) === '* TODO Pay rent\nSCHEDULED: <2026-12-01 Tue>\n', 'Shift and the key row arrow change the timestamp instead of selecting');
await at('* TODO Pay rent\nSCHEDULED: <2026-11-30 Mon>\n', 2);
await page.evaluate(() => { const e = document.getElementById('editor'); const o = e.value.indexOf('2026'); e.focus(); e.setSelectionRange(o, o); });
await page.keyboard.press('Shift+ArrowRight');
ok((await text()) === '* TODO Pay rent\nSCHEDULED: <2026-12-01 Tue>\n', 'S-right on a stamp moves the date a day, wherever the cursor is in it (Emacs: ts-sright-year)');
await at('* TODO Report\n', 1); await ctrl('c'); await ctrl('s');
ok((await prompt()).startsWith('SCHEDULED Date+time ['), 'C-c C-s asks for a date');
await page.keyboard.type('2026-12-01'); await page.keyboard.press('Enter');
ok((await text()) === '* TODO Report\nSCHEDULED: <2026-12-01 Tue>\n', 'the date lands on a planning line');
await at('* TODO Report\n', 1); await ctrl('c'); await ctrl('d');
await page.keyboard.type('2026-12-25'); await page.keyboard.press('Enter');
ok((await text()) === '* TODO Report\nDEADLINE: <2026-12-25 Fri>\n', 'C-c C-d sets a deadline');

// Sparse tree (C-c / r) and C-c C-c to clear its highlights
const sparseText = '* Alpha\nbody a\n** Sub\nmatch here\n* Beta\nbody b\n';
await at(sparseText, 1);
await ctrl('c'); await page.keyboard.press('/'); await page.keyboard.press('r');
ok((await prompt()) === 'Regexp:', 'C-c / r asks for a regexp');
await page.keyboard.type('MATCH'); await page.keyboard.press('Enter');
const lines = await page.evaluate(() => document.getElementById('editor').value);
ok(lines.includes('match here') && lines.includes('Sub') && !lines.includes('body a') && !lines.includes('body b'), 'only the match and the headings above it show');
await ctrl('c'); await ctrl('c');
ok(await page.locator('#hl mark').count() === 0, 'C-c C-c removes the highlights');
await at('* TODO A\n* TODO B\n* C\n', 1); await ctrl('c'); await page.keyboard.press('/'); await page.keyboard.press('t');
ok(await page.locator('#hl mark').count() === 2 && (await page.locator('#hl mark').first().textContent()) === 'TODO', 'C-c / t highlights the TODO keyword of each entry');
await page.keyboard.press('Tab');
ok(!(await page.evaluate(() => document.getElementById('editor').value)).includes('match here'), 'the first TAB folds the heading');

// A sparse tree keeps the cursor on its text
await at('* A\nbody\n* B\nneedle here\n', 4);
await ctrl('c'); await page.keyboard.press('/'); await page.keyboard.press('r'); await page.keyboard.type('needle'); await page.keyboard.press('Enter');
ok(await page.evaluate(() => { const e = document.getElementById('editor'); return e.value.slice(0, e.selectionStart).split('\n').pop() === '' && e.value.split('\n')[e.value.slice(0, e.selectionStart).split('\n').length - 1].startsWith('needle'); }), 'after a sparse tree the cursor is still on the matching line');

// Sparse tree by tag (C-c / m): tags are inherited, so work shows Sub two but not the body lines
await at('* A :work:\nbody\n** B\nnote\n* C\nother\n', 1);
await ctrl('c'); await page.keyboard.press('/'); await page.keyboard.press('m');
ok((await prompt()) === 'Match:', 'C-c / m asks for a match');
await page.keyboard.type('work'); await page.keyboard.press('Enter');
const byTag = await page.evaluate(() => document.getElementById('editor').value);
ok(byTag.includes('** B') && !byTag.includes('note') && !byTag.includes('body'), 'headings that carry the tag, or inherit it, show; their text does not');

// Back: M-> leaves a place; the button returns to it; a long press says where it goes; C-x C-SPC does the same as a tap
for (let i = 0; i < 40 && await page.locator('#back').isVisible(); i++) await page.locator('#back').click();
await at('one\ntwo\nthree\nfour\n', 2);
ok(await page.locator('#back').isHidden(), 'Back is hidden when there is nowhere to go');
await page.keyboard.press('Alt+>');
ok(await page.locator('#back').isVisible(), 'Back shows after a jump');
const before = await sel();
await page.locator('#back').dispatchEvent('pointerdown'); await page.waitForTimeout(650); await page.locator('#back').dispatchEvent('pointerup');
ok((await page.locator('#backnote').textContent()).startsWith('Back to ') && (await page.locator('#backnote').textContent()).endsWith('line 2') && (await sel()) === before, 'a long press says where Back goes and does not go');
await page.locator('#back').click();
ok((await sel()) === '4-4' && await page.locator('#back').isHidden(), 'tapping Back returns to the place and hides the button');
await page.keyboard.press('Alt+>');
await ctrl('x'); await page.keyboard.press('Control+ ');
ok((await sel()) === '4-4', 'C-x C-SPC goes back too');
// Effort: C-c C-x e asks and sets the Effort property (Emacs: ef-* cases)
await at('* A\n', 1);
await page.keyboard.press('Alt+x'); await page.keyboard.type('org-set-effort'); await page.keyboard.press('Enter');
await page.keyboard.type('2:00'); await page.keyboard.press('Enter');
ok((await text()) === '* A\n:PROPERTIES:\n:Effort:   2:00\n:END:\n' && (await page.locator('#message').textContent()) === 'Effort is now 2:00', 'Set effort writes :Effort: and says so');
await at('* A\n', 1);
await page.keyboard.press('Alt+x'); await page.keyboard.type('org-set-effort'); await page.keyboard.press('Enter');
await page.keyboard.type('abc'); await page.keyboard.press('Enter');
ok((await text()) === '* A\n' && (await page.locator('#message').textContent()).startsWith('Invalid duration format'), 'an effort that is not a duration is refused');

// Clocking: in writes the CLOCK entry, out closes it, cancel removes it (Emacs: ck-* cases)
await at('* A\n', 1);
const run = async (cmd) => { await page.keyboard.press('Alt+x'); await page.keyboard.type(cmd); await page.keyboard.press('Enter'); };
await run('org-clock-in');
ok(/^\* A\n:LOGBOOK:\nCLOCK: \[\d{4}-\d\d-\d\d \w+ \d\d:\d\d\]\n:END:\n$/.test(await text()) && (await page.locator('#message').textContent()).startsWith('Clock starts at ['), 'Clock in writes a CLOCK entry');
await run('org-clock-out');
ok(/--\[[^\]]+\] =>  0:0[01]\n/.test(await text()) && (await page.locator('#message').textContent()).startsWith('Clock stopped at ['), 'Clock out records the time spent');
await at('* A\n', 1);
await run('org-clock-in'); await run('org-clock-cancel');
ok((await text()) === '* A\n' && (await page.locator('#message').textContent()) === 'Clock canceled', 'Cancel removes the clock and its drawer');

// The agenda (View, Agenda): a week with a scheduled entry; tapping the row goes to the heading
const nowDate = new Date(); const todayStamp = `${nowDate.getFullYear()}-${String(nowDate.getMonth() + 1).padStart(2, '0')}-${String(nowDate.getDate()).padStart(2, '0')} ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][nowDate.getDay()]} 10:00`;
await at(`* TODO Pay rent :home:\nSCHEDULED: <2999-01-01 Mon>\n* Other\n* Timed\n<${todayStamp}>\n`, 1);
// The agenda reads the agenda files: with none listed it is empty; the file is listed with C-c [ (org-agenda-file-to-front)
await page.click('#btn-files'); await btn('Save as').click(); await sheet.getByLabel('File name').fill('agenda-test.org'); await btn('Save').click();
await page.waitForFunction(() => document.getElementById('message').textContent.startsWith('Wrote'));
await page.click('#btn-view'); await btn('Agenda').click();
ok(await page.locator('.sheet.agenda .arow').count() === 0, 'the agenda is empty while no agenda files are listed');
await page.locator('.sheet.agenda .abar button', { hasText: 'Close' }).click();
await page.evaluate(() => document.getElementById('editor').focus());
await page.keyboard.press('Alt+x'); await page.keyboard.type('org-agenda-file-to-front'); await page.keyboard.press('Enter');
ok((await page.locator('#message').textContent()).includes('File added to front of agenda file list'), 'C-c [ lists the current file');
await page.click('#btn-menu'); await btn('Settings').click(); await btn(/22 settings/).click();
ok((await btn(/Agenda files/).textContent()).includes('1 file'), 'Settings shows how many agenda files there are');
await btn(/Agenda files/).click();
ok((await sheet.textContent()).includes('agenda-test.org (App storage)'), 'the Agenda files screen lists the file with its storage');
await btn('Remove').click();
ok((await sheet.textContent()).includes('The agenda is empty until you add one'), 'Remove takes the file off the list');
await btn('Add current file').click();
await btn('Close').click(); await btn('‹ Settings').click(); await btn('Close').click();
await page.click('#btn-view'); await btn('Agenda').click();
ok(JSON.stringify((await page.locator('.sheet.agenda .abar button').allTextContents()).filter((t) => t.trim())).includes('"Day","Week","2 weeks","Month","Year"'), 'the agenda has Day, Week, 2 weeks, Month and Year');
await page.locator('.sheet.agenda .abar button', { hasText: '2 weeks' }).click();
ok(/^Fortnight-agenda/.test((await page.locator('.sheet.agenda').textContent()).trim()) || (await page.locator('.sheet.agenda .aday').count()) === 14, 'the 2 weeks span shows fourteen days');
await page.locator('.sheet.agenda .abar button', { hasText: 'Year' }).click();
ok((await page.locator('.sheet.agenda .aday').count()) >= 365, 'the Year span shows every day of the year');
await page.locator('.sheet.agenda .abar button', { hasText: /^Week$/ }).click();
// Filter and Mark on the TODO list
await page.locator('.sheet.agenda .abar button', { hasText: 'Views' }).click(); await btn('TODO list').click();
await page.locator('.sheet.agenda .abar button', { hasText: /^Filter/ }).click(); await btn(/^Tag/).click();
await page.keyboard.type('+nothing'); await page.keyboard.press('Enter');
ok(await page.locator('.sheet.agenda .arow').count() === 0 && (await page.locator('.sheet.agenda .atitlebar').textContent()).includes('[+nothing]'), 'Filter by a tag nothing has hides every row and shows the filter in the title');
await page.locator('.sheet.agenda .abar button', { hasText: /^Filter/ }).click(); await btn(/^Tag/).click();
await page.keyboard.type('+home'); await page.keyboard.press('Enter');
ok(await page.locator('.sheet.agenda .arow').count() === 1, 'Filter by +home keeps the entry with that tag');
await page.locator('.sheet.agenda .abar button', { hasText: 'Mark' }).click();
await page.locator('.sheet.agenda .arow').first().click();
ok((await page.locator('.sheet.agenda .arow.marked').count()) === 1 && (await page.locator('.sheet.agenda .abar button', { hasText: 'Act on 1' }).count()) === 1, 'Mark turns a tap into a mark and counts them');
await page.locator('.sheet.agenda .abar button', { hasText: 'Act on 1' }).click(); await btn('Priority').click(); await btn('A').click();
await page.waitForFunction(() => document.getElementById('message').textContent.includes('Acted on 1 entries'));
await page.locator('.sheet.agenda .abar button', { hasText: /^Filter/ }).click(); await btn('Clear all filters').click();
ok((await page.locator('.sheet.agenda .arow').first().textContent()).includes('[#A]'), 'the bulk action set the priority of the marked entry');
await page.locator('.sheet.agenda .abar button', { hasText: 'Views' }).click(); await btn('Agenda').click();
await page.locator('.sheet.agenda .abar button', { hasText: 'Close' }).click();
// The calendar: a month, a dot under today (it has an entry), the entries of the tapped day
await page.click('#btn-view'); await btn(/^Calendar/).click();
const monthName = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'][nowDate.getMonth()];
ok((await page.locator('.sheet.calendar .atitlebar').textContent()) === `${monthName} ${nowDate.getFullYear()}`, 'View, Calendar shows this month');
ok(await page.locator('.sheet.calendar .day.today.has').count() === 1, 'today has a dot because an agenda entry is dated today');
ok((await page.locator('.sheet.calendar .arow').first().textContent()).includes('Timed'), 'the entries of the selected day are listed under the month');
await page.getByLabel('Later').click();
ok((await page.locator('.sheet.calendar .atitlebar').textContent()) !== `${monthName} ${nowDate.getFullYear()}`, 'the arrow moves to the next month');
await page.locator('.sheet.calendar .abar button', { hasText: 'Today' }).click();
await page.locator('.sheet.calendar .arow').first().click();
ok((await page.locator('#editor').inputValue()).includes('Timed'), 'tapping an entry opens its heading');
await page.click('#back');
ok(await page.locator('.sheet.calendar').count() === 1, 'Back returns to the calendar');
await page.locator('.sheet.calendar .abar button', { hasText: 'Close' }).click();
await page.click('#btn-view'); await btn('Agenda').click();
{
  const head = async () => (await page.locator('.sheet.agenda .abody .aday').first().textContent());
  const first = await head();
  await page.keyboard.press('f');
  const later = await head();
  await page.keyboard.press('b');
  ok(later !== first && (await head()) === first, 'f moves the agenda later and b earlier, as in Emacs');
  const box = await page.locator('.sheet.agenda .abody').boundingBox();
  const swipe = async (dx) => { const y = box.y + 60; const x = box.x + box.width / 2; await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx, y + 5, { steps: 4 }); await page.mouse.up(); };
  await swipe(-120);
  ok((await head()) === later, 'a swipe left moves the agenda later, like the arrow');
  await swipe(120);
  ok((await head()) === first, 'a swipe right moves it earlier');
  await swipe(-30);
  ok((await head()) === first, 'a short swipe does nothing');
  ok(await page.locator('.sheet.agenda .abar button .chev').count() === 2, 'the arrows are drawn chevrons');
  await page.keyboard.press('f'); await page.keyboard.press('f');
  ok((await head()) !== first, 'two steps later leave this week');
  await page.locator('.sheet.agenda .abar button', { hasText: 'Today' }).click();
  ok((await head()) === first, 'Today returns to the span that holds today');
  await page.keyboard.press('b'); await page.keyboard.press('.');
  ok((await head()) === first, '. goes to today as well');
  ok((await page.locator('.sheet.agenda .agrid').count()) >= 7 && (await page.locator('.sheet.agenda .agrid.now').count()) === 1, 'today with a timed entry shows the time grid and the now line');
}
await page.locator('.sheet.agenda .abar button', { hasText: 'Views' }).click();
await btn('TODO list').click();
ok((await page.locator('.sheet.agenda .atitlebar').textContent()).startsWith('Global list of TODO items'), 'Views, TODO list opens the TODO list');
await page.locator('.sheet.agenda .arow', { hasText: 'Pay rent' }).click();
ok(await page.locator('.sheet.agenda').count() === 0 && (await sel()).startsWith('0-'), 'tapping a row closes the agenda and goes to the heading');
await page.locator('#back').click();
ok(await page.locator('.sheet.agenda').count() === 1, 'Back after an agenda jump returns to the agenda');
await page.locator('.sheet.agenda .abar button', { hasText: 'Close' }).click();

// Regexp search (C-M-s, M-r)
await at('Meeting foo2 notes foo9\n', 1);
await page.keyboard.press('Alt+Control+s');
ok((await prompt()) === 'Regexp I-search:', 'C-M-s opens a regexp search');
await page.keyboard.type('foo[0-9]');
ok((await sel()) === '8-12', 'the regexp finds the first match');
await page.keyboard.press('Control+s');
ok((await sel()) === '19-23', 'C-s goes to the next regexp match');
await page.keyboard.press('Alt+r');
ok((await prompt()) === 'Failing I-search:' || (await prompt()) === 'I-search:', 'M-r switches to plain search');
await page.keyboard.press('Escape');
await page.keyboard.press('Alt+Control+s'); await page.keyboard.type('\\(x');
ok((await prompt()) === 'Failing regexp I-search:', 'an invalid regexp fails');
await page.keyboard.press('Escape');

// Emacs results (v0.1.5): search fails before it wraps, direction changes keep the match, an empty C-s recalls
await at('one two one two one\nthree\n', 1);
await page.evaluate(() => document.getElementById('editor').setSelectionRange(16, 16));
await page.keyboard.press('Control+s'); await page.keyboard.type('one');
await page.keyboard.press('Control+s');
ok((await prompt()) === 'Failing I-search:', 'C-s past the last match fails first');
await page.keyboard.press('Control+s');
ok((await prompt()) === 'Wrapped I-search:' && (await sel()) === '0-3', 'a further C-s wraps to the first match');
await page.keyboard.press('Escape');
await page.evaluate(() => document.getElementById('editor').setSelectionRange(12, 12));
await page.keyboard.press('Control+r'); await page.keyboard.type('one'); await page.keyboard.press('Control+s'); await page.keyboard.press('Enter');
ok((await sel()) === '8-11', 'C-r then C-s keeps the current match');
await page.evaluate(() => document.getElementById('editor').setSelectionRange(0, 0));
await page.keyboard.press('Control+s'); await page.keyboard.type('two'); await page.keyboard.press('Enter');
await page.keyboard.press('Control+s'); await page.keyboard.press('Control+s'); await page.keyboard.press('Enter');
ok((await sel()) === '12-15', 'C-s with an empty field recalls the last search and finds the next match');
await at('foo bar baz\n', 1);
await page.evaluate(() => document.getElementById('editor').setSelectionRange(8, 8));
await page.keyboard.press('Alt+ArrowLeft');
ok((await where()) === '1:4', 'M-left on plain text moves a word back');
await at('* TODO A\n', 1); await page.keyboard.press('Shift+ArrowUp');
ok((await page.locator('#message').textContent()) === 'Priority of current item set to B', 'S-up says what the priority is now');
await at('* A\n', 1); await ctrl('c'); await ctrl('t');
ok((await page.locator('#message').textContent()) === 'TODO state changed to TODO', 'C-c C-t says the new state');
await at('* TODO H\n', 1); await ctrl('c'); await page.keyboard.press(',');
ok((await prompt()) === 'Priority A-C, SPC to remove:', 'the priority prompt is the one Emacs shows');
await page.keyboard.press('Escape');
await at('* H\n', 1); await ctrl('c'); await ctrl('x'); await page.keyboard.press('p'); await page.keyboard.type('Foo'); await page.keyboard.press('Enter');
ok((await prompt()) === 'Foo value:', 'the value prompt names the property');
await page.keyboard.press('Escape');

// Capture: templates are set as init.el writes them; Capture asks the template's questions, shows the text, and files it
await page.click('#btn-menu'); await btn('Settings').click(); await btn(/22 settings/).click(); await btn(/Capture templates/).click();
await sheet.locator('textarea').fill(`(setq org-capture-templates '(("t" "Todo" entry (file+headline "agenda-test.org" "Inbox") "* TODO %^{What}\\n")))`);
await btn('Save').click();
ok((await page.locator('#message').textContent()) === '1 capture template', 'saving the templates counts them');
await btn('‹ Settings').click(); await btn('Close').click();
await page.click('#btn-menu'); await btn('Capture').click();
ok((await sheet.textContent()).includes('t  Todo'), 'Capture lists the templates by key and description');
await btn(/Todo/).click();
ok((await prompt()) === 'What:', 'the template question is asked');
await page.keyboard.type('Milk'); await page.keyboard.press('Enter');
ok((await sheet.locator('textarea').inputValue()) === '* TODO Milk\n', 'the capture screen shows the expanded template');
await btn('Save').click();
await page.waitForFunction(() => /^Captured|does not exist|Heading/.test(document.getElementById('message').textContent));
ok((await page.locator('#message').textContent()) === 'Captured to agenda-test.org', 'Save files the captured text');

// Settings: GitHub and WebDAV say Configured, with the arrow, instead of showing the address
await page.evaluate(() => localStorage.setItem('serita.settings', JSON.stringify({ ...JSON.parse(localStorage.getItem('serita.settings') ?? '{}'), 'webdav.url': 'https://cloud.example.com/remote.php/dav/files/someone/a/very/long/path/to/org-files', 'webdav.username': 'someone' })));
await page.evaluate(() => localStorage.setItem('serita.secrets', JSON.stringify({ ...JSON.parse(localStorage.getItem('serita.secrets') ?? '{}'), 'webdav.password': 'pw' })));
await page.reload(); await page.waitForSelector('.tab.current');
await page.click('#btn-menu'); await btn('Settings').click();
ok((await sheet.locator('.item', { hasText: 'WebDAV' }).locator('.meta').textContent()) === 'Configured ›', 'a set-up WebDAV row says Configured');
ok((await sheet.locator('.item', { hasText: 'GitHub' }).locator('.meta').textContent()) === 'Not set up ›', 'a GitHub row that is not set up says so');
await sheet.getByLabel('Dismiss').click();

// Refile and archive: Refile lists the targets; Archive tags and archives from the command list
await page.click('#btn-menu'); await btn('Settings').click(); await btn(/22 settings/).click();
ok((await sheet.textContent()).includes('Refile targets') && (await sheet.textContent()).includes('Archive location'), 'Settings, Emacs lists Refile targets and Archive location');
const emacsText = await sheet.textContent();
ok(['Archive marks done', 'Archive saves', 'Refile new headings', 'Log repeats'].every((n) => emacsText.includes(n)), 'Settings, Emacs lists the archive, refile and log options');
await btn(/Log repeats/).click(); await btn(/^Note/).click();
ok((await sheet.textContent()).includes('Log repeats: note') && (await sheet.textContent()).includes('Note ›'), 'Log repeats can be set to Note');
await btn(/Archive saves/).click(); await sheet.getByLabel('Archive saves').fill('time bogus'); await btn('Set').click();
ok((await page.locator('#message').textContent()).includes('bogus is not one of'), 'Archive saves refuses a name Emacs does not have');
await btn(/Archive saves/).click(); await sheet.getByLabel('Archive saves').fill('time file'); await btn('Set').click();
ok((await sheet.textContent()).includes('Archive saves: time file'), 'Archive saves keeps the names given');
await btn(/Refile targets/).click(); await btn('Save').click();
ok((await sheet.textContent()).includes('Refile targets set'), 'saving the refile targets says so on the Emacs screen');
await sheet.getByLabel('Dismiss').click();
await page.waitForTimeout(100);
ok((await page.locator('.sheet').count()) === 0, 'the x on the Emacs screen leaves Settings at once');
await page.click('#btn-menu'); await btn(/Commands/).click(); await page.keyboard.type('org-refile'); await page.keyboard.press('Enter');
await page.waitForFunction(() => /Refile to|Not at a heading|No refile/.test(document.body.textContent));
const refileShown = /Refile to/.test(await page.locator('.sheet').first().textContent().catch(() => ''));
if (refileShown) { ok(true, 'Refile lists the targets'); await page.keyboard.press('Escape'); }
else ok(/Not at a heading/.test(await page.locator('#message').textContent()), 'Refile off a heading says so');

// Menu: Commands
await page.click('#btn-menu');
const items = await sheet.locator('.item').allTextContents();
ok(items[0].startsWith('Commands') && items[1].startsWith('Capture') && items[2].startsWith('Settings'), 'the menu has Commands, Capture and Settings');
await btn(/Commands/).click(); await page.keyboard.type('flip');
await page.keyboard.press('Escape');
// The diary: a file of entries, shown in the calendar and the agenda when the setting is on
await at('*/*/* Every day\n', 0);
await page.click('#btn-files'); await btn('Save as').click(); await sheet.getByLabel('File name').fill('diary-test.org'); await btn('Save').click();
await page.waitForFunction(() => document.getElementById('message').textContent.startsWith('Wrote'));
await page.click('#btn-menu'); await btn('Settings').click(); await btn(/22 settings/).click();
await btn(/Diary file/).click(); await sheet.getByLabel('Diary file').fill('diary-test.org'); await btn('Set').click();
await btn(/Diary in the agenda/).click();
ok((await btn(/Diary in the agenda/).textContent()).includes('On') && (await btn(/Diary file/).textContent()).includes('diary-test.org'), 'Settings, Emacs sets the diary file and turns the diary on');
await sheet.getByLabel('Dismiss').click();
await page.click('#btn-view'); await btn(/^Calendar/).click();
await page.locator('.sheet.calendar .arow', { hasText: 'Every day' }).waitFor({ timeout: 3000 }).catch(() => {});
ok((await page.locator('.sheet.calendar .arow').allTextContents()).some((t) => t.includes('Diary') && t.includes('Every day')), 'the calendar lists the diary entry of the day with the category Diary');
await page.locator('.sheet.calendar .abar button', { hasText: 'Close' }).click();
// Settings: the holiday categories and whether holidays show in the agenda
await page.click('#btn-menu'); await btn('Settings').click(); await btn(/22 settings/).click();
ok((await btn(/^Holidays General/).textContent()).includes('General, Christian, Solar'), 'all three holiday categories are on by default');
await btn(/Holidays in the agenda/).click();
ok((await btn(/Holidays in the agenda/).textContent()).includes('On'), 'Holidays in the agenda turns on');
await btn(/^Holidays General/).click(); await btn(/^Solar/).click();
ok((await btn(/^Solar/).textContent()).includes('Off'), 'a holiday category can be turned off');
await sheet.getByLabel('Dismiss').click();
// Holidays: the calendar lists them for the chosen day
await page.click('#btn-view'); await btn(/^Calendar/).click();
for (let i = 0; i < 13 && !/December/.test(await page.locator('.sheet.calendar .atitlebar').textContent()); i++) await page.locator('.sheet.calendar [aria-label="Later"]').click();
await page.locator('.sheet.calendar .day:not(.other)', { hasText: /^25$/ }).click();
ok((await page.locator('.sheet.calendar .arow.holiday').allTextContents()).some((t) => t.includes('Christmas')), 'the calendar lists Christmas on December 25');
await page.locator('.sheet.calendar .abar button', { hasText: 'Close' }).click();
ok(errors.length === 0, `no page errors ${errors.join('; ')}`);
await close();
process.exit(failed ? 1 : 0);
