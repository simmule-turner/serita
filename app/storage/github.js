// GitHub storage provider, over the repository contents API.
// One commit per save. The version of a file is its blob sha. The token comes from the
// platform's secure store through getToken and is never kept here.
//
// The API documentation does not say which status code a stale or missing sha produces, so any
// 404, 409 or 422 on a write is settled by reading the file again and comparing versions.

import { CapabilityUnavailable } from '../interface/contract.js';

const API_VERSION = '2026-03-10';

export class GithubError extends Error {
  /** @param {number} status @param {string} message */
  constructor(status, message) {
    super(`GitHub ${status}: ${message}`);
    this.name = 'GithubError';
    this.status = status;
  }
}

const utf8ToBase64 = (text) => {
  const bytes = new TextEncoder().encode(text);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const base64ToUtf8 = (b64) => {
  const s = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(s, (c) => c.charCodeAt(0)));
};
const encodePath = (path) => path.split('/').map(encodeURIComponent).join('/');
const defaultMessage = (path, kind) => `${kind === 'create' ? 'Create' : kind === 'delete' ? 'Delete' : 'Update'} ${path}`;

/**
 * @param {{
 *   owner: string, repo: string, branch: string,
 *   getToken: () => Promise<string | null | undefined>,
 *   fetch?: typeof fetch, baseUrl?: string,
 *   message?: (path: string, kind: 'create' | 'update' | 'delete') => string,
 * }} opts
 * @returns {import('./local.js').Provider}
 */
export function createGithubProvider({
  owner, repo, branch, getToken,
  fetch = (...a) => globalThis.fetch(...a),
  baseUrl = 'https://api.github.com',
  message = defaultMessage,
}) {
  const repoUrl = `${baseUrl}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const contentsUrl = (path) => `${repoUrl}/contents/${encodePath(path)}`;

  async function call(method, url, body) {
    const token = await getToken();
    if (!token) throw new CapabilityUnavailable('storage', 'the github provider has no access token');
    const res = await fetch(url, {
      method,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': API_VERSION,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    let json = null;
    try { json = await res.json(); } catch { /* no body */ }
    return { status: res.status, json };
  }
  const fail = (r) => new GithubError(r.status, r.json?.message ?? 'request failed');

  async function getFile(path) {
    const r = await call('GET', `${contentsUrl(path)}?ref=${encodeURIComponent(branch)}`);
    if (r.status === 404) return null;
    if (r.status !== 200) throw fail(r);
    if (Array.isArray(r.json) || r.json.type !== 'file') throw new GithubError(0, `${path} is not a file`);
    if (r.json.encoding !== 'base64') throw new GithubError(0, `${path} is larger than 1 MB, which is not supported yet`);
    return { text: base64ToUtf8(r.json.content), version: r.json.sha };
  }

  const conflict = (cur) => ({ ok: false, conflict: { theirs: cur?.text ?? null, theirsVersion: cur?.version ?? null } });
  const repoExists = async () => (await call('GET', repoUrl)).status === 200;

  return {
    read: getFile,

    async write(path, text, { baseVersion } = {}) {
      const creating = baseVersion === undefined;
      const r = await call('PUT', contentsUrl(path), {
        message: message(path, creating ? 'create' : 'update'),
        content: utf8ToBase64(text),
        branch,
        ...(creating ? {} : { sha: baseVersion }),
      });
      if (r.status === 200 || r.status === 201) return { ok: true, version: r.json.content.sha };
      if (r.status === 404 || r.status === 409 || r.status === 422) {
        const cur = await getFile(path);
        if (cur && cur.version !== baseVersion) return conflict(cur);
        if (!cur && !creating && await repoExists()) return conflict(null);
      }
      throw fail(r);
    },

    async list(pathPrefix = '') {
      const r = await call('GET', `${repoUrl}/git/trees/${encodePath(branch)}?recursive=1`);
      if (r.status !== 200) throw fail(r);
      if (r.json.truncated) throw new GithubError(0, 'the repository is too large to list in one request');
      return r.json.tree.filter((e) => e.type === 'blob' && e.path.startsWith(pathPrefix)).map((e) => e.path).sort();
    },

    async remove(path) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const cur = await getFile(path);
        if (!cur) return;
        const r = await call('DELETE', contentsUrl(path), { message: message(path, 'delete'), sha: cur.version, branch });
        if (r.status === 200) return;
        if (!(r.status === 404 || r.status === 409 || r.status === 422) || attempt === 1) throw fail(r);
      }
    },
  };
}
