import test from 'node:test';
import assert from 'node:assert/strict';
import { anniversaries, parseContacts } from '../core/contacts.js';
import { agenda } from '../core/agenda.js';

// The author's example from Emacs with org-contacts: the agenda for November 23, 2026
const CONTACTS = '#+TITLE: Contacts\n\n* Jane Doe\n:PROPERTIES:\n:EMAIL: jane.doe@example.com\n:BIRTHDAY: 1990-11-23\n:END:\n\n* John Smith\n:PROPERTIES:\n:EMAIL: john.smith@example.com\n:BIRTHDAY: 11-23\n:END:\n';
const AGENDA = '#+TITLE: Agenda\n\n* Birthdays\n%%(org-contacts-anniversaries)\n';

test('birthdays have the name and the age as an ordinal', () => {
  const book = parseContacts([CONTACTS]);
  assert.deepEqual(anniversaries(book, [11, 23, 2026]), ['Birthday: Jane Doe (36th)', 'Birthday: John Smith (0th)']);
  assert.deepEqual(anniversaries(book, [11, 24, 2026]), []);
});

test('the age ordinals', () => {
  const book = parseContacts(['* A\n:PROPERTIES:\n:BIRTHDAY: 2000-01-01\n:END:\n']);
  const age = (y) => anniversaries(book, [1, 1, y])[0];
  assert.deepEqual([2001, 2002, 2003, 2004, 2011, 2012, 2013, 2021, 2022].map(age).map((s) => /\((.*)\)/.exec(s)[1]), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd']);
});

test('Org timestamps work, other text is not a date, and the property name must match', () => {
  const book = parseContacts(['* A\n:PROPERTIES:\n:BIRTHDAY: <1990-11-26 Mon>\n:ANNIVERSARY: 2015-11-28\n:END:\n* B\n:PROPERTIES:\n:BIRTHDAY: November 26\n:END:\n* C\n:PROPERTIES:\n:BIRTHDAY: 1985-11-26\n:END:\n']);
  assert.deepEqual(anniversaries(book, [11, 26, 2026]), ['Birthday: A (36th)', 'Birthday: C (41st)']);
  assert.deepEqual(anniversaries(book, [11, 28, 2026], { field: 'ANNIVERSARY' }), ['Birthday: A (11th)']);
  assert.deepEqual(anniversaries(book, [11, 28, 2026], { field: 'Anniversary' }), []); // Emacs matched the property name exactly
});

test('a sexp in an agenda file shows the birthdays under the file category', () => {
  const v = agenda([{ category: 'agenda', text: AGENDA }], { start: new Date(Date.UTC(2026, 10, 23)), span: 'day', today: new Date(Date.UTC(2026, 10, 23)), now: null, timeGrid: false, contacts: { texts: [CONTACTS], property: 'BIRTHDAY' } });
  assert.deepEqual(v.days[0].entries.map((e) => `${e.category}: ${e.title}`), ['agenda: Birthday: Jane Doe (36th)', 'agenda: Birthday: John Smith (0th)']);
});

test('without contacts the sexp shows nothing, and a diary sexp shows the same lines', () => {
  const none = agenda([{ category: 'agenda', text: AGENDA }], { start: new Date(Date.UTC(2026, 10, 23)), span: 'day', today: new Date(Date.UTC(2026, 10, 23)), now: null, timeGrid: false });
  assert.equal(none.days[0].entries.length, 0);
  const d = agenda([], { start: new Date(Date.UTC(2026, 10, 23)), span: 'day', today: new Date(Date.UTC(2026, 10, 23)), now: null, timeGrid: false, diary: { text: AGENDA, style: 'american' }, contacts: { texts: [CONTACTS] } });
  assert.deepEqual(d.days[0].entries.map((e) => e.title), ['Birthday: Jane Doe (36th)', 'Birthday: John Smith (0th)']);
});

// org-vcard's two layouts for the same contact (the author's example, a vCard with BDAY:1815-12-10)
const FLAT = '* Ada Lovelace\n:PROPERTIES:\n:VERSION: 4.0\n:N: Lovelace;Ada;Augusta;;\n:EMAIL_WORK: ada@analytical-labs.example.org\n:CELL: +44 7700 900077\n:BIRTHDAY: 1815-12-10\n:NOTE: Early computing pioneer.\n:END:\n';
const TREE = '* Ada Lovelace\n:PROPERTIES:\n:KIND: individual\n:FIELDTYPE: name\n:END:\n** 1815-12-10\n:PROPERTIES:\n:FIELDTYPE: birthday\n:END:\n** ada@analytical-labs.example.org\n:PROPERTIES:\n:FIELDTYPE: email-work\n:END:\n** Lovelace;Ada;Augusta;;\n:PROPERTIES:\n:FIELDTYPE: n\n:END:\n** Early computing pioneer.\n:PROPERTIES:\n:FIELDTYPE: note\n:END:\n** +44 7700 900077\n:PROPERTIES:\n:FIELDTYPE: cell\n:END:\n';

test('birthdays read from the flat and the tree layouts of org-vcard', () => {
  for (const text of [FLAT, TREE]) {
    const book = parseContacts([text]);
    assert.equal(book.length, 1, 'the field headings are not contacts');
    assert.deepEqual(anniversaries(book, [12, 10, 2026]), ['Birthday: Ada Lovelace (211th)']);
    assert.deepEqual(anniversaries(book, [12, 11, 2026]), []);
  }
});

test('a tree contact with a deeper field and a second contact after it', () => {
  const book = parseContacts([`${TREE.replace('** 1815-12-10', '*** 1815-12-10')}* Bob\n:PROPERTIES:\n:BIRTHDAY: 1985-12-10\n:END:\n`]);
  assert.deepEqual(anniversaries(book, [12, 10, 2026]), ['Birthday: Ada Lovelace (211th)', 'Birthday: Bob (41st)']);
});

test('birthday entries are flagged, other entries are not', () => {
  const d = new Date(Date.UTC(2026, 10, 23));
  const v = agenda([{ category: 'agenda', text: `${AGENDA}* Other\n%%(diary-float 11 1 4 \"Not a birthday\")\n` }], { start: d, span: 'day', today: d, now: null, timeGrid: false, contacts: { texts: [CONTACTS] } });
  const e = v.days[0].entries;
  assert.equal(e.filter((x) => x.birthday).length, 2);
  assert.ok(e.every((x) => x.birthday || !/Birthday/.test(x.title)));
});
