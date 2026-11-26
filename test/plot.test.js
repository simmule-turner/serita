import test from 'node:test';
import assert from 'node:assert/strict';
import { plotOptions, plotModel, plotSvg, niceTicks } from '../core/plot.js';

const T = '#+PLOT: title:"Sales" ind:1 deps:(2 3) with:lines set:("xlabel \'m\'" "grid")\n| x | a | b |\n|---+---+---|\n| 1 | 2 | 3 |\n| 2 | 4 | 5 |\n| 3 | 6 |   |\n';

test('options: quoted strings, lists, numbers; every #+PLOT: line above the table; the first of a repeated option wins (nearest line first)', () => {
  assert.deepEqual(plotOptions(['#+PLOT: title:"A b" deps:(2 3) ymin:0 with:lines with:points', '| x |'], 1), { title: 'A b', deps: [2, 3], ymin: 0, with: 'lines' });
  assert.deepEqual(plotOptions(['#+PLOT: title:"x" ind:1', '#+PLOT: deps:(2) with:points', '| x |'], 2), { deps: [2], with: 'points', title: 'x', ind: 1 });
  assert.deepEqual(plotOptions(['#+PLOT: ind:1', '#+NAME: t', '| x |'], 2), { ind: 1 });
  assert.deepEqual(plotOptions(['#+PLOT: ind:1', '', '| x |'], 2), {});
  assert.deepEqual(plotOptions(['#+PLOT: ind:1', 'text', '| x |'], 2), {});
  assert.deepEqual(plotOptions(['text', '| x |'], 1), {});
});

test('the model takes names from the header, x from ind and gaps from empty cells', () => {
  const m = plotModel(T, 3);
  assert.equal(m.title, 'Sales');
  assert.deepEqual(m.series.map((s) => s.name), ['a', 'b']);
  assert.deepEqual(m.series[0].points, [[1, 2], [2, 4], [3, 6]]);
  assert.deepEqual(m.series[1].points, [[1, 3], [2, 5], null]);
  assert.equal(m.settings.xlabel, 'm');
  assert.equal(m.settings.grid, true);
});

test('without ind the rows are numbered, and text in ind gives category labels', () => {
  const a = plotModel('| a |\n|---|\n| 5 |\n| 6 |\n', 0);
  assert.deepEqual(a.series[0].points, [[1, 5], [2, 6]]);
  const b = plotModel('#+PLOT: ind:1 deps:(2)\n| m | v |\n|---+---|\n| Jan | 2 |\n| Feb | 4 |\n', 1);
  assert.deepEqual(b.categories, ['Jan', 'Feb']);
});

test('series are titled by the header row or column number, labels ignored; a bad column or type is an error', () => {
  assert.equal(plotModel('#+PLOT: labels:("X" "Y") deps:(1 2)\n| 1 | 2 |\n', 1).series[1].name, '2');
  assert.equal(plotModel('#+PLOT: ind:1 deps:(3) labels:("X" "A" "B")\n| 1 | 2 | 3 |\n', 1).series[0].name, '3');
  assert.equal(plotModel('#+PLOT: ind:0 deps:(1)\n| 1 | 2 |\n', 1).series[0].points[0][0], 1);
  assert.throws(() => plotModel('#+PLOT: deps:(9)\n| 1 | 2 |\n', 1), /Column 9/);
  assert.throws(() => plotModel('#+PLOT: type:pie\n| 1 | 2 |\n', 1), /not supported/);
});

test('the drawing has a line per series, the legend, and keeps the title out unless asked', () => {
  const s = plotSvg(plotModel(T, 3));
  assert.equal((s.match(/<polyline/g) ?? []).length, 2);
  assert.ok(s.includes('>a<') && s.includes('>b<'));
  assert.ok(!s.includes('font-size="13"'));
  assert.ok(plotSvg(plotModel(T, 3), { titleInside: true }).includes('font-size="13"'));
  assert.ok(plotSvg(plotModel(T.replace('with:lines', 'with:histograms'), 3)).includes('<rect'));
  assert.ok(!plotSvg(plotModel(T.replace('"grid"', '"key off"'), 3)).includes('>a<'));
});

test('tick values step by 1, 2 or 5 powers of ten', () => {
  assert.deepEqual(niceTicks(0, 8), [0, 2, 4, 6, 8]);
  assert.deepEqual(niceTicks(0, 100), [0, 20, 40, 60, 80, 100]);
});

// Option lines and data files as Emacs 30.1 / Org 9.7 reads them (org-plot/collect-options and org-plot/gnuplot-to-data).
import { readFileSync } from 'node:fs';
const fixtures = JSON.parse(readFileSync(new URL('./fixtures/emacs-plot.json', import.meta.url), 'utf8'));

/** A property list as Emacs prints it, as an object keyed without the colon. */
function plist(src) {
  const toks = src.match(/"(?:[^"\\]|\\.)*"|[()]|[^\s()]+/g) ?? [];
  let i = 0;
  const value = () => {
    const t = toks[i++];
    if (t === '(') { const xs = []; while (toks[i] !== ')') xs.push(value()); i++; return xs; }
    if (t.startsWith('"')) return t.slice(1, -1);
    return /^-?\d+$/.test(t) ? Number(t) : t;
  };
  const xs = value() ?? [];
  const o = {};
  for (let k = 0; k < xs.length; k += 2) o[String(xs[k]).slice(1)] = xs[k + 1];
  return o;
}

for (const c of fixtures) {
  test(`Emacs ${c.id}: options of ${c.input.split('\n')[0]}`, () => {
    const lines = c.input.split('\n');
    const first = lines.findIndex((l) => l.startsWith('|'));
    const mine = plotOptions(lines, first);
    const want = c.params === 'nil' ? {} : plist(c.params);
    for (const [k, v] of Object.entries(want)) assert.deepEqual(mine[k === 'plot-type' ? 'type' : k], v, `${c.id} ${k}`);
  });
}

test('dots and filledcurves styles draw', () => {
  const t = '| x | a |\n|---+---|\n| 1 | 2 |\n| 2 | 4 |\n| 3 | 3 |\n';
  const d = plotSvg(plotModel('#+PLOT: ind:1 with:dots\n' + t, 1), {});
  assert.match(d, /r="1.2"/);
  assert.match(plotSvg(plotModel('#+PLOT: ind:1 with:filledcurves\n' + t, 1), {}), /<polygon/);
});

const M = '| x | a | b |\n|---+---+---|\n| 1 | 2 | 3 |\n| 2 | 4 | 5 |\n| 3 | 6 | 7 |\n';
test('type:grid draws a colored cell per number, with a scale', () => {
  const svg = plotSvg(plotModel('#+PLOT: type:grid\n' + M, 1), {});
  assert.equal((svg.match(/<rect /g) ?? []).length, 9 + 20);
  assert.match(svg, />7</); assert.match(svg, />1</);
});
test('type:3d draws a surface, and turning it changes the picture', () => {
  const m = plotModel('#+PLOT: type:3d\n' + M, 1);
  const a = plotSvg(m, {}), b = plotSvg(m, { view: { az: 20, el: 50 } });
  assert.equal((a.match(/<polygon/g) ?? []).length, 1 + 4);
  assert.notEqual(a, b);
});
test('grid and 3d need numbers', () => {
  assert.throws(() => plotModel('#+PLOT: type:grid\n| a | b |\n|---+---|\n| x | y |\n', 1), /Nothing to plot/);
});
