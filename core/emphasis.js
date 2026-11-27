// Emphasis in one line of Org text: *bold*, /italic/, _underline_, +strike-through+, =verbatim= and ~code~. Written from the Org manual and
// observed Emacs 30.1 results (conformance v0.1.70, ob-emph, ob-heading). Emphasis that runs over a line break is not found here.

const KINDS = { '*': 'bold', '/': 'italic', _: 'underline', '+': 'strike-through', '=': 'verbatim', '~': 'code' };
const PRE = /[-\s('"{]/;
const POST = /[-\s.,:!?;'")}[\\]/;
const BORDER = /[\s,"']/;

/**
 * The emphasis in a line: { start, end, kind, inner } with `inner` the range between the markers. Verbatim and code hold no other emphasis.
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
