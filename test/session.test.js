import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSession, SCRATCH } from '../app/ui/session.js';
import { createMemoryInterface } from '../app/interface/memory.js';

const make = () => { const app = createMemoryInterface(); return { app, s: createSession({ app }) }; };
const titles = (s) => s.state().buffers.map((b) => b.title);

test('an empty scratch is not modified until it has text', () => {
  const { s } = make();
  const a = s.newScratch();
  assert.equal(s.state().buffers[0].dirty, false);
  s.setText(a, 'x');
  assert.equal(s.state().buffers[0].dirty, true);
});

test('new buffers are *scratch*, then *scratch*<2>, and need a name to save', async () => {
  const { s } = make();
  const a = s.newScratch(); const b = s.newScratch();
  assert.deepEqual(titles(s), [SCRATCH, `${SCRATCH}<2>`]);
  assert.equal(s.state().current, b);
  assert.deepEqual(await s.save(a), { status: 'needs-name' });
});

test('open reads a file, a second open switches to the same tab, a missing file is reported', async () => {
  const { app, s } = make();
  await app.storage.write('local:a.org', 'one');
  const r = await s.openFile('local:a.org');
  assert.ok(r.ok);
  s.newScratch();
  assert.equal((await s.openFile('local:a.org')).id, r.id);
  assert.equal(s.state().current, r.id);
  assert.equal(s.state().buffers.length, 2);
  assert.deepEqual(await s.openFile('local:nope.org'), { ok: false, reason: 'missing' });
});

test('edit marks dirty, save clears it, and the file holds the text', async () => {
  const { app, s } = make();
  await app.storage.write('local:a.org', 'one');
  const { id } = await s.openFile('local:a.org');
  assert.equal(s.state().buffers[0].dirty, false);
  s.setText(id, 'two');
  assert.equal(s.state().buffers[0].dirty, true);
  assert.deepEqual(await s.save(id), { status: 'saved' });
  assert.equal(s.state().buffers[0].dirty, false);
  assert.equal((await app.storage.read('local:a.org')).text, 'two');
});

test('save as: a new name works, an existing one is reported until overwrite is chosen', async () => {
  const { app, s } = make();
  const id = s.newScratch();
  s.setText(id, 'hello');
  assert.deepEqual(await s.saveAs(id, 'local:n.org'), { status: 'saved' });
  assert.equal(s.state().buffers[0].title, 'n.org');
  assert.equal(s.state().buffers[0].name, 'local:n.org');
  const other = s.newScratch();
  s.setText(other, 'second');
  const r = await s.saveAs(other, 'local:n.org');
  assert.equal(r.status, 'exists');
  assert.equal(r.size, 5);
  assert.equal((await app.storage.read('local:n.org')).text, 'hello');
  assert.deepEqual(await s.saveAs(other, 'local:n.org', { overwrite: true }), { status: 'saved' });
  assert.equal((await app.storage.read('local:n.org')).text, 'second');
});

test('a changed server copy gives a conflict with base, mine and theirs; settle then save sends it', async () => {
  const { app, s } = make();
  await app.storage.write('local:a.org', 'a\nb\nc\n');
  const { id } = await s.openFile('local:a.org');
  s.setText(id, 'A\nb\nc\n');
  const cur = (await app.storage.read('local:a.org')).version;
  await app.storage.write('local:a.org', 'a\nb\nC\n', { baseVersion: cur });
  const r = await s.save(id);
  assert.equal(r.status, 'conflict');
  const c = r.conflict;
  assert.deepEqual([c.base, c.mine, c.theirs], ['a\nb\nc\n', 'A\nb\nc\n', 'a\nb\nC\n']);
  const m = s.merge(c);
  assert.equal(m.clean, true);
  s.settle(c, m.text);
  assert.equal(s.state().buffers[0].dirty, true);
  assert.deepEqual(await s.save(id), { status: 'saved' });
  assert.equal((await app.storage.read('local:a.org')).text, 'A\nb\nC\n');
});

test('close refuses unsaved work unless forced; an empty scratch closes freely', async () => {
  const { app, s } = make();
  await app.storage.write('local:a.org', 'x');
  const { id } = await s.openFile('local:a.org');
  s.setText(id, 'y');
  assert.equal(s.close(id), false);
  const e = s.newScratch();
  assert.equal(s.close(e), true);
  assert.equal(s.close(id, { force: true }), true);
  assert.equal(s.state().current, null);
});

test('unsavedIds lists dirty files and scratch buffers with text', async () => {
  const { app, s } = make();
  await app.storage.write('local:a.org', 'x');
  const a = (await s.openFile('local:a.org')).id;
  const e = s.newScratch();
  const t = s.newScratch();
  s.setText(t, 'note');
  s.setText(a, 'z');
  assert.deepEqual(s.unsavedIds(), [a, t]);
  assert.ok(!s.unsavedIds().includes(e));
});

test('refresh takes a changed server copy into a clean buffer, and leaves unsaved edits alone', async () => {
  const { app, s } = make();
  await app.storage.write('local:a.org', 'one');
  const { id } = await s.openFile('local:a.org');
  const v = (await app.storage.read('local:a.org')).version;
  await app.storage.write('local:a.org', 'two', { baseVersion: v });
  await s.refresh('local:a.org');
  assert.equal(s.state().buffers[0].text, 'two');
  assert.equal(s.state().buffers[0].dirty, false);
  s.setText(id, 'mine');
  const v2 = (await app.storage.read('local:a.org')).version;
  await app.storage.write('local:a.org', 'three', { baseVersion: v2 });
  await s.refresh('local:a.org');
  assert.equal(s.state().buffers[0].text, 'mine');
  await s.refresh('local:nope.org');
});

test('undo and redo walk the text back and forth; a new edit drops redo', () => {
  const { s } = make();
  const a = s.newScratch();
  const text = () => s.state().buffers[0].text;
  s.apply(a, { text: 'one' });
  s.apply(a, { text: 'one two' });
  assert.equal(s.undo(a), 3);
  assert.equal(text(), 'one');
  assert.equal(s.redo(a), 7);
  assert.equal(text(), 'one two');
  s.undo(a);
  s.apply(a, { text: 'other' });
  assert.equal(s.redo(a), null);
  assert.equal(s.undo(a), 3);
  assert.equal(text(), 'one');
});

test('quick typing is one undo step, other edits are their own', () => {
  const { s } = make();
  const a = s.newScratch();
  for (const t of ['a', 'ab', 'abc']) s.setText(a, t);
  s.apply(a, { text: 'abcd' });
  s.undo(a);
  assert.equal(s.state().buffers[0].text, 'abc');
  s.undo(a);
  assert.equal(s.state().buffers[0].text, '');
  assert.equal(s.undo(a), null);
});

test('restore reopens files and scratch drafts, keeps unsaved edits and the current tab, and reports unreadable files', async () => {
  const { app, s } = make();
  await app.storage.write('local:a.org', '* One\nbody\n');
  await app.storage.write('local:b.org', 'two');
  const a = (await s.openFile('local:a.org')).id;
  await s.openFile('local:b.org');
  s.setText(a, '* One\nbody edited\n');
  const scratch = s.newScratch();
  s.setText(scratch, 'notes');
  s.select(a);
  const snap = JSON.parse(JSON.stringify(s.snapshot()));

  const again = createSession({ app });
  await app.storage.remove('local:b.org');
  const r = await again.restore(snap);
  assert.equal(r.opened, 2);
  assert.deepEqual(r.skipped, ['local:b.org']);
  const st = again.state();
  assert.deepEqual(st.buffers.map((b) => b.text), ['* One\nbody edited\n', 'notes']);
  assert.equal(st.buffers[0].dirty, true);
  assert.equal(st.current, st.buffers[0].id);
});

test('restore asks for every file at once, so slow storage costs the slowest read and not the sum', async () => {
  const { app, s } = make();
  for (const n of ['a', 'b', 'c', 'd']) { await app.storage.write(`local:${n}.org`, n); await s.openFile(`local:${n}.org`); }
  const snap = JSON.parse(JSON.stringify(s.snapshot()));
  const read = app.storage.read.bind(app.storage);
  let active = 0, peak = 0;
  app.storage.read = async (name) => { active++; peak = Math.max(peak, active); await new Promise((r) => setTimeout(r, 30)); active--; return read(name); };
  const again = createSession({ app });
  const r = await again.restore(snap);
  assert.equal(r.opened, 4);
  assert.equal(peak, 4);
  assert.deepEqual(again.state().buffers.map((b) => b.text), ['a', 'b', 'c', 'd']);
});

test('a sample opened as a scratch buffer is unmodified until it is edited', () => {
  const { s } = make();
  const id = s.newScratch('sample.org', '* A\n');
  assert.equal(s.state().buffers[0].dirty, false);
  assert.deepEqual(s.unsavedIds(), []);
  s.setText(id, '* B\n');
  assert.equal(s.state().buffers[0].dirty, true);
});

test('check reloads a changed file, keeps unsaved edits, and notices a deleted file', async () => {
  const { app, s } = make();
  await app.storage.write('a.org', '* A\n');
  const r = await s.openFile('a.org');
  assert.equal(await s.check(r.id), 'same');
  const bump = async (text) => app.storage.write('a.org', text, { baseVersion: (await app.storage.read('a.org')).version });
  await bump('* A2\n');
  assert.equal(await s.check(r.id), 'reloaded');
  assert.equal(s.state().buffers[0].text, '* A2\n');
  await bump('* A3\n');
  s.setText(r.id, '* mine\n');
  assert.equal(await s.check(r.id), 'changed');
  assert.equal(s.state().buffers[0].text, '* mine\n');
  assert.equal(await s.check(s.newScratch()), 'new');
  await app.storage.remove('a.org');
  assert.equal(await s.check(r.id), 'gone');
});
