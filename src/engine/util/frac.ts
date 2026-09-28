import type { Frac } from "../recognize/types";

/** Ticks per quarter note used everywhere (divisible by 2^6·3·5, so tuplets up to septuplets of 16ths stay exact-ish). */
export const PPQ = 960;

const gcd = (a: number, b: number): number => (b === 0 ? Math.abs(a) : gcd(b, a % b));

export const frac = (n: number, d = 1): Frac => {
  const g = gcd(n, d) || 1;
  return { n: n / g, d: d / g };
};

export const add = (a: Frac, b: Frac) => frac(a.n * b.d + b.n * a.d, a.d * b.d);
export const mul = (a: Frac, b: Frac) => frac(a.n * b.n, a.d * b.d);

/** Exact tick count or null when the value cannot be represented at PPQ resolution. */
export function toTicks(f: Frac): number | null {
  const t = (f.n * PPQ) / f.d;
  return Number.isInteger(t) ? t : null;
}
