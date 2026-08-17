/**
 * Naive-but-correct 7-card evaluator, used as the injected `evaluate7` in
 * this package's tests (the real `@poker/eval` is built concurrently and
 * must not be imported here).
 *
 * Best-of-21: scores every 5-card subset with straightforward category
 * logic and keeps the strongest. **Order-faithful only**: lower = stronger
 * and equal hands get equal values, but the numbers are NOT the canonical
 * 1..7462 class ids. That matches the package's documented contract, which
 * relies on order and equality alone. Slow is fine offline.
 */

import { isCard } from "@poker/core";

/** All C(7,5)=21 index patterns (kept in a frozen module constant). */
const PATTERNS: readonly (readonly number[])[] = (() => {
  const out: number[][] = [];
  for (let i = 0; i < 7; i++) {
    for (let j = i + 1; j < 7; j++) {
      const pattern: number[] = [];
      for (let k = 0; k < 7; k++) {
        if (k !== i && k !== j) pattern.push(k);
      }
      out.push(pattern);
    }
  }
  return out;
})();

/** Rank bitmasks of the ten straight windows (wheel A-5 first). */
const WINDOWS: readonly number[] = (() => {
  const w: number[] = [0b1_0000_0000_1111]; // A,2,3,4,5
  for (let hi = 4; hi <= 12; hi++) w.push(0b11111 << (hi - 4));
  return w;
})();

/** Wheel window straight-high rank (the five). */
const WHEEL_HIGH = 3;

const counts = new Int32Array(13);

/** Score a 5-card hand; HIGHER = stronger (internal scale). */
function score5(c0: number, c1: number, c2: number, c3: number, c4: number): number {
  counts.fill(0);
  const r0 = c0 >> 2;
  const r1 = c1 >> 2;
  const r2 = c2 >> 2;
  const r3 = c3 >> 2;
  const r4 = c4 >> 2;
  counts[r0] = (counts[r0] ?? 0) + 1;
  counts[r1] = (counts[r1] ?? 0) + 1;
  counts[r2] = (counts[r2] ?? 0) + 1;
  counts[r3] = (counts[r3] ?? 0) + 1;
  counts[r4] = (counts[r4] ?? 0) + 1;
  const flush =
    (c0 & 3) === (c1 & 3) &&
    (c0 & 3) === (c2 & 3) &&
    (c0 & 3) === (c3 & 3) &&
    (c0 & 3) === (c4 & 3);
  const mask = (1 << r0) | (1 << r1) | (1 << r2) | (1 << r3) | (1 << r4);

  let straightHigh = -1;
  for (let hi = 12; hi >= 4; hi--) {
    const w = 0b11111 << (hi - 4);
    if ((mask & w) === w) {
      straightHigh = hi;
      break;
    }
  }
  if (straightHigh < 0 && (mask & (WINDOWS[0] ?? 0)) === (WINDOWS[0] ?? 0)) {
    straightHigh = WHEEL_HIGH;
  }

  let quad = -1;
  let trip = -1;
  let hiPair = -1;
  let loPair = -1;
  const singles: number[] = []; // descending
  for (let r = 12; r >= 0; r--) {
    const n = counts[r] ?? 0;
    if (n === 4) quad = r;
    else if (n === 3) trip = r;
    else if (n === 2) {
      if (hiPair < 0) hiPair = r;
      else loPair = r;
    } else if (n === 1) singles.push(r);
  }

  let cat: number;
  let d1 = 0;
  let d2 = 0;
  let d3 = 0;
  let d4 = 0;
  let d5 = 0;
  if (straightHigh >= 0 && flush) {
    cat = 8;
    d1 = straightHigh;
  } else if (quad >= 0) {
    cat = 7;
    d1 = quad;
    d2 = singles[0] ?? 0;
  } else if (trip >= 0 && hiPair >= 0) {
    cat = 6;
    d1 = trip;
    d2 = hiPair;
  } else if (flush) {
    cat = 5;
    d1 = singles[0] ?? 0;
    d2 = singles[1] ?? 0;
    d3 = singles[2] ?? 0;
    d4 = singles[3] ?? 0;
    d5 = singles[4] ?? 0;
  } else if (straightHigh >= 0) {
    cat = 4;
    d1 = straightHigh;
  } else if (trip >= 0) {
    cat = 3;
    d1 = trip;
    d2 = singles[0] ?? 0;
    d3 = singles[1] ?? 0;
  } else if (loPair >= 0) {
    cat = 2;
    d1 = hiPair;
    d2 = loPair;
    d3 = singles[0] ?? 0;
  } else if (hiPair >= 0) {
    cat = 1;
    d1 = hiPair;
    d2 = singles[0] ?? 0;
    d3 = singles[1] ?? 0;
    d4 = singles[2] ?? 0;
  } else {
    cat = 0;
    d1 = singles[0] ?? 0;
    d2 = singles[1] ?? 0;
    d3 = singles[2] ?? 0;
    d4 = singles[3] ?? 0;
    d5 = singles[4] ?? 0;
  }
  return ((((cat * 13 + d1) * 13 + d2) * 13 + d3) * 13 + d4) * 13 + d5;
}

/** Any internal score is < MAXV, so MAXV - score is always positive. */
const MAXV = 9 * 13 ** 5;

/**
 * Naive 7-card evaluator satisfying the package's `Evaluate7` contract:
 * lower = stronger, equal hands equal. Validates its input (7 distinct
 * cards) to catch harness bugs early.
 */
export function naiveEvaluate7(cards: readonly number[]): number {
  if (cards.length !== 7) {
    throw new RangeError(`naiveEvaluate7 expects 7 cards, got ${cards.length}`);
  }
  for (let i = 0; i < 7; i++) {
    const c = cards[i] ?? -1;
    if (!isCard(c)) throw new RangeError(`naiveEvaluate7: invalid card ${c}`);
    for (let j = i + 1; j < 7; j++) {
      if (c === cards[j]) throw new RangeError(`naiveEvaluate7: duplicate card ${c}`);
    }
  }
  let best = -1;
  for (const p of PATTERNS) {
    const v = score5(
      cards[p[0] ?? 0] ?? 0,
      cards[p[1] ?? 0] ?? 0,
      cards[p[2] ?? 0] ?? 0,
      cards[p[3] ?? 0] ?? 0,
      cards[p[4] ?? 0] ?? 0,
    );
    if (v > best) best = v;
  }
  return MAXV - best;
}
