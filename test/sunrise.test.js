// Sunrise and sunset against the times Emacs 30.1 gave (conformance v0.1.80 and v0.1.81: sun-*, sn-*). Within a minute is as close as the method gets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sunriseSunset } from '../core/solar.js';

const F = JSON.parse(fs.readFileSync(new URL('./fixtures/emacs-sunrise.json', import.meta.url)));
const here = { lat: 35.994, lon: -78.8986 };
const ny = (y, m, d) => (m > 3 && m < 11 || (m === 3 && d >= 8) ? { offset: -4, name: 'EDT' } : { offset: -5, name: 'EST' });
const minutes = (s) => { const m = /^(\d+):(\d\d)(am|pm)$/.exec(s); return ((+m[1] % 12) + (m[3] === 'pm' ? 12 : 0)) * 60 + +m[2]; };

test('times fall within a minute of Emacs on 13 dates', () => {
  for (const c of F.dates) {
    const s = sunriseSunset({ y: 2026, m: c.m, d: c.d }, { ...here, zone: ny });
    const [, rise, set] = /Sunrise (\S+) \(\w+\), sunset (\S+) \(/.exec(s);
    assert.ok(Math.abs(minutes(rise) - Math.round(c.rise * 60)) <= 1, `${c.m}/${c.d} sunrise ${rise}`);
    assert.ok(Math.abs(minutes(set) - Math.round(c.set * 60)) <= 1, `${c.m}/${c.d} sunset ${set}`);
    assert.ok(s.includes(`(${c.zone})`));
  }
});

test('the sentence has the form Emacs uses, with the coordinates as the place', () => {
  for (const c of F.strings) {
    const s = sunriseSunset({ y: 2026, m: c.m, d: c.d }, { ...here, zone: ny });
    assert.equal(s.replace(/\d{1,2}:\d\d(am|pm)/g, 'T').replace(/\(\d+:\d\d hrs/, '(D hrs'), c.text.replace(/\d{1,2}:\d\d(am|pm)/g, 'T').replace(/\(\d+:\d\d hrs/, '(D hrs'));
  }
});

test('a day with no sunrise or sunset says how long the sun is up', () => {
  for (const c of F.polar) {
    const s = sunriseSunset({ y: 2026, m: c.m, d: c.d }, { lat: 70, lon: 25, zone: () => ({ offset: 1, name: 'CET' }), place: 'nil' });
    assert.equal(s, c.text);
  }
});

test('a place name replaces the coordinates', () => {
  assert.match(sunriseSunset({ y: 2026, m: 11, d: 26 }, { ...here, zone: ny, place: 'Durham' }), / at Durham \(/);
});

import { diaryEntries } from '../core/diary.js';
import { where } from '../core/solar.js';
test('the diary sexp diary-sunrise-sunset gives the sentence for each day, and nothing without a place', () => {
  const run = () => diaryEntries('%%(diary-sunrise-sunset)\n', { y: 2026, m: 11, d: 26 }, 2).map((e) => e.text);
  Object.assign(where, { lat: null, lon: null, name: null });
  assert.deepEqual(run(), []);
  Object.assign(where, { lat: 35.994, lon: -78.8986, name: 'Durham' });
  const t = run();
  assert.equal(t.length, 2);
  assert.match(t[0], /^Sunrise \d+:\d\dam \(\w+\), sunset \d+:\d\dpm \(\w+\) at Durham \(\d+:\d\d hrs daylight\)$/);
  Object.assign(where, { lat: null, lon: null, name: null });
});

import { readForms } from '../core/lisp-read.js';
import { now } from '../core/diary.js';
import { timeString } from '../core/solar.js';
const shape = (s) => s.replace(/\d{1,2}:\d\d/g, 'T').replace(/\(T hrs/, '(D hrs');
test('calendar-time-display-form shapes the times (Emacs: sun-h24, sun-h12ampm)', () => {
  for (const c of F.forms) {
    where.form = readForms(c.form)[0];
    const s = sunriseSunset({ y: 2026, m: 11, d: 26 }, { ...here, zone: ny, place: 'nil' });
    assert.equal(shape(s), shape(c.text));
  }
  where.form = null;
});

test('the sexps solar-sunrise-sunset, solar-time-string, let, apply, format and when build a custom line', () => {
  Object.assign(where, { lat: 35.994, lon: -78.8986, name: 'Durham', form: null });
  now.date = () => new Date(2026, 10, 26, 9);
  const entry = '%%(when (equal date (calendar-current-date)) (let ((l (solar-sunrise-sunset date))) (format "Sun times: 🌅 %s | 🌇 %s | ⌛ %s" (apply \'solar-time-string (car l)) (apply \'solar-time-string (cadr l)) (nth 2 l))))\n';
  const t = diaryEntries(entry, { y: 2026, m: 11, d: 25 }, 3).map((e) => [e.d, e.text]);
  assert.equal(t.length, 1, 'only the current day shows');
  assert.equal(t[0][0], 26);
  assert.match(t[0][1], /^Sun times: 🌅 \d+:\d\dam \(\w+\) \| 🌇 \d+:\d\dpm \(\w+\) \| ⌛ \d+:\d\d$/);
  where.form = readForms('(24-hours ":" minutes)')[0];
  assert.match(diaryEntries(entry, { y: 2026, m: 11, d: 26 }, 1)[0].text, /^Sun times: 🌅 07:0\d \| 🌇 17:0\d \| ⌛ 9:5\d$/);
  now.date = () => new Date();
  Object.assign(where, { lat: null, lon: null, name: null, form: null });
});

test('timeString follows the form for any hours', () => {
  where.form = readForms('(24-hours "h" minutes)')[0];
  assert.equal(timeString(17.5, 'EST'), '17h30');
  where.form = null;
  assert.equal(timeString(0.25, 'EST'), '12:15am (EST)');
  assert.equal(timeString(13.5, null), '1:30pm');
});
