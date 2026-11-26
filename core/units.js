// The units usimplify knows: each as a factor to its base units (metre, kilogram, second, kelvin) and the exponents of those bases.
// Observed in Emacs/Calc: usimplify sums commensurable terms in the first term's unit, merges like dimensions in a product, and turns a ratio of like units into a plain number.
const U = (n, d, dim) => ({ n, d, dim });
const L = [1, 0, 0, 0], M = [0, 1, 0, 0], T = [0, 0, 1, 0], K = [0, 0, 0, 1], V = [3, 0, 0, 0], A = [2, 0, 0, 0];
export const UNITS = {
  m: U(1, 1, L), km: U(1000, 1, L), cm: U(1, 100, L), mm: U(1, 1000, L), in: U(127, 5000, L), ft: U(381, 1250, L), mi: U(201168, 125, L),
  g: U(1, 1000, M), kg: U(1, 1, M), lb: U(45359237, 100000000, M), oz: U(28349523125, 1e12, M),
  s: U(1, 1, T), min: U(60, 1, T), hr: U(3600, 1, T), day: U(86400, 1, T),
  L: U(1, 1000, V), gal: U(3785411784, 1e12, V), acre: U(40468564224, 1e7, A), ha: U(10000, 1, A),
  mph: U(44704, 100000, [1, 0, -1, 0]), N: U(1, 1, [1, 1, -2, 0]), J: U(1, 1, [2, 1, -2, 0]), W: U(1, 1, [2, 1, -3, 0]), Hz: U(1, 1, [0, 0, -1, 0]), K: U(1, 1, K),
};
export const sameDim = (a, b) => a.every((x, i) => x === b[i]);
