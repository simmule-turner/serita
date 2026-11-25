import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as T from '../core/table.js';

// Every case below is a question put to Emacs 30.1 (Org 9.7.11) in conformance v0.1.34; the fixture holds its answers.
const F = JSON.parse(fs.readFileSync(new URL('./fixtures/emacs-tables.json', import.meta.url), 'utf8'));

const KEYS = {
  'TAB': (t, l, c) => T.nextField(t, l, c),
  '<backtab>': (t, l, c) => T.previousField(t, l, c),
  'RET': (t, l, c) => { const s = t.split('\n')[l]; return s.slice(c).trim() === '' ? typed(t, l, c, '\n') : T.nextRow(t, l, c); },
  'C-c C-c': (t, l, c) => T.align(t, l, c),
  'M-RET': (t, l, c) => T.splitField(t, l, c),
  'S-<return>': (t, l, c) => T.copyDown(t, l, c),
  'C-c -': (t, l, c) => T.insertHline(t, l, c),
  'C-c RET': (t, l, c) => T.hlineAndMove(t, l, c),
  'M-<up>': (t, l, c) => T.moveRow(t, l, c, -1),
  'M-<down>': (t, l, c) => T.moveRow(t, l, c, 1),
  'M-S-<up>': (t, l, c) => T.deleteRow(t, l, c),
  'M-S-<down>': (t, l, c) => T.insertRow(t, l, c),
  'M-<left>': (t, l, c) => T.moveColumn(t, l, c, -1),
  'M-<right>': (t, l, c) => T.moveColumn(t, l, c, 1),
  'M-S-<left>': (t, l, c) => T.deleteColumn(t, l, c),
  'M-S-<right>': (t, l, c) => T.insertColumn(t, l, c),
  'C-c ^ a': (t, l, c) => T.sortRows(t, l, c, 'a'), 'C-c ^ A': (t, l, c) => T.sortRows(t, l, c, 'A'),
  'C-c ^ n': (t, l, c) => T.sortRows(t, l, c, 'n'), 'C-c ^ N': (t, l, c) => T.sortRows(t, l, c, 'N'),
  'C-c ^ q': (t, l, c) => ({ text: t, line: l, col: c, error: 'Quit' }),
  'C-c ^ t': (t, l, c) => T.sortRows(t, l, c, 't'), 'C-c ^ T': (t, l, c) => T.sortRows(t, l, c, 'T'),
};

/** The keys that mean something else after C-u. */
const PREFIXED = {
  'C-c -': (t, l, c) => T.insertHline(t, l, c, true),
  'M-S-<down>': (t, l, c) => T.insertRow(t, l, c, true),
};

function typed(t, l, c, s) {
  const ls = t.split('\n');
  ls[l] = ls[l].slice(0, c) + s + ls[l].slice(c);
  const after = ls.join('\n').split('\n');
  return s === '\n' ? { text: ls.join('\n'), line: l + 1, col: 0 } : { text: after.join('\n'), line: l, col: c + s.length };
}

/** Plays a key sequence: known commands, and single characters typed into the text. */
function play(text, line, col, keys) {
  let r = { text, line, col };
  const toks = keys.split(' ');
  let prefix = false;
  for (let i = 0; i < toks.length; i++) {
    let k = toks[i];
    if (k === 'C-u') { prefix = true; continue; }
    if (k === 'C-c' && toks[i + 1] === '|') {
      const size = /^(\d+) x (\d+)$/.exec(toks.slice(i + 2, -1).join(' ')) ;
      const made = T.createTable(r.text, r.line, size ? Number(size[1]) : 5, size ? Number(size[2]) : 2, r.col);
      return { ...made, error: false };
    }
    if (k === 'C-c' && toks[i + 1] === '^') { k = `C-c ^ ${toks[i + 2]}`; i += 2; } else if (k === 'C-c' && toks[i + 1]) { k = `C-c ${toks[i + 1]}`; i += 1; }
    const fn = prefix ? PREFIXED[k] ?? KEYS[k] : KEYS[k];
    prefix = false;
    const next = fn ? fn(r.text, r.line, r.col) : k.length === 1 ? typed(r.text, r.line, r.col, k) : null;
    assert.ok(next, `no key ${k}`);
    r = { ...next, error: next.error ?? r.error };
    if (next.error) break;
  }
  return r;
}

const SKIP = new Set(['tn-sort-c', 'tn-sort-C', 'tb-cv-4', 'tb-cv-16', 'tb-cv-64', 'tb-cv-quote', 'tb-cv-pipes', 'tb-cv-ragged', 'tb-cv-empty', 'tb-cv-blank', 'tb-cv-table']);
const keyed = Object.entries(F).filter(([id, c]) => !c.eval && c.keys && !/^tb-(blank|conv|create|sum|bar-a|info)/.test(id) && !/^tn-(blank|conv|sum|tr-)/.test(id) && !SKIP.has(id));

for (const [id, c] of keyed) {
  test(`Emacs table: ${c.question} (${id})`, () => {
    const r = play(c.input, c.line - 1, c.col, c.keys);
    assert.equal(r.text, c.text);
    assert.deepEqual([r.line + 1, r.col], c.pt);
    assert.equal(Boolean(r.error), Boolean(c.error));
  });
}

test('Emacs table: creating a table asks for columns and rows, and sets the cursor at its first line', () => {
  for (const id of ['tb-create', 'tb-create-line', 'tb-create-csv']) {
    const c = F[id];
    const r = T.createTable(c.input, c.line - 1);
    assert.equal(r.text, c.text);
    assert.deepEqual([r.line + 1, r.col], c.pt);
  }
  assert.equal(T.createTable('\n', 0, 3, 2).text, F['tb-create-size'].text);
});

test('Emacs table: field info', () => {
  for (const id of ['tb-info-1', 'tb-info-2', 'tb-info-3']) {
    const c = F[id];
    assert.equal(T.fieldInfo(c.input, c.line - 1, c.col), c.texts[0]);
  }
});

test('Emacs table: converting a region guesses the separator, or takes a number of spaces or a regexp', () => {
  const run = (id, sep) => { const c = F[id]; return T.convertRegion(c.input, 0, c.input.split('\n').length - 1, sep).text; };
  assert.equal(run('tb-cv-nil'), F['tb-cv-nil'].text);
  assert.equal(run('tb-cv-nil-tab'), F['tb-cv-nil-tab'].text);
  assert.equal(run('tb-cv-nil-sp'), F['tb-cv-nil-sp'].text);
  assert.equal(run('tb-cv-nil-mix'), F['tb-cv-nil-mix'].text);
  assert.equal(run('tb-cv-n', 2), F['tb-cv-n'].text);
  assert.equal(run('tb-cv-re', '[;,]'), F['tb-cv-re'].text);
});

test('Emacs table: import splits quoted CSV, tabs and words', () => {
  const imp = (s) => T.convertRegion(s, 0, s.split('\n').length - 1).text;
  assert.equal(imp('a,b\n1,2\n'), F['tb-im-csv'].text);
  assert.equal(imp('"a,b",c\n1,2\n'), F['tb-im-q'].text);
  assert.equal(imp('one two\nthree four\n'), F['tb-im-space'].text);
});

test('Emacs table: transpose, lisp, export', () => {
  assert.equal(T.transpose(F['tb-transpose'].input, 0).text, F['tb-transpose'].text);
  assert.equal(T.transpose(F['tb-transpose-r'].input, 0).text, F['tb-transpose-r'].text);
  const lisp = (id) => JSON.stringify(T.toLisp(F[id].input, 0)).replace(/"hline"/g, 'hline');
  assert.equal(lisp('tb-lisp-1'), '[["a","b","c"],hline,["1","22","333"],["4444","5","6"]]');
  assert.deepEqual(T.toLisp(F['tb-lisp-2'].input, 0), [['a', ''], ['', 'd']]);
  assert.deepEqual(T.toLisp(F['tb-lisp-3'].input, 0), [['a  b', 'c']]);
  assert.equal(T.exportTable(F['tb-ex-csv'].input, 0, 'csv'), 'a,b,c\n1,22,333\n4444,5,6\n');
  assert.equal(T.exportTable(F['tb-ex-tsv'].input, 0, 'tsv'), 'a\tb\tc\n1\t22\t333\n4444\t5\t6\n');
  assert.equal(T.exportTable(F['tb-ex-csvq'].input, 0, 'csv'), '"a,b","""c"""\nd,e\n');
  assert.equal(T.exportTable(F['tb-ex-orgtbl'].input, 0, 'org'), F['tb-ex-orgtbl'].texts[1].replace(/^X "|"$/g, '').replace(/\\n/g, '\n'));
});

test('Emacs table: which lines are table lines, and which are rules', () => {
  const lines = (id, fn) => F[id].input.split('\n').slice(0, -1).map((_, i) => fn(F[id].input, i));
  assert.deepEqual(lines('tb-ismember', (t, i) => T.tableAt(t, i) !== null), [false, false, true, true, true, false, false]);
  assert.deepEqual(lines('tb-ismember3', (t, i) => T.tableAt(t, i) !== null), [false, false, false, false, false, false, true]);
});

test('tableView gives rows, alignment and width cookies', async () => {
  const { tableView, cellCol, setField } = await import('../core/table.js');
  const v = tableView('| a | <3> |\n|---+----|\n| bcdef | 12 |\n', 0);
  assert.deepEqual(v.align, ['l', 'r']);
  assert.equal(v.limit[1], 3);
  assert.equal(v.rows[1].rule, true);
  assert.equal(v.rows[0].cookies, false);
  assert.equal(cellCol('| a  | b |\n', 0, 1), 7);
  assert.equal(setField('| a | b |\n', 0, 1, 'xyz').text, '| a | xyz |\n');
});

test('Emacs table: convert separators treat a bar as a separator; sum and blank-field', () => {
  const conv = (id, sep) => { const c = F[id]; return T.convertRegion(c.input, 0, c.input.split('\n').length - 1, sep).text; };
  assert.equal(conv('tr-mix-nil'), F['tr-mix-nil'].text);
  assert.equal(conv('tr-mix-1', 1), F['tr-mix-1'].text);
  assert.equal(conv('tr-mix-3', 3), F['tr-mix-3'].text);
  assert.equal(conv('tr-mix-16', 'tab'), F['tr-mix-16'].text);
  assert.equal(conv('tr-mix-4', 'comma'), F['tr-mix-4'].text);
  assert.equal(conv('tr-csv-16', 'tab'), F['tr-csv-16'].text);
  assert.equal(conv('tr-csv-4', 'comma'), F['tr-csv-4'].text);
  assert.equal(conv('tr-empty-lines'), F['tr-empty-lines'].text);
  assert.equal(conv('tr-spaces-nil'), F['tr-spaces-nil'].text);
  for (const [id, l] of [['ts-1', 3], ['ts-2', 3], ['ts-3', 4], ['ts-4', 2], ['ts-5', 2], ['ts-6', 2], ['ts-7', 1]]) {
    assert.equal(`K ${JSON.stringify(T.sumColumn(F[id].input, l, 2))}`, F[id].texts[0], id);
  }
  assert.equal(T.blankField(F['tb-blank-1'].input, 0, 3).text, F['tb-blank-1'].text);
  assert.equal(T.blankField(F['tb-blank-2'].input, 1, 6).text, F['tb-blank-2'].text);
  assert.ok(T.blankField(F['tb-blank-3'].input, 1, 1).error);
});
