// The units Serita knows: each as a factor to its base units (metre, kilogram, second, kelvin) and the exponents of those bases.
// The names and sizes were observed in Emacs/Calc (conformance v0.1.50 to v0.1.53); a name Calc does not know is not a unit here either.
// A unit whose size is not a whole number makes a conversion through it inexact, which Calc shows as a float.
const D = (s) => {
  const m = /^(\d+)(?:\.(\d+))?(?:e(-?\d+))?$/.exec(s);
  const frac = m[2] ?? '';
  let n = BigInt(m[1] + frac), d = 10n ** BigInt(frac.length);
  const e = Number(m[3] ?? 0);
  if (e >= 0) n *= 10n ** BigInt(e); else d *= 10n ** BigInt(-e);
  return [n, d];
};
const U = (size, dim, extra = {}) => { const [n, d] = Array.isArray(size) ? size.map(BigInt) : D(size); return { n, d, dim, ...extra }; };
const L = [1, 0, 0, 0], M = [0, 1, 0, 0], T = [0, 0, 1, 0], K = [0, 0, 0, 1], V = [3, 0, 0, 0], A = [2, 0, 0, 0];
const SPEED = [1, 0, -1, 0], FORCE = [1, 1, -2, 0], PRESSURE = [-1, 1, -2, 0], ENERGY = [2, 1, -2, 0], POWER = [2, 1, -3, 0], FREQ = [0, 0, -1, 0];
export const UNITS = {
  m: U('1', L), km: U('1000', L), cm: U('0.01', L), mm: U('0.001', L), um: U('0.000001', L), in: U('0.0254', L), ft: U('0.3048', L), yd: U('0.9144', L),
  mi: U('1609.344', L), nmi: U('1852', L), mil: U('0.0000254', L), fur: U('201.168', L), au: U('149597870700', L), fath: U('1.8288', L),
  g: U('0.001', M), mg: U('0.000001', M), kg: U('1', M), lb: U('0.45359237', M), oz: U('0.028349523125', M), t: U('1000', M), ton: U('907.18474', M), ct: U('0.0002', M),
  s: U('1', T), ms: U('0.001', T), us: U('0.000001', T), min: U('60', T), hr: U('3600', T), day: U('86400', T), wk: U('604800', T), yr: U('31557600', T),
  L: U('0.001', V), ml: U('0.000001', V), cl: U('0.00001', V), dl: U('0.0001', V), gal: U('0.003785411784', V), qt: U('0.000946352946', V), pt: U('0.000473176473', V),
  cup: U('0.0002365882365', V), floz: U('0.0000295735295625', V), tbsp: U('0.00001478676478125', V), tsp: U('0.000004928921593750', V),
  acre: U('4046.8564224', A), ha: U('10000', A),
  mph: U('0.44704', SPEED), knot: U([1852, 3600], SPEED), kph: U([5, 18], SPEED),
  N: U('1', FORCE), lbf: U('4.4482216152605', FORCE), dyn: U('0.00001', FORCE), kgf: U('9.80665', FORCE),
  Pa: U('1', PRESSURE), kPa: U('1000', PRESSURE), bar: U('100000', PRESSURE), atm: U('101325', PRESSURE), psi: U('6894.757293168', PRESSURE), mmHg: U([101325, 760], PRESSURE),
  J: U('1', ENERGY), cal: U('4.1868', ENERGY), kcal: U('4186.8', ENERGY), Btu: U('1055.05585262', ENERGY), Wh: U('3600', ENERGY), kWh: U('3600000', ENERGY), eV: U('1.602176634e-19', ENERGY), erg: U('0.0000001', ENERGY),
  W: U('1', POWER), kW: U('1000', POWER), mW: U('0.001', POWER), hp: U('745.699871582', POWER),
  Hz: U('1', FREQ),
  K: U('1', K), degC: U('1', K), degF: U([5, 9], K, { inexact: true }),
};
export const sameDim = (a, b) => a.every((x, i) => x === b[i]);
/** True when a conversion through this unit is not exact in Calc (the size is a decimal or a fraction). */
export const inexact = (u) => UNITS[u].inexact === true || UNITS[u].d !== 1n;
