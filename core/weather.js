// The weather line of %%(org-weather): current conditions and today's forecast from Open-Meteo (https://open-meteo.com/en/docs),
// shaped by org-weather-format. Written from the author's description of the placeholders and Open-Meteo's published parameters.

export const DEFAULT_FORMAT = 'Weather: %desc, %tcur(%tmin-%tmax)%tu, %p%pu, %h%hu, %s%su, %a%au';

/** WMO weather codes as Open-Meteo reports them: description, group and emoji. */
const CODES = new Map([
  [0, ['Clear sky', 'Clear', '☀️']], [1, ['Mainly clear', 'Clear', '🌤️']], [2, ['Partly cloudy', 'Clouds', '⛅']], [3, ['Overcast', 'Clouds', '☁️']],
  [45, ['Fog', 'Fog', '🌫️']], [48, ['Rime fog', 'Fog', '🌫️']],
  [51, ['Light drizzle', 'Drizzle', '🌦️']], [53, ['Moderate drizzle', 'Drizzle', '🌦️']], [55, ['Dense drizzle', 'Drizzle', '🌦️']],
  [56, ['Light freezing drizzle', 'Drizzle', '🌦️']], [57, ['Dense freezing drizzle', 'Drizzle', '🌦️']],
  [61, ['Slight rain', 'Rain', '🌧️']], [63, ['Moderate rain', 'Rain', '🌧️']], [65, ['Heavy rain', 'Rain', '🌧️']],
  [66, ['Light freezing rain', 'Rain', '🌧️']], [67, ['Heavy freezing rain', 'Rain', '🌧️']],
  [71, ['Slight snow', 'Snow', '🌨️']], [73, ['Moderate snow', 'Snow', '🌨️']], [75, ['Heavy snow', 'Snow', '❄️']], [77, ['Snow grains', 'Snow', '🌨️']],
  [80, ['Slight rain showers', 'Rain', '🌦️']], [81, ['Moderate rain showers', 'Rain', '🌦️']], [82, ['Violent rain showers', 'Rain', '🌧️']],
  [85, ['Slight snow showers', 'Snow', '🌨️']], [86, ['Heavy snow showers', 'Snow', '❄️']],
  [95, ['Thunderstorm', 'Thunderstorm', '⛈️']], [96, ['Thunderstorm with slight hail', 'Thunderstorm', '⛈️']], [97, ['Heavy thunderstorm', 'Thunderstorm', '⛈️']], [99, ['Thunderstorm with heavy hail', 'Thunderstorm', '⛈️']],
]);

const SPEED = new Map([['mph', ['mph', 'mph']], ['km/h', ['kmh', 'km/h']], ['m/s', ['ms', 'm/s']], ['knots', ['kn', 'Knots']]]);

/** The wind-speed unit as Open-Meteo names it and as it is shown; km/h when not set. */
export function speedUnit(name) { return SPEED.get(String(name ?? 'km/h').toLowerCase()) ?? SPEED.get('km/h'); }

/** Open-Meteo's name for the temperature unit, and its sign. */
export function temperatureUnit(name) {
  const f = /^(f|fahrenheit)$/i.test(String(name ?? ''));
  return f ? ['fahrenheit', '°F'] : ['celsius', '°C'];
}

/** The request for one place; the answer is read by `parseForecast`. */
export function forecastUrl({ lat, lon, temperature, speed }) {
  const q = new URLSearchParams({
    latitude: String(lat), longitude: String(lon),
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,surface_pressure,wind_speed_10m,weather_code',
    hourly: 'temperature_2m',
    daily: 'temperature_2m_max,temperature_2m_min,apparent_temperature_max,apparent_temperature_min',
    timezone: 'auto', forecast_days: '1',
    temperature_unit: temperatureUnit(temperature)[0], wind_speed_unit: speedUnit(speed)[0],
  });
  return `https://api.open-meteo.com/v1/forecast?${q}`;
}

/** What the placeholders need from Open-Meteo's answer. `dataAt` is the time of the data itself (current.time, local to the place, with the answer's UTC offset), which %a measures; `fetchedAt` (ms) is when the answer came, which the refresh interval measures. */
export function parseForecast(json, fetchedAt) {
  const c = json.current, d = json.daily, hours = json.hourly.temperature_2m;
  const [y, mo, day, h, mi] = c.time.split(/[-T:]/).map(Number);
  return {
    fetchedAt, dataAt: Date.UTC(y, mo - 1, day, h, mi) - json.utc_offset_seconds * 1000, code: c.weather_code,
    tcur: c.temperature_2m, humidity: c.relative_humidity_2m, pressure: c.surface_pressure, wind: c.wind_speed_10m,
    tmin: d.temperature_2m_min[0], tmax: d.temperature_2m_max[0], tamin: d.apparent_temperature_min[0], tamax: d.apparent_temperature_max[0],
    tnight: hours[0], tmorn: hours[6], tday: hours[12], teve: hours[18],
  };
}

const round = (n) => String(Math.round(n));

/** The age of a snapshot: [number, unit] in minutes, hours or days. */
function age(ms) {
  const m = Math.max(0, Math.floor(ms / 60000));
  if (m < 60) return [m, 'm'];
  if (m < 1440) return [Math.floor(m / 60), 'h'];
  return [Math.floor(m / 1440), 'd'];
}

/** The line for a snapshot: org-weather-format with its placeholders filled in. */
export function weatherLine(snap, { format = DEFAULT_FORMAT, temperature, speed, now = Date.now() } = {}) {
  const [desc, main, icon] = CODES.get(snap.code) ?? ['Unknown', 'Unknown', ''];
  const [n, unit] = age(now - snap.dataAt);
  const values = {
    desc, icon, main,
    tmorn: round(snap.tmorn), tday: round(snap.tday), teve: round(snap.teve), tnight: round(snap.tnight),
    tcur: round(snap.tcur), tmin: round(snap.tmin), tmax: round(snap.tmax), tamin: round(snap.tamin), tamax: round(snap.tamax),
    tu: temperatureUnit(temperature)[1], hu: '%', pu: 'hPa', su: speedUnit(speed)[1], au: unit,
    h: round(snap.humidity), p: round(snap.pressure), s: round(snap.wind), a: String(n),
  };
  const names = Object.keys(values).sort((a, b) => b.length - a.length);
  return format.replace(new RegExp(`%(${names.join('|')})`, 'g'), (_, k) => values[k]);
}

/** Whether the snapshot is due for a refresh; `hours` of 0 or null means never refresh by itself. */
export function due(snap, hours, now = Date.now()) {
  if (!snap) return true;
  return Boolean(hours) && now - snap.fetchedAt >= hours * 3600000;
}

/** The state the diary sexp reads; the app fills it in. */
export const weather = { snapshot: null, options: {} };
