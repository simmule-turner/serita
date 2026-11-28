// The weather line of %%(org-weather): formatting, units, the Open-Meteo request and the diary sexp. The forecast is a hand-built answer shaped like Open-Meteo's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weatherLine, parseForecast, forecastUrl, due, weather, DEFAULT_FORMAT } from '../core/weather.js';
import { ev, now, defineFunctions } from '../core/diary.js';
import { readForms } from '../core/lisp-read.js';

const form = readForms('(org-weather)')[0];

const hourly = Array.from({ length: 24 }, (_, i) => i);
const json = {
  utc_offset_seconds: -18000,
  current: { time: '2026-11-26T04:15', temperature_2m: 12.4, relative_humidity_2m: 71, apparent_temperature: 10, surface_pressure: 1012.6, wind_speed_10m: 14.2, weather_code: 61 },
  hourly: { temperature_2m: hourly },
  daily: { temperature_2m_min: [8.2], temperature_2m_max: [15.7], apparent_temperature_min: [6], apparent_temperature_max: [14] },
};
const dataAt = Date.UTC(2026, 10, 26, 9, 15);
const at = Date.UTC(2026, 10, 26, 9, 30);
const snap = parseForecast(json, at);

test('the data keeps its own time, read in the place\'s zone', () => assert.equal(snap.dataAt, dataAt));

test('the default format', () => {
  assert.equal(weatherLine(snap, { now: at + 5 * 60000 }), 'Weather: Slight rain, 12(8-16)°C, 1013hPa, 71%, 14km/h, 20m');
});

test('every placeholder', () => {
  const f = '%desc|%icon|%main|%tmorn|%tday|%teve|%tnight|%tcur|%tmin|%tmax|%tamin|%tamax|%tu|%hu|%pu|%su|%au|%h|%p|%s|%a';
  assert.equal(weatherLine(snap, { format: f, now: dataAt + 3 * 3600000 }), 'Slight rain|🌧️|Rain|6|12|18|0|12|8|16|6|14|°C|%|hPa|km/h|h|71|1013|14|3');
});

test('units and age', () => {
  assert.equal(weatherLine(snap, { format: '%tu %su %a%au', temperature: 'fahrenheit', speed: 'knots', now: dataAt + 2 * 86400000 }), '°F Knots 2d');
  assert.equal(weatherLine(snap, { format: '%su', speed: 'm/s' }), 'm/s');
});

test('the request names the place, the units and the daily values', () => {
  const u = new URL(forecastUrl({ lat: 40.7, lon: -74, temperature: 'F', speed: 'mph' }));
  assert.equal(u.hostname, 'api.open-meteo.com');
  assert.equal(u.searchParams.get('temperature_unit'), 'fahrenheit');
  assert.equal(u.searchParams.get('wind_speed_unit'), 'mph');
  assert.equal(u.searchParams.get('timezone'), 'auto');
  assert.match(u.searchParams.get('daily'), /apparent_temperature_min/);
});

test('when a refresh is due', () => {
  assert.equal(due(null, 4, at), true);
  assert.equal(due(snap, 4, at + 3 * 3600000), false);
  assert.equal(due(snap, 4, at + 4 * 3600000), true);
  assert.equal(due(snap, 0, at + 99 * 3600000), false);
});

test('a defun in the init file is callable from a diary sexp and sees date', () => {
  const t = new Date(2026, 10, 26, 12);
  const keep = now.date; now.date = () => t;
  try {
    defineFunctions('(setq x 1)\n(defun today-p () "True on the current date." (equal date (calendar-current-date)))');
    const f = readForms('(when (today-p) "x")')[0];
    assert.equal(ev(f, [11, 26, 2026]), 'x');
    assert.equal(ev(f, [11, 27, 2026]), null);
    defineFunctions('(defun twice (n) (+ n n))');
    assert.equal(ev(readForms('(twice 4)')[0], [11, 26, 2026]), 8);
    defineFunctions('');
    assert.throws(() => ev(readForms('(today-p)')[0], [11, 26, 2026]), /Unsupported/);
  } finally { now.date = keep; defineFunctions(''); }
});

test('%%(org-weather) shows on today only', () => {
  const t = new Date(2026, 10, 26, 12);
  const keep = now.date; now.date = () => t;
  weather.snapshot = snap; weather.options = { now: at };
  try {
    assert.match(ev(form, [11, 26, 2026]), /^Weather: Slight rain/);
    assert.equal(ev(form, [11, 27, 2026]), null);
    weather.snapshot = null;
    assert.equal(ev(form, [11, 26, 2026]), null);
  } finally { now.date = keep; weather.snapshot = null; }
});
