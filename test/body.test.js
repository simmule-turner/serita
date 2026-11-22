// Heading bodies: the text under a heading, after its planning line and properties drawer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bodyOf, setBody } from '../core/body.js';

const T = '* TODO A\nSCHEDULED: <2026-11-30 Mon>\n:PROPERTIES:\n:ID: 1\n:END:\nline one\nline two\n** B\nchild\n* C\n';

test('the body skips the planning line and the properties drawer and stops at the first child', () => {
  assert.equal(bodyOf(T, 0), 'line one\nline two');
  assert.equal(bodyOf(T, 7), 'child');
  assert.equal(bodyOf('* A\n', 0), '');
});

test('setting the body replaces only that text', () => {
  assert.equal(setBody(T, 0, 'new').text, '* TODO A\nSCHEDULED: <2026-11-30 Mon>\n:PROPERTIES:\n:ID: 1\n:END:\nnew\n** B\nchild\n* C\n');
  assert.equal(setBody(T, 0, '').text, '* TODO A\nSCHEDULED: <2026-11-30 Mon>\n:PROPERTIES:\n:ID: 1\n:END:\n** B\nchild\n* C\n');
});

test('a heading with no body gets one, and a body that was the end of a file without a newline stays so', () => {
  assert.equal(setBody('* A\n* B\n', 0, 'x\ny').text, '* A\nx\ny\n* B\n');
  assert.equal(setBody('* A', 0, 'x').text, '* A\nx\n');
  assert.equal(setBody('* A\ntext', 0, 'y').text, '* A\ny');
});

test('the remap moves lines after the body', () => {
  const r = setBody('* A\none\n* B\n', 0, 'a\nb\nc');
  assert.equal(r.text, '* A\na\nb\nc\n* B\n');
  assert.equal(r.remap(2), 4);
  assert.equal(r.remap(0), 0);
});
