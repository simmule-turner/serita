// Tree back to text: every line's own text and ending, in order.

/**
 * @param {{ root: import('./parse.js').Root }} doc
 * @returns {string}
 */
export function serialize(doc) {
  const out = [];
  const walk = (node) => {
    if (node.line) out.push(node.line.text, node.line.eol);
    if (node.children) for (const c of node.children) walk(c);
  };
  walk(doc.root);
  return out.join('');
}
