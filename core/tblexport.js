// Table translators: a table as CSV, TSV, an Org table, LaTeX, HTML, Texinfo, Unicode boxes, or text laid out by options
// (orgtbl-to-generic). Written from the Org manual's description of the translators and observed Emacs 30.1 results
// (conformance v0.1.54, v0.1.57, v0.1.58); no Emacs or Org source was read.
// A table is rows of strings with 'hline' for each rule, as table.js's toLisp gives it.

import { alignLines, stringWidth } from './table.js';
import { translate, MarkupError } from './orgmarkup.js';

const NUMBER = /^([<>]?[-+^.0-9]*[0-9][-+^.0-9eEdDx()%:]*|0[xX][0-9a-fA-F]+|nan|[-+]?inf)$/i;
const NUMBER_FRACTION = 0.5;
const COOKIE = /^<([lrc])?(\d+)?>$/;
const isCookieRow = (r) => r !== 'hline' && r.some((c) => c !== '') && r.every((c) => c === '' || COOKIE.test(c));

export class ExportError extends Error {}

/** The rows without alignment-cookie rows, each column's alignment (l, r, c) and width cookie, and the rows as groups split at rules. */
function prepare(rows, tr = (c) => c) {
  const data = rows.filter((r) => r !== 'hline');
  const cookies = data.filter(isCookieRow);
  const body = rows.filter((r) => r === 'hline' || !isCookieRow(r));
  const n = Math.max(0, ...data.map((r) => r.length));
  const align = []; const cookieWidth = [];
  for (let j = 0; j < n; j++) {
    let letter = null; let w = null;
    for (const c of cookies) { const k = COOKIE.exec(c[j] ?? ''); if (k) { if (k[1] && !letter) letter = k[1]; if (k[2] && w === null) w = Number(k[2]); } }
    let fields = 0; let numbers = 0;
    for (const r of data) { if (isCookieRow(r)) continue; const c = tr(r[j] ?? ''); if (c === '') continue; fields++; if (NUMBER.test(c)) numbers++; }
    align.push(letter ?? (fields > 0 && numbers / fields >= NUMBER_FRACTION ? 'r' : 'l'));
    cookieWidth.push(w);
  }
  const groups = [];
  let cur = [];
  for (const r of body) { if (r === 'hline') { if (cur.length) groups.push(cur); cur = []; } else cur.push(r); }
  if (cur.length) groups.push(cur);
  const rowsOf = body.filter((r) => r !== 'hline').map((r) => Array.from({ length: n }, (_, j) => r[j] ?? ''));
  return { body, align, cookieWidth, groups: groups.map((g) => g.map((r) => Array.from({ length: n }, (_, j) => r[j] ?? ''))), n, rows: rowsOf };
}

// ---- Cells ----------------------------------------------------------------------------------------------------------------

const cell = (format) => (s) => { try { return translate(s, format); } catch (e) { if (e instanceof MarkupError) throw new ExportError(e.message); throw e; } };
const html = cell('html');
const latex = cell('latex');
const texinfo = cell('texinfo');
const plain = cell('ascii');

// ---- Generic ----------------------------------------------------------------------------------------------------------------

const word = (o, k, d = '') => (o[k] === undefined || o[k] === null ? d : o[k]);

/**
 * orgtbl-to-generic: `o` has sep, lstart, lend, hline, tstart, tend, splice, fmt, skip, skipcols, hlstart, hlend, hlsep, hfmt.
 */
export function generic(rows, o = {}) {
  const t = rows.filter((r) => r === 'hline' || !isCookieRow(r));
  const skip = Number(o.skip ?? 0);
  const skipcols = new Set((o.skipcols ?? []).map(Number));
  const lines = [];
  let dropped = 0;
  const headerAt = t.indexOf('hline');
  t.forEach((r, i) => {
    if (r === 'hline') { if (o.hline !== undefined) lines.push(String(o.hline)); return; }
    if (dropped < skip) { dropped++; return; }
    const header = headerAt > 0 && i < headerAt;
    const cells = r.filter((_, j) => !skipcols.has(j + 1)).map((c) => {
      const f = header && o.hfmt ? o.hfmt : o.fmt;
      return f ? f.replace('%s', c) : c;
    });
    const sep = header && o.hlsep !== undefined ? o.hlsep : word(o, 'sep', '\t');
    const start = header && o.hlstart !== undefined ? o.hlstart : word(o, 'lstart');
    const end = header && o.hlend !== undefined ? o.hlend : word(o, 'lend');
    lines.push(`${start}${cells.join(sep)}${end}`);
  });
  const body = lines.join('\n');
  return o.splice ? body : `${word(o, 'tstart')}${word(o, 'tstart') ? '\n' : ''}${body}${word(o, 'tend') ? '\n' : ''}${word(o, 'tend')}`;
}

// ---- The formats ------------------------------------------------------------------------------------------------------------

const csvField = (c) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);

const FORMATS = {
  csv: (rows, o) => csvLines(rows, o),
  tsv: (rows, o) => generic(rows, { sep: '\t', ...o }),
  orgtbl: (rows) => {
    const p = prepare(rows);
    const lines = p.body.map((r) => (r === 'hline' ? '|-' : `| ${r.join(' | ')} |`));
    return alignLines(lines).join('\n');
  },
  generic,
  latex(rows, o) {
    const p = prepare(rows, latex);
    const env = word(o, 'environment', 'tabular');
    const book = !!o.booktabs;
    const fmt = (c) => (o.fmt ? o.fmt.replace('%s', latex(c)) : latex(c));
    const row = (r) => `${r.map(fmt).join(' & ')}\\\\`;
    const rule = (first, last) => (book ? (first ? '\\toprule' : last ? '\\bottomrule' : '\\midrule') : '\\hline');
    const out = [`\\begin{${env}}{${p.align.join('')}}`];
    const first = p.body.findIndex((r) => r !== 'hline');
    const lastIdx = p.body.map((r, i) => (r === 'hline' ? -1 : i)).filter((i) => i >= 0).pop();
    const headerRow = p.body.indexOf('hline') > first && first >= 0 ? first : -1;
    if (book) out.push('\\toprule');
    let seenRow = false;
    p.body.forEach((r, i) => {
      if (r === 'hline') {
        if (book && !seenRow) return; // a rule before the first row is the top rule already
        if (book && i > lastIdx) return;
        out.push(rule(false, i > lastIdx));
        if (env === 'longtable' && i === p.body.indexOf('hline') && headerRow >= 0) {
          const h = p.body[headerRow];
          out.push('\\endfirsthead', `\\multicolumn{${p.n}}{l}{Continued from previous page} \\\\`, rule(true, false), '', `${h.map(fmt).join(' & ')} \\\\`, '', rule(false, false), '\\endhead', `${rule(false, false)}\\multicolumn{${p.n}}{r}{Continued on next page} \\\\`, '\\endfoot', '\\endlastfoot');
        }
        return;
      }
      seenRow = true;
      out.push(row(r));
    });
    if (book && p.body[p.body.length - 1] !== 'hline') out.push('\\bottomrule');
    out.push(`\\end{${env}}`);
    return (o.splice ? out.slice(1, -1) : out).join('\n');
  },
  html(rows, o) {
    const p = prepare(rows, html);
    const attrs = o.attributes ?? { border: '2', cellspacing: '0', cellpadding: '6', rules: 'groups', frame: 'hsides' };
    const open = `<table${Object.entries(attrs).map(([k, v]) => ` ${k.replace(/^:/, '')}="${v}"`).join('')}>`;
    const cls = { l: 'org-left', r: 'org-right', c: 'org-center' };
    const out = [open, '', '', '<colgroup>', p.align.map((a) => `<col  class="${cls[a]}" />`).join('\n\n'), '</colgroup>'];
    const rowHtml = (r, tag) => ['<tr>', ...r.map((c, j) => (tag === 'th' ? `<th scope="col" class="${cls[p.align[j]]}">${html(c)}</th>` : `<td class="${cls[p.align[j]]}">${c === '' ? '&#xa0;' : html(c)}</td>`)), '</tr>'].join('\n');
    p.groups.forEach((g, i) => {
      const head = i === 0 && p.groups.length > 1;
      out.push(head ? '<thead>' : '<tbody>', g.map((r) => rowHtml(r, head ? 'th' : 'td')).join('\n\n'), head ? '</thead>' : '</tbody>');
    });
    out.push('</table>');
    return out.join('\n');
  },
  texinfo(rows) {
    const p = prepare(rows, texinfo);
    const widths = p.rows.length ? Array.from({ length: p.n }, (_, j) => Math.max(1, ...p.rows.map((r) => stringWidth(r[j])))) : [];
    const out = [`@multitable ${widths.map((w) => `{${'a'.repeat(w)}}`).join(' ')}`];
    p.groups.forEach((g, gi) => g.forEach((r, ri) => {
      const head = gi === 0 && ri === 0 && p.groups.length > 1;
      out.push(`${head ? '@headitem' : '@item'} ${texinfo(r[0] ?? '')}`, ...r.slice(1).map((c) => `@tab ${texinfo(c)}`));
    }));
    out.push('@end multitable');
    return out.join('\n');
  },
  unicode(rows) {
    const p = prepare(rows, plain);
    const cells = (r) => r.map(plain);
    const width = Array.from({ length: p.n }, (_, j) => p.cookieWidth[j] ?? (p.rows.every((r) => r[j] === '') ? 1 : Math.max(...p.rows.map((r) => stringWidth(plain(r[j]))))));
    const total = width.reduce((a, w) => a + w + 2, 0);
    const put = (c, w, a) => { const gap = Math.max(0, w - stringWidth(c)); return a === 'r' ? ' '.repeat(gap) + c : a === 'c' ? ' '.repeat(Math.floor(gap / 2)) + c + ' '.repeat(gap - Math.floor(gap / 2)) : c + ' '.repeat(gap); };
    const out = ['━'.repeat(total)];
    p.groups.forEach((g, i) => {
      if (i > 0) out.push('─'.repeat(total));
      for (const r of g) out.push(cells(r).map((c, j) => ` ${put(c, width[j], p.align[j])} `).join(''));
    });
    out.push('━'.repeat(total));
    return out.join('\n');
  },
};

function csvLines(rows, o) {
  const sep = word(o, 'sep', ',');
  return rows.filter((r) => r !== 'hline' && !isCookieRow(r)).map((r) => r.map(csvField).join(sep)).join('\n');
}

export const FORMAT_NAMES = Object.keys(FORMATS);

/**
 * A table as text. `format` is a name such as 'csv' or 'orgtbl-to-latex'; `options` are the translator's options by name.
 * @param {(string[] | 'hline')[]} rows @param {string} format @param {Record<string, any>} [options]
 */
export function exportRows(rows, format, options = {}) {
  const name = format.replace(/^orgtbl-to-/, '');
  if (!(name in FORMATS)) throw new ExportError(`No such transformation function orgtbl-to-${name}`);
  return FORMATS[name](rows, options);
}
