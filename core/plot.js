// #+PLOT: for tables: the options on the line above a table, the series a table holds, and an SVG drawing of them.
// Org hands this to gnuplot; here the chart is drawn directly, for the options that matter in a chart.
import { tableView } from './table.js';

const PLOT = /^[ \t]*#\+PLOT:(.*)$/i;
const AFFILIATED = /^[ \t]*#\+(?:NAME|CAPTION|ATTR_\w+|HEADER|RESULTS)\b/i;
const OPTION = /([\w-]+):("(?:[^"\\]|\\.)*"|\([^)]*\)|[^\s"()]+)/g;
const COLORS = ['#378ADD', '#D85A30', '#1D9E75', '#BA7517', '#7F77DD', '#D4537E', '#639922', '#5F5E5A'];
export const STYLES = ['lines', 'points', 'linespoints', 'boxes', 'histograms', 'impulses', 'steps', 'dots', 'filledcurves'];

const unquote = (s) => s.replace(/^"|"$/g, '').replace(/\\(.)/g, '$1');
const atom = (s) => (/^"/.test(s) ? unquote(s) : /^[-+]?(\d+\.?\d*|\.\d+)$/.test(s) ? Number(s) : s);

/** The options of the #+PLOT: lines directly above the table that starts at `first` (#+NAME: and similar lines may sit between). An option given twice keeps its first value, nearest line first. */
export function plotOptions(lines, first) {
  const out = {};
  for (let i = first - 1; i >= 0; i--) {
    const m = PLOT.exec(lines[i]);
    if (!m) { if (AFFILIATED.test(lines[i])) continue; break; }
    for (const [, key, raw] of m[1].matchAll(OPTION)) {
      if (key in out) continue;
      out[key] = raw.startsWith('(') ? [...raw.slice(1, -1).matchAll(/"(?:[^"\\]|\\.)*"|[^\s"]+/g)].map((x) => atom(x[0])) : atom(raw);
    }
  }
  return out;
}

const number = (s) => { const t = String(s ?? '').trim(); return t !== '' && /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(t) ? Number(t) : null; };
const list = (v) => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

/** gnuplot-style `set` commands the chart understands: xlabel, ylabel, title, xrange, yrange, grid, key off. */
function settings(opts) {
  const s = { grid: false, key: true };
  for (const cmd of list(opts.set)) {
    const m = /^\s*(unset\s+)?(\w+)\s*(.*)$/.exec(String(cmd));
    if (!m) continue;
    const [, off, name, rest] = m;
    const arg = rest.trim().replace(/^(['"])(.*)\1$/, '$2');
    if (name === 'grid') s.grid = !off;
    else if (name === 'key') s.key = off ? false : !/^off$/i.test(arg);
    else if (['xlabel', 'ylabel', 'title'].includes(name)) s[name] = off ? undefined : arg;
    else if (name === 'xrange' || name === 'yrange') {
      const r = /^\[\s*([^:\]]*)\s*:\s*([^\]]*)\s*\]/.exec(rest.trim());
      if (r) s[name] = [number(r[1]), number(r[2])];
    }
  }
  for (const cmd of list(opts.unset)) if (String(cmd).trim() === 'grid') s.grid = false;
  return s;
}

/**
 * What the table at `line` plots: { title, style, names, categories, series: [{ name, points: [[x, y] | null] }], settings }.
 * Throws an Error with a message for what cannot be plotted.
 */
export function plotModel(text, line) {
  const v = tableView(text, line);
  if (!v) throw new Error('Not in table');
  const lines = text.split('\n');
  const opts = plotOptions(lines, v.rows[0].line);
  const type = String(opts.type ?? '2d');
  if (type === '3d' || type === 'grid') {
    const all = v.rows.filter((r) => !r.rule);
    const hdr = v.rows.findIndex((r) => r.rule) === 1;
    const matrix = (hdr ? all.slice(1) : all).map((r) => r.cells.map(number));
    if (!matrix.length || !matrix.some((r) => r.some((z) => z !== null))) throw new Error('Nothing to plot');
    return { kind: type, title: opts.title === undefined ? '' : String(opts.title), matrix, settings: settings(opts), options: opts };
  }
  if (type !== '2d') throw new Error(`Plot type ${type} is not supported`);
  const style = String(opts.with ?? 'lines');
  if (!STYLES.includes(style)) throw new Error(`Plot style ${style} is not supported`);
  const rows = v.rows.filter((r) => !r.rule);
  const header = v.rows.findIndex((r) => r.rule) > 0 && v.rows.findIndex((r) => r.rule) === 1;
  const body = (header ? rows.slice(1) : rows).map((r) => r.cells);
  if (!body.length) throw new Error('Nothing to plot');
  const columns = Math.max(...rows.map((r) => r.cells.length));
  const ind = opts.ind === undefined || Number(opts.ind) === 0 ? null : Number(opts.ind);
  if (ind !== null && !(ind >= 1 && ind <= columns)) throw new Error(`Column ${opts.ind} is outside the table`);
  const deps = (opts.deps === undefined ? Array.from({ length: columns }, (_, i) => i + 1).filter((c) => c !== ind) : list(opts.deps).map(Number));
  for (const c of deps) if (!(c >= 1 && c <= columns)) throw new Error(`Column ${c} is outside the table`);
  const heads = header ? rows[0].cells : [];
  const xs = ind === null ? null : body.map((r) => number(r[ind - 1]));
  const categorical = style === 'histograms' || (xs !== null && xs.some((x) => x === null));
  const categories = categorical ? body.map((r, i) => (ind === null ? String(i + 1) : String(r[ind - 1] ?? '').trim())) : null;
  const series = deps.map((c, k) => ({
    name: (heads[c - 1] ?? String(c)).trim(),
    points: body.map((r, i) => { const y = number(r[c - 1]); return y === null ? null : [categorical || xs === null ? i + 1 : xs[i], y]; }),
  }));
  return { title: opts.title === undefined ? '' : String(opts.title), style, categories, series, settings: settings(opts), options: opts };
}

// ---- drawing --------------------------------------------------------------------------------------------------

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const fmt = (n) => String(Math.round(n * 100) / 100);

/** Tick values that cover [lo, hi] in steps of 1, 2 or 5 times a power of ten. */
export function niceTicks(lo, hi, count = 5) {
  if (lo === hi) { lo -= 1; hi += 1; }
  const raw = (hi - lo) / count;
  const p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw);
  const a = Math.floor(lo / step) * step;
  const b = Math.ceil(hi / step) * step;
  const out = [];
  for (let x = a; x <= b + step / 2; x += step) out.push(Math.round(x / step) * step);
  return out;
}

/** The chart as an SVG string. `titleInside` draws the title in the picture (for a saved image). */
export function plotSvg(model, { width = 320, height = 220, titleInside = false, view } = {}) {
  if (model.kind === 'grid') return gridSvg(model, { width, height, titleInside });
  if (model.kind === '3d') return surfaceSvg(model, { width, height, titleInside, view });
  const { series, style, categories, settings: st } = model;
  const o0 = model.options;
  const title = titleInside ? (st.title ?? model.title) : '';
  const m = { l: 44, r: 12, t: title ? 26 : 10, b: 30 + (st.xlabel ? 14 : 0) + (st.key && series.length ? 18 : 0) };
  const pw = width - m.l - m.r;
  const ph = height - m.t - m.b;
  const all = series.flatMap((s) => s.points.filter(Boolean));
  const xsAll = all.map((p) => p[0]);
  const bars = style === 'boxes' || style === 'histograms';
  let x0 = xsAll.length ? Math.min(...xsAll) : 0;
  let x1 = xsAll.length ? Math.max(...xsAll) : 1;
  if (categories || bars) { x0 -= 0.5; x1 += 0.5; }
  if (o0.xmin !== undefined) x0 = Number(o0.xmin);
  if (o0.xmax !== undefined) x1 = Number(o0.xmax);
  if (st.xrange) { if (st.xrange[0] !== null) x0 = st.xrange[0]; if (st.xrange[1] !== null) x1 = st.xrange[1]; }
  if (x0 === x1) { x0 -= 1; x1 += 1; }
  let ylo = all.length ? Math.min(...all.map((p) => p[1])) : 0;
  let yhi = all.length ? Math.max(...all.map((p) => p[1])) : 1;
  if (bars || style === 'impulses' || style === 'filledcurves') { ylo = Math.min(ylo, 0); yhi = Math.max(yhi, 0); }
  const yt = niceTicks(ylo, yhi);
  let y0 = yt[0]; let y1 = yt[yt.length - 1];
  const o = model.options;
  const yr = st.yrange ?? [o.ymin ?? null, o.ymax ?? null];
  if (yr[0] !== null && yr[0] !== undefined) y0 = Number(yr[0]);
  if (yr[1] !== null && yr[1] !== undefined) y1 = Number(yr[1]);
  const X = (x) => m.l + ((x - x0) / (x1 - x0)) * pw;
  const Y = (y) => m.t + ph - ((y - y0) / (y1 - y0)) * ph;
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" role="img" font-family="sans-serif">`, `<title>${esc(model.title || 'Plot')}</title>`];
  if (title) out.push(`<text x="${width / 2}" y="16" text-anchor="middle" font-size="13" fill="currentColor">${esc(title)}</text>`);
  for (const t of niceTicks(y0, y1).filter((t) => t >= y0 - 1e-9 && t <= y1 + 1e-9)) {
    out.push(`<line x1="${m.l}" y1="${fmt(Y(t))}" x2="${m.l + pw}" y2="${fmt(Y(t))}" stroke="currentColor" stroke-opacity="${st.grid ? 0.25 : 0.1}" stroke-width="0.5"/>`);
    out.push(`<text x="${m.l - 5}" y="${fmt(Y(t) + 4)}" text-anchor="end" font-size="11" fill="currentColor" fill-opacity="0.7">${fmt(t)}</text>`);
  }
  const xticks = categories ? categories.map((c, i) => [i + 1, c]) : niceTicks(x0, x1).filter((t) => t >= x0 - 1e-9 && t <= x1 + 1e-9).map((t) => [t, fmt(t)]);
  for (const [t, label] of xticks) {
    if (st.grid) out.push(`<line x1="${fmt(X(t))}" y1="${m.t}" x2="${fmt(X(t))}" y2="${m.t + ph}" stroke="currentColor" stroke-opacity="0.25" stroke-width="0.5"/>`);
    out.push(`<text x="${fmt(X(t))}" y="${m.t + ph + 14}" text-anchor="middle" font-size="11" fill="currentColor" fill-opacity="0.7">${esc(label)}</text>`);
  }
  out.push(`<line x1="${m.l}" y1="${m.t}" x2="${m.l}" y2="${m.t + ph}" stroke="currentColor" stroke-opacity="0.5"/>`);
  out.push(`<line x1="${m.l}" y1="${fmt(Y(Math.max(y0, Math.min(0, y1))))}" x2="${m.l + pw}" y2="${fmt(Y(Math.max(y0, Math.min(0, y1))))}" stroke="currentColor" stroke-opacity="0.5"/>`);
  const base = Y(Math.max(y0, Math.min(0, y1)));
  series.forEach((s, k) => {
    const c = COLORS[k % COLORS.length];
    const pts = s.points;
    if (style === 'lines' || style === 'linespoints' || style === 'steps') {
      let run = [];
      const flush = () => { if (run.length > 1) out.push(`<polyline points="${run.join(' ')}" fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round"/>`); run = []; };
      let prev = null;
      for (const p of pts) {
        if (!p) { flush(); prev = null; continue; }
        if (style === 'steps' && prev) run.push(`${fmt(X(p[0]))},${fmt(Y(prev[1]))}`);
        run.push(`${fmt(X(p[0]))},${fmt(Y(p[1]))}`);
        prev = p;
      }
      flush();
    }
    if (style === 'points' || style === 'linespoints' || style === 'dots') for (const p of pts) if (p) out.push(`<circle cx="${fmt(X(p[0]))}" cy="${fmt(Y(p[1]))}" r="${style === 'dots' ? 1.2 : 3}" fill="${c}"/>`);
    if (style === 'filledcurves') {
      let run = [];
      const flush = () => { if (run.length > 1) out.push(`<polygon points="${fmt(run[0][0])},${fmt(base)} ${run.map((q) => `${fmt(q[0])},${fmt(q[1])}`).join(' ')} ${fmt(run[run.length - 1][0])},${fmt(base)}" fill="${c}" fill-opacity="0.35" stroke="${c}" stroke-width="1.5"/>`); run = []; };
      for (const p of pts) { if (!p) flush(); else run.push([X(p[0]), Y(p[1])]); }
      flush();
    }
    if (style === 'impulses') for (const p of pts) if (p) out.push(`<line x1="${fmt(X(p[0]))}" y1="${fmt(base)}" x2="${fmt(X(p[0]))}" y2="${fmt(Y(p[1]))}" stroke="${c}" stroke-width="2"/>`);
    if (bars) {
      const group = style === 'histograms' ? series.length : 1;
      const w = (pw / (x1 - x0)) * 0.8 / group;
      for (const p of pts) {
        if (!p) continue;
        const cx = X(p[0]) - (w * group) / 2 + w * (style === 'histograms' ? k : 0);
        out.push(`<rect x="${fmt(cx)}" y="${fmt(Math.min(Y(p[1]), base))}" width="${fmt(w)}" height="${fmt(Math.abs(base - Y(p[1])))}" fill="${c}" fill-opacity="0.85"/>`);
      }
    }
  });
  if (st.xlabel) out.push(`<text x="${m.l + pw / 2}" y="${m.t + ph + 28}" text-anchor="middle" font-size="11" fill="currentColor">${esc(st.xlabel)}</text>`);
  if (st.ylabel) out.push(`<text transform="translate(11 ${m.t + ph / 2}) rotate(-90)" text-anchor="middle" font-size="11" fill="currentColor">${esc(st.ylabel)}</text>`);
  if (st.key && series.length) {
    let x = m.l;
    const y = height - 8;
    series.forEach((s, k) => {
      out.push(`<rect x="${x}" y="${y - 9}" width="9" height="9" fill="${COLORS[k % COLORS.length]}"/>`);
      out.push(`<text x="${x + 13}" y="${y}" font-size="11" fill="currentColor">${esc(s.name)}</text>`);
      x += 24 + s.name.length * 6.5;
    });
  }
  out.push('</svg>');
  return out.join('');
}

// ---- grid (a heat map) and 3d (a wireframe surface) -------------------------------------------------------------

const RAMP = [[0xE6, 0xF1, 0xFB], [0x85, 0xB7, 0xEB], [0x18, 0x5F, 0xA5], [0x04, 0x2C, 0x53]];
function rampColor(t) {
  const k = Math.min(Math.max(t, 0), 1) * (RAMP.length - 1);
  const i = Math.min(Math.floor(k), RAMP.length - 2);
  const f = k - i;
  return `rgb(${RAMP[i].map((c, j) => Math.round(c + (RAMP[i + 1][j] - c) * f)).join(',')})`;
}
const zRange = (matrix) => {
  const zs = matrix.flat().filter((z) => z !== null);
  const lo = Math.min(...zs), hi = Math.max(...zs);
  return lo === hi ? [lo - 1, hi + 1] : [lo, hi];
};
const frame = (model, width, height, titleInside) => {
  const title = titleInside ? (model.settings.title ?? model.title) : '';
  const out = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" role="img" font-family="sans-serif">`, `<title>${esc(model.title || 'Plot')}</title>`];
  if (title) out.push(`<text x="${width / 2}" y="16" text-anchor="middle" font-size="13" fill="currentColor">${esc(title)}</text>`);
  return { out, top: title ? 26 : 10 };
};

/** type:grid: the table's numbers as colored cells, row 1 on top, with a color scale on the right. */
function gridSvg(model, { width, height, titleInside }) {
  const { matrix, settings: st } = model;
  const rows = matrix.length;
  const cols = Math.max(...matrix.map((r) => r.length));
  const [lo, hi] = zRange(matrix);
  const { out, top } = frame(model, width, height, titleInside);
  const l = 34, r = 44, b = 24;
  const cw = (width - l - r) / cols, ch = (height - top - b) / rows;
  matrix.forEach((row, j) => row.forEach((z, i) => {
    if (z === null) return;
    out.push(`<rect x="${fmt(l + i * cw)}" y="${fmt(top + j * ch)}" width="${fmt(cw)}" height="${fmt(ch)}" fill="${rampColor((z - lo) / (hi - lo))}" stroke="${st.grid ? 'currentColor' : 'none'}" stroke-opacity="0.3" stroke-width="0.5"><title>${esc(z)}</title></rect>`);
  }));
  for (let i = 0; i < cols; i++) out.push(`<text x="${fmt(l + (i + 0.5) * cw)}" y="${height - 8}" text-anchor="middle" font-size="11" fill="currentColor" fill-opacity="0.7">${i + 1}</text>`);
  for (let j = 0; j < rows; j++) out.push(`<text x="${l - 5}" y="${fmt(top + (j + 0.5) * ch + 4)}" text-anchor="end" font-size="11" fill="currentColor" fill-opacity="0.7">${j + 1}</text>`);
  const bx = width - r + 12, bh = height - top - b;
  for (let k = 0; k < 20; k++) out.push(`<rect x="${bx}" y="${fmt(top + (bh / 20) * k)}" width="10" height="${fmt(bh / 20 + 0.5)}" fill="${rampColor(1 - (k + 0.5) / 20)}"/>`);
  out.push(`<text x="${bx + 14}" y="${top + 9}" font-size="11" fill="currentColor">${fmt(hi)}</text><text x="${bx + 14}" y="${top + bh}" font-size="11" fill="currentColor">${fmt(lo)}</text>`);
  out.push('</svg>');
  return out.join('');
}

/** type:3d: the table's numbers as a wireframe surface seen from `view` ({ az, el } in degrees); columns run along x, rows along y. */
function surfaceSvg(model, { width, height, titleInside, view = {} }) {
  const { matrix } = model;
  const az = ((view.az ?? -35) * Math.PI) / 180, el = ((view.el ?? 30) * Math.PI) / 180;
  const rows = matrix.length;
  const cols = Math.max(...matrix.map((r) => r.length));
  const [lo, hi] = zRange(matrix);
  const P = (i, j, z) => {
    const x = cols > 1 ? i / (cols - 1) - 0.5 : 0, y = rows > 1 ? j / (rows - 1) - 0.5 : 0, h = ((z - lo) / (hi - lo)) * 0.7;
    return { sx: x * Math.cos(az) - y * Math.sin(az), sy: h * Math.cos(el) + (x * Math.sin(az) + y * Math.cos(az)) * Math.sin(el), d: x * Math.sin(az) + y * Math.cos(az) };
  };
  const pts = matrix.map((row, j) => Array.from({ length: cols }, (_, i) => (row[i] === null || row[i] === undefined ? null : P(i, j, row[i]))));
  const corners = [[0, 0], [cols - 1, 0], [cols - 1, rows - 1], [0, rows - 1]].map(([i, j]) => P(i, j, lo));
  const all = [...pts.flat().filter(Boolean), ...corners];
  const sxs = all.map((p) => p.sx), sys = all.map((p) => p.sy);
  const { out, top } = frame(model, width, height, titleInside);
  const pad = 14;
  const k = Math.min((width - 2 * pad) / (Math.max(...sxs) - Math.min(...sxs) || 1), (height - top - 2 * pad) / (Math.max(...sys) - Math.min(...sys) || 1));
  const X = (p) => fmt(width / 2 + (p.sx - (Math.max(...sxs) + Math.min(...sxs)) / 2) * k);
  const Y = (p) => fmt(top + (height - top) / 2 - (p.sy - (Math.max(...sys) + Math.min(...sys)) / 2) * k);
  out.push(`<polygon points="${corners.map((p) => `${X(p)},${Y(p)}`).join(' ')}" fill="none" stroke="currentColor" stroke-opacity="0.35"/>`);
  const quads = [];
  for (let j = 0; j + 1 < rows; j++) for (let i = 0; i + 1 < cols; i++) {
    const q = [pts[j][i], pts[j][i + 1], pts[j + 1][i + 1], pts[j + 1][i]];
    if (q.every(Boolean)) quads.push({ q, d: q.reduce((a, p) => a + p.d, 0) / 4, z: (matrix[j][i] + matrix[j][i + 1] + matrix[j + 1][i + 1] + matrix[j + 1][i]) / 4 });
  }
  quads.sort((a, b) => b.d - a.d);
  for (const { q, z } of quads) out.push(`<polygon points="${q.map((p) => `${X(p)},${Y(p)}`).join(' ')}" fill="${rampColor((z - lo) / (hi - lo))}" fill-opacity="0.55" stroke="#185FA5" stroke-width="1" stroke-linejoin="round"/>`);
  if (!quads.length) for (const p of all) out.push(`<circle cx="${X(p)}" cy="${Y(p)}" r="3" fill="#185FA5"/>`);
  out.push(`<text x="6" y="${height - 6}" font-size="11" fill="currentColor" fill-opacity="0.7">z ${fmt(lo)} to ${fmt(hi)}</text>`);
  out.push('</svg>');
  return out.join('');
}
