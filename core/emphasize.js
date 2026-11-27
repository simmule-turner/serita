// C-c C-x C-f: wraps the region (or the point) in an emphasis marker. Behavior from observed Emacs 30.1 results (conformance v0.1.71, em-*).

export const MARKERS = '*/_=~+';
const PRE = /[-\s('"{]/;
const POST = /[-\s.,:!?;'")}\\[]/;

/** Offsets of the text: `from` and `to` are equal when there is no region. Returns { text, offset } or { error }. */
export function emphasize(text, from, to, ch) {
  if (ch !== ' ' && !(ch.length === 1 && MARKERS.includes(ch))) return { error: `No such emphasis marker: "${ch}"` };
  const region = from !== to;
  const s = ch === ' ' ? '' : ch;
  const a = Math.min(from, to);
  const b = Math.max(from, to);
  let body = region ? text.slice(a, b) : '';
  while (body.length > 1 && body[0] === body[body.length - 1] && MARKERS.includes(body[0])) body = body.slice(1, -1);
  const head = text.slice(0, a);
  const tail = text.slice(b);
  const lead = head === '' || head.endsWith('\n') || PRE.test(head[head.length - 1]) ? '' : ' ';
  const trail = tail === '' || tail[0] === '\n' || POST.test(tail[0]) ? '' : ' ';
  const mid = `${s}${body}${s}`;
  const out = `${head}${lead}${mid}${trail}${tail}`;
  const end = head.length + lead.length + mid.length;
  return { text: out, offset: !region && ch !== ' ' ? end - 1 : end };
}
