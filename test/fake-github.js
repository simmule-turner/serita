// A small fake of the GitHub contents and trees endpoints, built from GitHub's published
// documentation. It is a test aid, not a copy of GitHub: where the documentation is silent
// (which status a stale sha gets) the options below let tests try each possibility.

export function createFakeGithub({ staleStatus = 409, missingWithShaStatus = 404, token = 'tok', truncated = false } = {}) {
  const files = new Map(); // path -> { text, sha }
  const calls = [];
  let n = 0;
  const reply = (status, json) => ({ status, json: async () => json });
  const b64 = (t) => Buffer.from(t, 'utf8').toString('base64').replace(/(.{60})/g, '$1\n');

  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method ?? 'GET';
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, path: u.pathname, search: u.search, body, headers: init.headers });
    if (init.headers?.Authorization !== `Bearer ${token}`) return reply(401, { message: 'Bad credentials' });

    const m = /^\/repos\/([^/]+)\/([^/]+)(?:\/(contents|git\/trees)\/(.*))?$/.exec(u.pathname);
    if (!m) return reply(404, { message: 'Not Found' });
    if (!m[3]) return reply(200, { name: m[2] });
    const rest = decodeURIComponent(m[4]);

    if (m[3] === 'git/trees') {
      return reply(200, {
        truncated,
        tree: [...files].map(([path, f]) => ({ path, type: 'blob', sha: f.sha })).concat([{ path: 'some-dir', type: 'tree', sha: 'x' }]),
      });
    }

    const cur = files.get(rest);
    if (method === 'GET') {
      return cur ? reply(200, { type: 'file', encoding: 'base64', size: cur.text.length, path: rest, sha: cur.sha, content: b64(cur.text) })
        : reply(404, { message: 'Not Found' });
    }
    if (method === 'PUT') {
      const text = Buffer.from(body.content, 'base64').toString('utf8');
      if (cur) {
        if (body.sha === undefined) return reply(422, { message: '"sha" wasn\'t supplied.' });
        if (body.sha !== cur.sha) return reply(staleStatus, { message: 'does not match' });
        files.set(rest, { text, sha: `sha${++n}` });
        return reply(200, { content: { path: rest, sha: files.get(rest).sha }, commit: { message: body.message } });
      }
      if (body.sha !== undefined) return reply(missingWithShaStatus, { message: 'Not Found' });
      files.set(rest, { text, sha: `sha${++n}` });
      return reply(201, { content: { path: rest, sha: files.get(rest).sha }, commit: { message: body.message } });
    }
    if (method === 'DELETE') {
      if (!cur) return reply(404, { message: 'Not Found' });
      if (body.sha !== cur.sha) return reply(staleStatus, { message: 'does not match' });
      files.delete(rest);
      return reply(200, { content: null, commit: { message: body.message } });
    }
    return reply(405, { message: 'Method Not Allowed' });
  };

  return { fetch, files, calls, setRaw: (path, text) => files.set(path, { text, sha: `sha${++n}` }) };
}
