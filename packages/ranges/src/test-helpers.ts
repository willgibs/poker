/**
 * Test-only helpers (not exported from the package index).
 *
 * Deterministic pseudo-random fills for property tests: fast-check supplies
 * a seed integer, an LCG expands it into 1326 weights. This keeps property
 * inputs deterministic and cheap without generating 1326-element fast-check
 * arrays per run (and without Math.random, which is lint-banned).
 */

import { type WeightedRange, RANGE_SIZE, createRange } from "./range";

/** Tiny deterministic LCG over [0, 1). */
export function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}

/** Deterministic range with weights uniform in [0, 1). */
export function pseudoRange(seed: number): WeightedRange {
  const next = lcg(seed);
  const r = createRange();
  for (let i = 0; i < RANGE_SIZE; i++) r[i] = next();
  return r;
}

/** Assert every weight is a finite number in [0, 1]. */
export function expectUnitInterval(range: ArrayLike<number>): void {
  for (let i = 0; i < range.length; i++) {
    const w = range[i] as number;
    if (!(Number.isFinite(w) && w >= 0 && w <= 1)) {
      throw new Error(`weight out of [0, 1] at ${i}: ${w}`);
    }
  }
}
