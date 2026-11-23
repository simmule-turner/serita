// The contacts file for org-contacts-anniversaries: headings with a BIRTHDAY (or other) property, shown on their day each year.
// Written from the behavior Emacs 30.1 with org-contacts 1.3 showed (conformance v0.1.30 to v0.1.32) and the author's example agenda.

/** The contacts in the files' text: { name, props } with the property names in capitals. */
export function parseContacts(texts) {
  const out = [];
  for (const text of texts) {
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const m = /^\*+\s+(.*?)\s*$/.exec(lines[i]);
      if (!m) continue;
      const name = m[1].replace(/\s+:[\w@#%:]+:$/, '');
      const props = {};
      if (/^\s*:PROPERTIES:\s*$/i.test(lines[i + 1] ?? '')) {
        for (let j = i + 2; j < lines.length && !/^\s*:END:\s*$/i.test(lines[j]); j++) {
          const p = /^\s*:([^:\s]+):\s*(.*?)\s*$/.exec(lines[j]);
          if (p) props[p[1].toUpperCase()] = p[2];
        }
      }
      out.push({ name, props });
    }
  }
  return out;
}

/** A date property: 1990-11-23, an Org timestamp such as <1990-11-23 Fri>, or 11-23 without a year. Anything else is not a date. */
function dateOf(value) {
  let m = /^[<[]?(\d{4})-(\d\d)-(\d\d)(?:\s+[^\s>\]]+)?[>\]]?$/.exec(value);
  if (m) return { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) };
  m = /^(\d\d)-(\d\d)$/.exec(value);
  return m ? { y: null, m: Number(m[1]), d: Number(m[2]) } : null;
}

const ordinal = (n) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th')}`;

/** The lines for a day [month, day, year]: the format's %l and %n are the name and %Y the age as an ordinal (0th without a birth year). */
export function anniversaries(contacts, [m, d, y], { field = 'BIRTHDAY', format = 'Birthday: %l (%Y)' } = {}) {
  const out = [];
  for (const c of contacts) {
    const v = c.props[field];
    const date = v === undefined ? null : dateOf(v);
    if (!date || date.m !== m || date.d !== d) continue;
    const years = date.y === null ? 0 : y - date.y;
    if (years < 0) continue;
    out.push(format.replace(/%[lnY]/g, (t) => (t === '%Y' ? ordinal(years) : c.name)));
  }
  return out;
}
