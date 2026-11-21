// A small XML reader for WebDAV multi-status replies. It handles what servers send:
// a prolog, comments, CDATA, entities, attributes, and namespace prefixes (resolved, so a
// reply using "D:" and one using a default namespace read the same). It does not validate,
// and it does not support a DOCTYPE internal subset.

export class XmlError extends Error {
  /** @param {string} message */
  constructor(message) { super(`XML: ${message}`); this.name = 'XmlError'; }
}

/** @typedef {{ name: string, ns: string, attrs: Record<string, string>, children: XmlNode[], text: string }} XmlNode */

const ENTITIES = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };
const decode = (s) => s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-z]+);/g, (m, e) => {
  if (e[0] !== '#') return ENTITIES[e] ?? m;
  const cp = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
  return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
});

/**
 * @param {string} src
 * @returns {XmlNode} the root element
 */
export function parseXml(src) {
  const top = { name: '', ns: '', attrs: {}, children: [], text: '' };
  /** @type {{ node: XmlNode, qname: string, scope: Record<string, string> }[]} */
  const stack = [{ node: top, qname: '', scope: {} }];
  const here = () => stack[stack.length - 1];
  let i = 0;

  while (i < src.length) {
    if (src[i] !== '<') {
      const j = src.indexOf('<', i);
      const end = j === -1 ? src.length : j;
      const chunk = src.slice(i, end);
      if (stack.length > 1) here().node.text += decode(chunk);
      else if (chunk.trim()) throw new XmlError('text outside the root element');
      i = end;
    } else if (src.startsWith('<!--', i)) {
      const j = src.indexOf('-->', i + 4);
      if (j < 0) throw new XmlError('unterminated comment');
      i = j + 3;
    } else if (src.startsWith('<![CDATA[', i)) {
      const j = src.indexOf(']]>', i);
      if (j < 0 || stack.length < 2) throw new XmlError('bad CDATA section');
      here().node.text += src.slice(i + 9, j);
      i = j + 3;
    } else if (src.startsWith('<?', i)) {
      const j = src.indexOf('?>', i);
      if (j < 0) throw new XmlError('unterminated processing instruction');
      i = j + 2;
    } else if (src.startsWith('<!', i)) {
      const j = src.indexOf('>', i);
      if (j < 0) throw new XmlError('unterminated declaration');
      i = j + 1;
    } else if (src.startsWith('</', i)) {
      const j = src.indexOf('>', i);
      if (j < 0) throw new XmlError('unterminated end tag');
      const q = src.slice(i + 2, j).trim();
      if (stack.length < 2 || here().qname !== q) throw new XmlError(`unexpected end tag </${q}>`);
      stack.pop();
      i = j + 1;
    } else {
      const nameRe = /<([^\s/>]+)/y;
      nameRe.lastIndex = i;
      const nm = nameRe.exec(src);
      if (!nm) throw new XmlError('bad start tag');
      let p = nameRe.lastIndex;
      const attrs = {};
      const attrRe = /\s+([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/y;
      for (;;) {
        attrRe.lastIndex = p;
        const a = attrRe.exec(src);
        if (!a) break;
        attrs[a[1]] = decode(a[2] ?? a[3]);
        p = attrRe.lastIndex;
      }
      const endRe = /\s*(\/?)>/y;
      endRe.lastIndex = p;
      const e = endRe.exec(src);
      if (!e) throw new XmlError(`bad start tag <${nm[1]}`);
      i = endRe.lastIndex;

      const scope = { ...here().scope };
      for (const [k, v] of Object.entries(attrs)) {
        if (k === 'xmlns') scope[''] = v;
        else if (k.startsWith('xmlns:')) scope[k.slice(6)] = v;
      }
      const colon = nm[1].indexOf(':');
      const prefix = colon < 0 ? '' : nm[1].slice(0, colon);
      const node = { name: colon < 0 ? nm[1] : nm[1].slice(colon + 1), ns: scope[prefix] ?? '', attrs, children: [], text: '' };
      here().node.children.push(node);
      if (e[1] !== '/') stack.push({ node, qname: nm[1], scope });
    }
  }
  if (stack.length > 1) throw new XmlError(`unclosed element <${here().qname}>`);
  if (top.children.length !== 1) throw new XmlError('expected exactly one root element');
  return top.children[0];
}

/**
 * Child elements with the given namespace and local name.
 * @param {XmlNode} node
 * @param {string} ns
 * @param {string} name
 */
export const childrenOf = (node, ns, name) => node.children.filter((c) => c.ns === ns && c.name === name);
