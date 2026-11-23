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
