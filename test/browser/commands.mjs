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
await page.click('#btn-menu'); await btn('Settings').click(); await btn(/Emacs keys/).click(); await btn('Close').click();
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
await page.click('#btn-menu'); await btn('Settings').click(); await btn(/Key event log/).click(); await btn('Close').click();
await at('x\n', 1); await page.keyboard.press('Control+e');
const logged = await page.locator('#keylog').textContent();
ok(logged.includes('keydown') && logged.includes('chord C-e run end-of-line'), 'the key event log lists key events and the chord they became');

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
await page.keyboard.press('y'); await page.keyboard.press('n'); await page.keyboard.press('y');
ok((await text()) === 'b a b a\n', 'y replaces, n skips');
await page.keyboard.press('q');
ok((await text()) === 'b a b a\n' && (await page.locator('#findbar').isHidden()), 'q stops and closes the row');
await at('a a a\n', 1);
await page.keyboard.press('Alt+%'); await page.keyboard.type('a'); await page.keyboard.press('Enter'); await page.keyboard.type('b'); await page.keyboard.press('Enter');
await page.locator('#findbar button[aria-label="Answer !"]').click();
ok((await text()) === 'b b b\n', 'the ! button replaces the rest');

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
await page.keyboard.press('Tab');
ok(!(await page.evaluate(() => document.getElementById('editor').value)).includes('match here'), 'the first TAB folds the heading');

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

// Menu: Commands
await page.click('#btn-menu');
const items = await sheet.locator('.item').allTextContents();
ok(items[0].startsWith('Commands') && items[1].startsWith('Settings'), 'the menu has Commands above Settings');
await btn(/Commands/).click(); await page.keyboard.type('flip');
await page.keyboard.press('Escape');
ok(errors.length === 0, `no page errors ${errors.join('; ')}`);
await close();
process.exit(failed ? 1 : 0);
