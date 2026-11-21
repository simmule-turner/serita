// Settings export and import as an Org file. Secrets may be encrypted with a
// passphrase using Web Crypto (PBKDF2 with SHA-256, then AES-GCM).

const ITERATIONS = 600000;
const KEY = /^[A-Za-z0-9_.-]+$/;

export class SettingsFileError extends Error {
  /** @param {'not-settings'|'needs-passphrase'|'bad-passphrase'|'bad-key'} code */
  constructor(code, message) {
    super(message);
    this.name = 'SettingsFileError';
    this.code = code;
  }
}

/** @param {string} date YYYY-MM-DD */
export function settingsFileName(date) {
  return `serita-settings-${date}.org`;
}

function drawer(map) {
  const lines = [':PROPERTIES:'];
  for (const k of Object.keys(map).sort()) {
    if (!KEY.test(k)) throw new SettingsFileError('bad-key', `Setting name not allowed: ${k}`);
    lines.push(`:${k}: ${JSON.stringify(map[k])}`);
  }
  lines.push(':END:');
  return lines.join('\n');
}

function readDrawer(lines) {
  const out = {};
  for (const l of lines) {
    const m = /^:([A-Za-z0-9_.-]+): (.*)$/.exec(l);
    if (!m) continue;
    try {
      const v = JSON.parse(m[2]);
      if (typeof v === 'string') out[m[1]] = v;
    } catch { /* a line that is not a value is skipped */ }
  }
  return out;
}

const b64 = (u8) => {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
};
const unb64 = (t) => Uint8Array.from(atob(t), (c) => c.charCodeAt(0));

async function deriveKey(passphrase, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/**
 * @param {{settings: Record<string,string>, secrets: Record<string,string>, passphrase?: string, date: string}} o
 * @returns {Promise<string>}
 */
export async function exportSettings({ settings, secrets, passphrase, date }) {
  const head = `#+TITLE: Serita settings\n#+EXPORTED: ${date}\n\n* Settings\n${drawer(settings)}\n\n* Secrets\n`;
  if (!passphrase) return head + drawer(secrets) + '\n';
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, ITERATIONS);
  const plain = new TextEncoder().encode(drawer(secrets));
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
  const body = b64(sealed).match(/.{1,76}/g).join('\n');
  return head + `#+begin_encrypted PBKDF2-SHA256 ${ITERATIONS} AES-GCM\n:salt: ${b64(salt)}\n:iv: ${b64(iv)}\n${body}\n#+end_encrypted\n`;
}

/**
 * Reads a settings file without needing the passphrase, to tell the dialog what to ask for.
 * @param {string} text
 * @returns {{settings: Record<string,string>, encrypted: boolean, secretCount: number|null}}
 */
export function inspectSettingsFile(text) {
  const parsed = split(text);
  return { settings: parsed.settings, encrypted: parsed.sealed !== null, secretCount: parsed.sealed ? null : Object.keys(parsed.secrets).length };
}

function split(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (!/^#\+TITLE: Serita settings\s*$/.test(lines[0] ?? '')) {
    throw new SettingsFileError('not-settings', 'This is not a Serita settings file.');
  }
  const at = (h) => lines.findIndex((l) => l === h);
  const si = at('* Settings');
  const ci = at('* Secrets');
  if (si < 0 || ci < 0 || ci < si) throw new SettingsFileError('not-settings', 'This is not a Serita settings file.');
  const settings = readDrawer(lines.slice(si + 1, ci));
  const rest = lines.slice(ci + 1);
  const b = rest.findIndex((l) => l.startsWith('#+begin_encrypted '));
  if (b < 0) return { settings, secrets: readDrawer(rest), sealed: null };
  const e = rest.findIndex((l, i) => i > b && l === '#+end_encrypted');
  const hdr = rest[b].split(' ');
  const iterations = Number(hdr[2]);
  if (e < 0 || hdr[1] !== 'PBKDF2-SHA256' || hdr[3] !== 'AES-GCM' || !Number.isInteger(iterations) || iterations < 1) {
    throw new SettingsFileError('not-settings', 'The encrypted section of this file is damaged.');
  }
  const inner = rest.slice(b + 1, e);
  const meta = readRaw(inner);
  if (!meta.salt || !meta.iv) throw new SettingsFileError('not-settings', 'The encrypted section of this file is damaged.');
  const data = inner.filter((l) => !l.startsWith(':')).join('');
  return { settings, secrets: null, sealed: { iterations, salt: meta.salt, iv: meta.iv, data } };
}

function readRaw(lines) {
  const out = {};
  for (const l of lines) {
    const m = /^:(salt|iv): (\S+)$/.exec(l);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

/**
 * @param {string} text
 * @param {{passphrase?: string}} [options]
 * @returns {Promise<{settings: Record<string,string>, secrets: Record<string,string>}>}
 */
export async function importSettings(text, { passphrase } = {}) {
  const p = split(text);
  if (!p.sealed) return { settings: p.settings, secrets: p.secrets };
  if (!passphrase) throw new SettingsFileError('needs-passphrase', 'This file needs its passphrase.');
  try {
    const key = await deriveKey(passphrase, unb64(p.sealed.salt), p.sealed.iterations);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(p.sealed.iv) }, key, unb64(p.sealed.data));
    return { settings: p.settings, secrets: readDrawer(new TextDecoder().decode(plain).split('\n')) };
  } catch {
    throw new SettingsFileError('bad-passphrase', 'That passphrase does not open this file.');
  }
}
