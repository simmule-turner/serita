// A small fake WebDAV server built from RFC 4918 and RFC 9110 as read on 2026-11-21:
// PUT without a parent collection is 409; MKCOL is 201, or 405 when the URL is mapped;
// If-Match must equal the current ETag and If-None-Match: * means "must not exist", else 412;
// PROPFIND Depth 1 answers 207 with response/href/propstat/prop/resourcetype.
// Options vary what the standard leaves open: href style, XML prefix style, ETag on PUT.

export function createFakeWebdav({ prefix = '/dav/', hrefStyle = 'path', xmlStyle = 'prefixed', putEtag = true, getEtag = true } = {}) {
  const files = new Map(); // path -> { text, etag }
  const dirs = new Set(['']);
  const calls = [];
  let n = 0;
  const res = (status, { body = '', headers = {} } = {}) => ({
    status, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, text: async () => body,
  });
  const etag = () => `"e${++n}"`;

  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method;
    const h = Object.fromEntries(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
    calls.push({ method, path: u.pathname, headers: h, body: init.body });
    if (!h.authorization?.startsWith('Basic ') || Buffer.from(h.authorization.slice(6), 'base64').toString() !== 'me:pw') return res(401);
    if (!u.pathname.startsWith(prefix)) return res(404);
    const rel = decodeURIComponent(u.pathname.slice(prefix.length));
    const bare = rel.replace(/\/$/, '');
    const parent = bare.includes('/') ? bare.slice(0, bare.lastIndexOf('/')) : '';

    if (method === 'GET') {
      const f = files.get(rel);
      return f ? res(200, { body: f.text, headers: getEtag ? { etag: f.etag } : {} }) : res(404);
    }
    if (method === 'PUT') {
      if (!dirs.has(parent)) return res(409);
      if (dirs.has(bare)) return res(405);
      const cur = files.get(rel);
      if (h['if-none-match'] === '*' && cur) return res(412);
      if (h['if-match'] !== undefined && (!cur || cur.etag !== h['if-match'])) return res(412);
      const f = { text: init.body, etag: etag() };
      files.set(rel, f);
      return res(cur ? 204 : 201, { headers: putEtag ? { etag: f.etag } : {} });
    }
    if (method === 'DELETE') return files.delete(rel) ? res(204) : res(404);
    if (method === 'MKCOL') {
      if (dirs.has(bare) || files.has(bare)) return res(405);
      if (!dirs.has(parent)) return res(409);
      dirs.add(bare);
      return res(201);
    }
    if (method === 'PROPFIND') {
      if (!dirs.has(bare)) return res(404);
      const entries = [{ p: bare, dir: true }];
      for (const d of dirs) if (d && d !== bare && (d.includes('/') ? d.slice(0, d.lastIndexOf('/')) : '') === bare) entries.push({ p: d, dir: true });
      for (const f of files.keys()) if ((f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '') === bare) entries.push({ p: f, dir: false });
      const [P, ns] = xmlStyle === 'prefixed' ? ['D:', ' xmlns:D="DAV:"'] : ['', ' xmlns="DAV:"'];
      const href = (e) => {
        const path = prefix + e.p.split('/').map(encodeURIComponent).join('/') + (e.dir && e.p ? '/' : '');
        return hrefStyle === 'uri' ? `${u.origin}${path}` : path;
      };
      const rows = entries.map((e) => `<${P}response><${P}href>${href(e)}</${P}href><${P}propstat><${P}prop><${P}resourcetype>${e.dir ? `<${P}collection/>` : ''}</${P}resourcetype></${P}prop><${P}status>HTTP/1.1 200 OK</${P}status></${P}propstat></${P}response>`).join('');
      return res(207, { body: `<?xml version="1.0" encoding="utf-8"?><${P}multistatus${ns}>${rows}</${P}multistatus>` });
    }
    return res(405);
  };

  return {
    fetch, files, dirs, calls,
    /** a change by someone else, straight on the server */
    setRaw: (path, text) => { files.set(path, { text, etag: etag() }); },
  };
}
