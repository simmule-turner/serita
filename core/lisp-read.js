// A reader for the data in an init file: lists, strings, keywords and symbols, numbers, 't' and 'nil', and the quote marks ' and #'.
// A dotted tail is kept as the `tail` property of the array. It only reads; nothing is evaluated. Strings take \n, \t, \" and \\. Comments start with ; and run to the end of the line.

/** A symbol or keyword. */
export const sym = (name) => ({ sym: name });
export const isSym = (x, name) => x !== null && typeof x === 'object' && !Array.isArray(x) && 'sym' in x && (name === undefined || x.sym === name);

/**
 * @param {string} text @param {{ integers?: boolean, spans?: boolean }} [opts] with `integers`, a number written without a point is a BigInt, so it stays apart from a float
 * @returns {any[]} every form in the text
 */
export function readForms(text, { integers = false, spans = false } = {}) {
  let i = 0;
  const fail = (msg) => { throw new Error(`${msg} at character ${i + 1}`); };
  const skip = () => { for (;;) { while (i < text.length && /\s/.test(text[i])) i++; if (text[i] === ';') { while (i < text.length && text[i] !== '\n') i++; } else return; } };
  const read = () => {
    skip();
    if (i >= text.length) fail('Unexpected end');
    const c = text[i];
    if (c === "'") { i++; return { quote: read() }; }
    if (c === '#' && text[i + 1] === "'") { i += 2; return { quote: read() }; }
    if (c === '(') {
      i++;
      const list = [];
      for (;;) {
        skip();
        if (i >= text.length) fail('A list is not closed');
        if (text[i] === ')') { i++; return list; }
        // A dot before the last element makes a dotted pair: (a b . c) is the list [a, b] with tail c.
        if (text[i] === '.' && /[\s()]/.test(text[i + 1] ?? ' ')) { i++; list.tail = read(); skip(); if (text[i] !== ')') fail('Expected ) after a dotted tail'); i++; return list; }
        list.push(read());
      }
    }
    if (c === '[') {
      i++;
      const v = []; v.vector = true;
      for (;;) {
        skip();
        if (i >= text.length) fail('A vector is not closed');
        if (text[i] === ']') { i++; return v; }
        v.push(read());
      }
    }
    if (c === ')') fail('Unexpected )');
    if (c === '"') {
      let s = '';
      for (i++; ; i++) {
        if (i >= text.length) fail('A string is not closed');
        if (text[i] === '\\') { i++; const e = text[i]; s += e === 'n' ? '\n' : e === 't' ? '\t' : e ?? ''; continue; }
        if (text[i] === '"') { i++; return s; }
        s += text[i];
      }
    }
    const m = /^[^\s()\[\]"';]+/.exec(text.slice(i));
    if (!m) fail('Unexpected character');
    i += m[0].length;
    if (m[0] === 't') return true;
    if (m[0] === 'nil') return null;
    if (/^[-+]?\d+(\.\d+)?$/.test(m[0])) return integers && !m[0].includes('.') ? BigInt(m[0]) : Number(m[0]);
    return sym(m[0]);
  };
  const forms = [];
  for (;;) {
    skip();
    if (i >= text.length) return forms;
    const start = i;
    // With `spans`, each form comes with where it starts and ends; a form that cannot be read ends the list with an `error` property.
    if (!spans) { forms.push(read()); continue; }
    try { forms.push({ form: read(), start, end: i }); } catch (e) { forms.error = { message: e.message, at: start }; return forms; }
  }
}
