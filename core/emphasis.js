// Emphasis in Org text: *bold*, /italic/, _underline_, +strike-through+, =verbatim= and ~code~. Written from the Org manual and
// observed Emacs 30.1 results (conformance v0.1.70, ob-emph, ob-heading; v0.1.74, me-*). A paragraph's emphasis may run over line breaks;
// a blank line, a heading, a keyword, a table row or a new list item ends the paragraph.

const KINDS = { '*': 'bold', '/': 'italic', _: 'underline', '+': 'strike-through', '=': 'verbatim', '~': 'code' };
const PRE = /[-\s('"{]/;
const POST = /[-\s.,:!?;'")}[\\]/;
const BORDER = /[\s,"']/;

/**
 * The emphasis in a line or paragraph (lines joined with newlines): { start, end, kind, inner } with `inner` the range between the markers. Verbatim and code hold no other emphasis.
 * `skip` lists ranges (links' paths, for example) where no emphasis starts or ends.
 */
export function scanEmphasis(line, skip = []) {
  const out = [];
  const inSkip = (i) => skip.some(([a, b]) => i >= a && i < b);
  const find = (from, to) => {
    for (let i = from; i < to; i++) {
      const m = line[i];
      if (!KINDS[m] || inSkip(i)) continue;
      if (i > from && !PRE.test(line[i - 1])) continue;
      if (i + 1 >= to || BORDER.test(line[i + 1])) continue;
      let j = i + 2;
      for (; j < to; j++) {
        if (line[j] !== m || inSkip(j)) continue;
        if (BORDER.test(line[j - 1])) continue;
        if (j + 1 < to && !POST.test(line[j + 1])) continue;
        break;
      }
      if (j >= to || /^[*/_+=~]+$/.test(line.slice(i + 1, j))) continue;
      out.push({ start: i, end: j + 1, kind: KINDS[m], inner: [i + 1, j] });
      if (m !== '=' && m !== '~') find(i + 1, j);
      i = j;
    }
  };
  find(0, line.length);
  return out.sort((a, b) => a.start - b.start || b.end - a.end);
}

const indentOf = (t) => t.match(/^[ \t]*/)[0].length;

/**
 * The emphasis of every paragraph of a document, cut into the lines it covers: a Map from a line number to
 * { start, end, kind, inner, open, close } in that line's columns (`open` and `close` say whether the line holds the opening or closing marker).
 * @param {{ type: string, line: { text: string } }[]} nodes the analysis' nodes, one per line
 * @param {(line: string) => [number, number][]} skipOf ranges of a line where no emphasis starts or ends (a link's path)
 */
export function emphasisByLine(nodes, skipOf = () => []) {
  const out = new Map();
  let para = null;
  const flush = () => {
    if (!para) return;
    const starts = [];
    let at = 0;
    for (const r of para.rows) { starts.push(at); at += r.length + 1; }
    const skip = para.rows.flatMap((r, k) => skipOf(r).map(([a, b]) => [a + starts[k], b + starts[k]]));
    for (const f of scanEmphasis(para.rows.join('\n'), skip)) {
      for (let k = 0; k < para.rows.length; k++) {
        const lo = starts[k];
        const hi = lo + para.rows[k].length;
        if (f.start > hi || f.end <= lo) continue;
        const clip = (x) => Math.min(Math.max(x, lo), hi) - lo;
        const seg = { start: clip(f.start), end: clip(f.end), kind: f.kind, inner: [clip(f.inner[0]), clip(f.inner[1])], open: f.start >= lo && f.start < hi, close: f.end - 1 >= lo && f.end - 1 < hi };
        if (seg.end <= seg.start) continue;
        const list = out.get(para.first + k) ?? [];
        list.push(seg);
        out.set(para.first + k, list);
      }
    }
    para = null;
  };
  let block = null; // the name of the block the line is in, when emphasis in it is not text
  nodes.forEach((n, i) => {
    const text = n.line.text;
    if (n.type === 'block-begin') { flush(); block = /^\s*#\+begin_(\w+)/i.exec(text)?.[1].toLowerCase() ?? ''; if (block !== '' && !['src', 'example', 'export', 'comment'].includes(block)) block = null; return; }
    if (n.type === 'block-end') { flush(); block = null; return; }
    if (n.type === 'block-line') { if (block !== null) return; }
    const plain = n.type === 'text' || n.type === 'block-line' || (n.type === 'planning' && nodes[i - 1]?.type !== 'headline');
    if (n.type === 'list-item') { flush(); para = { first: i, rows: [text], item: indentOf(text) }; }
    else if (plain && /^[ \t]*-{5,}[ \t]*$/.test(text)) flush();
    else if (plain && /^\[fn:[^\]]*\]/.test(text)) { flush(); para = { first: i, rows: [text] }; }
    else if (plain) {
      if (para && para.first + para.rows.length === i && (para.item === undefined || indentOf(text) > para.item)) para.rows.push(text);
      else { flush(); para = { first: i, rows: [text] }; }
    } else flush();
  });
  flush();
  return out;
}
