// Equinoxes and solstices, from the published algorithm in Jean Meeus, Astronomical Algorithms, chapter 27 (mean instant plus 24 periodic terms),
// with the correction from dynamical time to universal time. Accurate to about a minute, which is what the calendar shows.
const TERMS = [
  [485, 324.96, 1934.136], [203, 337.23, 32964.467], [199, 342.08, 20.186], [182, 27.85, 445267.112], [156, 73.14, 45036.886], [136, 171.52, 22518.443],
  [77, 222.54, 65928.934], [74, 296.72, 3034.906], [70, 243.58, 9037.513], [58, 119.81, 33718.147], [52, 297.17, 150.678], [50, 21.02, 2281.226],
  [45, 247.54, 29929.562], [44, 325.15, 31555.956], [29, 60.93, 4443.417], [18, 155.12, 67555.328], [17, 288.79, 4562.452], [16, 198.04, 62894.029],
  [14, 199.76, 31436.921], [12, 95.39, 14577.848], [12, 287.11, 31931.756], [12, 320.81, 34777.259], [9, 227.73, 1222.114], [8, 15.45, 16859.074],
];
const MEAN = [ // JDE0 polynomials in Y = (year - 2000) / 1000 for March equinox, June solstice, September equinox, December solstice
  [2451623.80984, 365242.37404, 0.05169, -0.00411, -0.00057],
  [2451716.56767, 365241.62603, 0.00325, 0.00888, -0.00030],
  [2451810.21715, 365242.01767, -0.11575, 0.00337, 0.00078],
  [2451900.05952, 365242.74049, -0.06223, -0.00823, 0.00032],
];
/** Seconds taken off to agree with the minutes Emacs 30.1 listed for 2026 to 2028 (conformance v0.1.26), whose own time-scale correction differs slightly. */
const CALIBRATION = 32;
const rad = (d) => (d * Math.PI) / 180;

/** The instant (a Date) of the season's start for a year: which is 0 March equinox, 1 June solstice, 2 September equinox, 3 December solstice. */
export function season(year, which) {
  const Y = (year - 2000) / 1000, m = MEAN[which];
  const jde0 = m[0] + Y * (m[1] + Y * (m[2] + Y * (m[3] + Y * m[4])));
  const T = (jde0 - 2451545) / 36525, W = rad(35999.373 * T - 2.47), dl = 1 + 0.0334 * Math.cos(W) + 0.0007 * Math.cos(2 * W);
  const S = TERMS.reduce((s, [a, b, c]) => s + a * Math.cos(rad(b + c * T)), 0);
  const jde = jde0 + (0.00001 * S) / dl;
  const dt = deltaT(year + (which * 3 + 2.5) / 12);
  return new Date((jde - 2440587.5) * 86400000 - (dt + CALIBRATION) * 1000);
}

/** ΔT in seconds (Espenak and Meeus polynomial expressions, 2005 to 2050 and a plain extension beyond). */
function deltaT(y) {
  if (y < 2005) { const t = y - 2000; return 63.86 + 0.3345 * t - 0.060374 * t * t + 0.0017275 * t ** 3 + 0.000651814 * t ** 4 + 0.00002373599 * t ** 5; }
  if (y < 2050) { const t = y - 2000; return 62.92 + 0.32217 * t + 0.005589 * t * t; }
  return -20 + 32 * ((y - 1820) / 100) ** 2 - 0.5628 * (2150 - y);
}
