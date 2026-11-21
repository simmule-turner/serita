import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportSettings, importSettings, inspectSettingsFile, settingsFileName, SettingsFileError } from '../core/settings-file.js';

const settings = { 'editor.tab-width': '8', 'ui.note': 'a "quoted"\nline ✓' };
const secrets = { 'github.token': 'ghp_example', 'webdav.password': 'pä ss' };
const date = '2026-11-21';

test('file name carries the date', () => {
  assert.equal(settingsFileName(date), 'serita-settings-2026-11-21.org');
});

test('without a passphrase: plain Org, round trip, secrets readable', async () => {
  const t = await exportSettings({ settings, secrets, date });
  assert.match(t, /^#\+TITLE: Serita settings\n#\+EXPORTED: 2026-11-21\n/);
  assert.match(t, /:github\.token: "ghp_example"/);
  assert.deepEqual(inspectSettingsFile(t), { settings, encrypted: false, secretCount: 2 });
  assert.deepEqual(await importSettings(t), { settings, secrets });
});

test('with a passphrase: secrets are not in the text and need the passphrase', async () => {
  const t = await exportSettings({ settings, secrets, passphrase: 'correct horse', date });
  assert.ok(!t.includes('ghp_example') && !t.includes('ss'.repeat(3)));
  assert.match(t, /#\+begin_encrypted PBKDF2-SHA256 600000 AES-GCM/);
  assert.deepEqual(inspectSettingsFile(t), { settings, encrypted: true, secretCount: null });
  assert.deepEqual(await importSettings(t, { passphrase: 'correct horse' }), { settings, secrets });
});

test('encrypting twice gives different text (fresh salt and iv)', async () => {
  const a = await exportSettings({ settings, secrets, passphrase: 'x', date });
  const b = await exportSettings({ settings, secrets, passphrase: 'x', date });
  assert.notEqual(a, b);
});

test('missing or wrong passphrase stops with a clear code', async () => {
  const t = await exportSettings({ settings, secrets, passphrase: 'right', date });
  await assert.rejects(importSettings(t), (e) => e instanceof SettingsFileError && e.code === 'needs-passphrase');
  await assert.rejects(importSettings(t, { passphrase: 'wrong' }), (e) => e.code === 'bad-passphrase');
});

test('a damaged ciphertext is reported as a bad passphrase, never half-applied', async () => {
  const t = await exportSettings({ settings, secrets, passphrase: 'right', date });
  const bad = t.replace(/\n([A-Za-z0-9+/])/, (m, c) => '\n' + (c === 'A' ? 'B' : 'A'));
  await assert.rejects(importSettings(bad, { passphrase: 'right' }), (e) => e.code === 'bad-passphrase');
});

test('other files and bad keys are refused', async () => {
  await assert.rejects(importSettings('* Notes\nhello\n'), (e) => e.code === 'not-settings');
  await assert.rejects(importSettings('#+TITLE: Serita settings\n* Settings\n'), (e) => e.code === 'not-settings');
  await assert.rejects(exportSettings({ settings: { 'bad key': '1' }, secrets: {}, date }), (e) => e.code === 'bad-key');
});

test('empty maps and CRLF files work', async () => {
  const t = await exportSettings({ settings: {}, secrets: {}, date });
  assert.deepEqual(await importSettings(t.replace(/\n/g, '\r\n')), { settings: {}, secrets: {} });
});
