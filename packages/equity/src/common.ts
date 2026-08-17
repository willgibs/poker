/**
 * Shared contracts and input validation for the equity package.
 *
 * Hand evaluation is injected ({@link Evaluate7}); this package never imports
 * an evaluator. Villain ranges are `Float32Array(1326)` weight vectors in the
 * canonical combo order defined by `@poker/core` (`comboIndex`).
 */

import { type Card, COMBO_COUNT, DECK_SIZE, comboFromIndex, isCard } from "@poker/core";

/**
 * Injected 7-card hand evaluator.
 *
 * Takes exactly seven distinct cards (ints 0-51) and returns a rank where
 * **lower = stronger** (7462-equivalence-class style). Equal-strength hands
 * must return equal values. The contract this package relies on is *order
 * only*: results are compared with `<` / `===`, never interpreted as class
 * numbers.
 *
 * Callers in this package reuse a scratch array between calls, so the
 * evaluator must read the array synchronously and must not mutate or retain
 * it.
 */
export type Evaluate7 = (cards: number[]) => number;

/**
 * Result of an equity computation. All fields are in [0, 1].
 *
 * - `win`: probability (weighted fraction of enumerated/sampled showdowns)
 *   that hero wins outright.
 * - `tie`: probability that hero ties for the best hand.
 * - `equity`: hero's expected pot share. Heads-up this is `win + tie / 2`;
 *   in multiway results ties are split exactly (`1 / (1 + tiedVillains)`).
 */
export interface EquityResult {
  win: number;
  tie: number;
  equity: number;
}

/** Throws unless `x` is a finite number in [0, 1]. */
export function assertFraction(x: number, what: string): void {
  if (!Number.isFinite(x) || x < 0 || x > 1) {
    throw new RangeError(`invalid ${what}: ${x} (expected a fraction in [0, 1])`);
  }
}

/** Throws unless `trials` is a positive safe integer (fixed trial counts only). */
export function assertTrials(trials: number): void {
  if (!Number.isSafeInteger(trials) || trials < 1) {
    throw new RangeError(`invalid trials: ${trials} (expected a positive integer)`);
  }
}

/**
 * Validates hero + board cards (each a valid card, all distinct) and returns
 * a 52-entry dead-card flag table (1 = dead).
 */
export function deadFlagsFor(hero: readonly [Card, Card], board: readonly Card[]): Uint8Array {
  const dead = new Uint8Array(DECK_SIZE);
  const all = [hero[0], hero[1], ...board];
  for (const c of all) {
    if (!isCard(c)) {
      throw new RangeError(`invalid card: ${c} (expected integer 0-${DECK_SIZE - 1})`);
    }
    if (dead[c] === 1) {
      throw new RangeError(`duplicate card among hero/board: ${c}`);
    }
    dead[c] = 1;
  }
  return dead;
}

/** All cards not flagged dead, ascending (ascending card int = rank-major order). */
export function liveCardsFrom(dead: Uint8Array): Card[] {
  const live: Card[] = [];
  for (let c = 0; c < DECK_SIZE; c++) {
    if (dead[c] !== 1) live.push(c);
  }
  return live;
}

/** Unblocked positive-weight combos of a range, in canonical combo order. */
export interface ActiveCombos {
  /** First (lower) card of combo k. */
  a: number[];
  /** Second (higher) card of combo k. */
  b: number[];
  /** Weight of combo k (> 0). */
  w: number[];
  count: number;
}

/**
 * Validates a range vector and extracts its unblocked, positive-weight combos.
 * Combos containing a dead card (hero/board) are skipped — a villain cannot
 * hold visible cards, so blocked combos contribute zero. Negative, NaN, or
 * non-finite weights throw.
 */
export function activeCombosOf(range: Float32Array, dead: Uint8Array): ActiveCombos {
  if (!(range instanceof Float32Array) || range.length !== COMBO_COUNT) {
    throw new RangeError(
      `invalid range: expected Float32Array(${COMBO_COUNT}), got length ${range?.length}`,
    );
  }
  const a: number[] = [];
  const b: number[] = [];
  const w: number[] = [];
  for (let i = 0; i < COMBO_COUNT; i++) {
    const weight = range[i] ?? 0;
    if (Number.isNaN(weight) || !Number.isFinite(weight) || weight < 0) {
      throw new RangeError(`invalid range weight at combo ${i}: ${weight}`);
    }
    if (weight === 0) continue;
    const [ca, cb] = comboFromIndex(i);
    if (dead[ca] === 1 || dead[cb] === 1) continue; // blocked
    a.push(ca);
    b.push(cb);
    w.push(weight);
  }
  return { a, b, w, count: a.length };
}

/** A range prepared for weighted sampling via cumulative-sum binary search. */
export interface SamplableRange {
  a: number[];
  b: number[];
  /** cum[k] = w[0] + … + w[k]; cum[count-1] === total. */
  cum: Float64Array;
  total: number;
  count: number;
}

/**
 * Builds cumulative weights over the unblocked combos of `range`.
 * Returns null when no unblocked combo has positive weight.
 */
export function samplableRangeOf(range: Float32Array, dead: Uint8Array): SamplableRange | null {
  const { a, b, w, count } = activeCombosOf(range, dead);
  if (count === 0) return null;
  const cum = new Float64Array(count);
  let total = 0;
  for (let k = 0; k < count; k++) {
    total += w[k] ?? 0;
    cum[k] = total;
  }
  if (total <= 0) return null;
  return { a, b, cum, total, count };
}

/**
 * Smallest index k with cum[k] > u (u in [0, total)). Standard inverse-CDF
 * sampling: combo k is chosen with probability w[k] / total.
 */
export function sampleIndex(cum: Float64Array, u: number): number {
  let lo = 0;
  let hi = cum.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((cum[mid] ?? 0) > u) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}
