/**
 * Weighted-range vectors.
 *
 * A {@link WeightedRange} is a `Float32Array(1326)` of per-combo weights in
 * `[0, 1]`, indexed by the canonical combo order from `@poker/core`
 * (`comboIndex` / `comboFromIndex`). A weight is the fraction of that specific
 * two-card combo present in the range: `1` = always, `0` = never, `0.5` =
 * half the time (mixed strategy / partial information).
 *
 * `total(range)` is therefore the *effective combo count* (0..1326), the
 * standard "how many combos is that?" measure. {@link normalize} rescales a
 * range into a probability distribution (total = 1) for Bayesian use.
 *
 * ## Purity & allocation contract
 *
 * Every op is pure with respect to its inputs: inputs are never mutated
 * unless the caller explicitly passes them as `out`. Each op takes an
 * optional `out` buffer; omit it for a fresh allocation, pass a scratch
 * buffer (or the input itself) for zero-allocation hot paths. `out` may
 * alias an input — ops are written element-wise so aliasing is safe.
 */

import { type Card, COMBO_COUNT, HAND169_COUNT, ALL_COMBOS, hand169, isCard, DECK_SIZE } from "@poker/core";

/** Per-combo weights in [0, 1]; length 1326, canonical combo order. */
export type WeightedRange = Float32Array;

/** Number of entries in a WeightedRange (C(52,2) = 1326). */
export const RANGE_SIZE = COMBO_COUNT;

/** Number of entries in a 169-grid (canonical hand classes). */
export const GRID_SIZE = HAND169_COUNT;

// ---------------------------------------------------------------------------
// Combo ↔ 169-class tables (built once at module load).
// ---------------------------------------------------------------------------

/** 169-class index of each combo (Uint8 is enough: 0–168). */
export const CLASS_OF_COMBO: Uint8Array = (() => {
  const t = new Uint8Array(COMBO_COUNT);
  for (let i = 0; i < COMBO_COUNT; i++) {
    const combo = ALL_COMBOS[i] as readonly [Card, Card];
    t[i] = hand169(combo[0], combo[1]).index;
  }
  return t;
})();

/** Combo indices of each 169 class (6 for pairs, 4 suited, 12 offsuit). */
export const COMBOS_OF_CLASS: ReadonlyArray<Uint16Array> = (() => {
  const sizes = new Uint8Array(HAND169_COUNT);
  for (let i = 0; i < COMBO_COUNT; i++) {
    const c = CLASS_OF_COMBO[i] as number;
    sizes[c] = (sizes[c] as number) + 1;
  }
  const out: Uint16Array[] = [];
  for (let c = 0; c < HAND169_COUNT; c++) out.push(new Uint16Array(sizes[c] as number));
  const fill = new Uint8Array(HAND169_COUNT);
  for (let i = 0; i < COMBO_COUNT; i++) {
    const c = CLASS_OF_COMBO[i] as number;
    (out[c] as Uint16Array)[(fill[c] as number)++] = i;
  }
  return out;
})();

/** Combos-per-class lookup: 6 (pair), 4 (suited) or 12 (offsuit). */
export const CLASS_COMBO_COUNT: Uint8Array = (() => {
  const t = new Uint8Array(HAND169_COUNT);
  for (let c = 0; c < HAND169_COUNT; c++) t[c] = (COMBOS_OF_CLASS[c] as Uint16Array).length;
  return t;
})();

/** Combos that contain a given card, 51 per card. [card][k] → combo index. */
const COMBOS_WITH_CARD: ReadonlyArray<Uint16Array> = (() => {
  const out: Uint16Array[] = [];
  for (let c = 0; c < DECK_SIZE; c++) out.push(new Uint16Array(DECK_SIZE - 1));
  const fill = new Uint8Array(DECK_SIZE);
  for (let i = 0; i < COMBO_COUNT; i++) {
    const combo = ALL_COMBOS[i] as readonly [Card, Card];
    (out[combo[0]] as Uint16Array)[(fill[combo[0]] as number)++] = i;
    (out[combo[1]] as Uint16Array)[(fill[combo[1]] as number)++] = i;
  }
  return out;
})();

// ---------------------------------------------------------------------------
// Validation helpers (shared across the package).
// ---------------------------------------------------------------------------

/** @internal Throw unless `range` has the canonical 1326 length. */
export function assertRange(range: WeightedRange, name = "range"): void {
  if (range.length !== COMBO_COUNT) {
    throw new RangeError(`${name} must be a Float32Array(${COMBO_COUNT}), got length ${range.length}`);
  }
}

/** @internal Throw unless `x` is a finite number in [lo, hi]. */
export function assertInRange(x: number, lo: number, hi: number, name: string): void {
  if (!Number.isFinite(x) || x < lo || x > hi) {
    throw new RangeError(`${name} must be a finite number in [${lo}, ${hi}], got ${x}`);
  }
}

function resolveOut(out: WeightedRange | undefined): WeightedRange {
  if (out === undefined) return new Float32Array(COMBO_COUNT);
  assertRange(out, "out");
  return out;
}

// ---------------------------------------------------------------------------
// Constructors & basic ops.
// ---------------------------------------------------------------------------

/** A fresh empty range (all weights 0). */
export function createRange(): WeightedRange {
  return new Float32Array(COMBO_COUNT);
}

/** The full range: every combo at weight 1. */
export function fullRange(out?: WeightedRange): WeightedRange {
  const dst = resolveOut(out);
  dst.fill(1);
  return dst;
}

/** Independent copy of a range. */
export function clone(range: WeightedRange): WeightedRange {
  assertRange(range);
  return new Float32Array(range);
}

/** Sum of all weights — the effective combo count (0..1326). */
export function total(range: WeightedRange): number {
  assertRange(range);
  let sum = 0;
  for (let i = 0; i < COMBO_COUNT; i++) sum += range[i] as number;
  return sum;
}

/**
 * Rescale so weights sum to 1 (a probability distribution over combos).
 * An all-zero range cannot be normalized and is returned as-is (all zeros).
 */
export function normalize(range: WeightedRange, out?: WeightedRange): WeightedRange {
  assertRange(range);
  const sum = total(range);
  const dst = resolveOut(out);
  if (sum <= 0) {
    if (dst !== range) dst.fill(0);
    return dst;
  }
  const inv = 1 / sum;
  for (let i = 0; i < COMBO_COUNT; i++) dst[i] = (range[i] as number) * inv;
  return dst;
}

/**
 * Zero every combo that contains a dead card (board cards, hero's holding,
 * exposed cards). All other weights pass through untouched. O(dead × 51)
 * after the copy.
 */
export function maskBlocked(
  range: WeightedRange,
  deadCards: readonly Card[],
  out?: WeightedRange,
): WeightedRange {
  assertRange(range);
  for (const card of deadCards) {
    if (!isCard(card)) throw new RangeError(`invalid dead card: ${card}`);
  }
  const dst = resolveOut(out);
  if (dst !== range) dst.set(range);
  for (const card of deadCards) {
    const hits = COMBOS_WITH_CARD[card] as Uint16Array;
    for (let k = 0; k < hits.length; k++) dst[hits[k] as number] = 0;
  }
  return dst;
}

/**
 * Expand a 169-entry class grid (weights in [0, 1], canonical 169 order —
 * how preflop charts arrive) into a per-combo range: every combo of class
 * `c` gets weight `weights169[c]`. Throws on out-of-range or non-finite
 * grid values.
 */
export function fromGrid169(weights169: ArrayLike<number>, out?: WeightedRange): WeightedRange {
  if (weights169.length !== HAND169_COUNT) {
    throw new RangeError(`grid must have ${HAND169_COUNT} entries, got ${weights169.length}`);
  }
  const dst = resolveOut(out);
  for (let c = 0; c < HAND169_COUNT; c++) {
    const w = weights169[c] as number;
    assertInRange(w, 0, 1, `grid[${c}]`);
    const combos = COMBOS_OF_CLASS[c] as Uint16Array;
    for (let k = 0; k < combos.length; k++) dst[combos[k] as number] = w;
  }
  return dst;
}

/**
 * Aggregate a per-combo range down to the 169 grid: each class's entry is
 * the MEAN weight of its combos (so values stay in [0, 1] and
 * `fromGrid169(toGrid169(r))` conserves `total(r)` — class mean × class
 * combo count sums back to the class's mass).
 */
export function toGrid169(range: WeightedRange, out?: Float32Array): Float32Array {
  assertRange(range);
  let dst: Float32Array;
  if (out === undefined) dst = new Float32Array(HAND169_COUNT);
  else if (out.length !== HAND169_COUNT) {
    throw new RangeError(`out must be a Float32Array(${HAND169_COUNT}), got length ${out.length}`);
  } else dst = out;
  for (let c = 0; c < HAND169_COUNT; c++) {
    const combos = COMBOS_OF_CLASS[c] as Uint16Array;
    let sum = 0;
    for (let k = 0; k < combos.length; k++) sum += range[combos[k] as number] as number;
    dst[c] = sum / combos.length;
  }
  return dst;
}

/**
 * Pointwise blend: `out[i] = a[i] + w * (b[i] - a[i])`. `w = 0` yields `a`,
 * `w = 1` yields `b`. The lerp form guarantees the result never leaves
 * `[min(a,b), max(a,b)]`, so weights stay in [0, 1].
 */
export function combine(
  a: WeightedRange,
  b: WeightedRange,
  w: number,
  out?: WeightedRange,
): WeightedRange {
  assertRange(a, "a");
  assertRange(b, "b");
  assertInRange(w, 0, 1, "w");
  const dst = resolveOut(out);
  for (let i = 0; i < COMBO_COUNT; i++) {
    const av = a[i] as number;
    dst[i] = av + w * ((b[i] as number) - av);
  }
  return dst;
}
