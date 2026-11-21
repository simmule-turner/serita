import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseXml, childrenOf, XmlError } from '../app/storage/xml.js';

test('xml: elements, text, attributes and the prolog', () => {
  const r = parseXml('<?xml version="1.0" encoding="utf-8"?>\n<a x="1" y=\'2\'><b>hi</b><c/></a>\n');
  assert.equal(r.name, 'a');
  assert.deepEqual(r.attrs, { x: '1', y: '2' });
  assert.equal(r.children[0].text, 'hi');
  assert.equal(r.children[1].name, 'c');
});

test('xml: entities, character references, CDATA, comments', () => {
  const r = parseXml('<a><!-- c -->x &amp; &lt;y&gt; &#65;&#x42; <![CDATA[<raw & text>]]></a>');
  assert.equal(r.text, 'x & <y> AB <raw & text>');
});

test('xml: a prefix and a default namespace read the same', () => {
  const a = parseXml('<D:multistatus xmlns:D="DAV:"><D:response/></D:multistatus>');
  const b = parseXml('<multistatus xmlns="DAV:"><response/></multistatus>');
  const c = parseXml('<x:multistatus xmlns:x="DAV:"><x:response/></x:multistatus>');
  for (const r of [a, b, c]) {
    assert.equal(r.ns, 'DAV:');
    assert.equal(childrenOf(r, 'DAV:', 'response').length, 1);
  }
});

test('xml: namespaces scope to their element and can be redeclared', () => {
  const r = parseXml('<a xmlns="one"><b xmlns="two"><c/></b><d/></a>');
  assert.equal(r.children[0].ns, 'two');
  assert.equal(r.children[0].children[0].ns, 'two');
  assert.equal(r.children[1].ns, 'one');
});

test('xml: another namespace is not DAV:', () => {
  const r = parseXml('<a xmlns:o="other:" xmlns="DAV:"><o:href/><href/></a>');
  assert.equal(childrenOf(r, 'DAV:', 'href').length, 1);
});

test('xml: malformed input is an XmlError', () => {
  for (const bad of ['<a>', '<a></b>', '<a><b></a>', 'text', '<a/><b/>', '<a><!-- x </a>', '', '<a x=1/>']) {
    assert.throws(() => parseXml(bad), XmlError, JSON.stringify(bad));
  }
});

test('xml: unicode and whitespace text survive', () => {
  assert.equal(parseXml('<a>📔 naïve\n  x</a>').text, '📔 naïve\n  x');
});
