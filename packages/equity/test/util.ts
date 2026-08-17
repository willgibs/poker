/**
 * Shared test helpers: card/range literals and safe indexing.
 */

import {
  COMBO_COUNT,
  HAND169_COUNT,
  type Card,
  cardFromString,
  comboIndex,
  combosOf169,
  label169,
} from "@poker/core";

/** "As", "Kh", ... -> cards. */
export function cardsOf(...names: string[]): Card[] {
  return names.map(cardFromString);
}

/** Two card strings -> a hero tuple. */
export function handOf(a: string, b: string): [Card, Card] {
  return [cardFromString(a), cardFromString(b)];
}

/** Weight-1 range of full 169-hand classes, e.g. rangeOfLabels("KK", "AKs"). */
export function rangeOfLabels(...labels: string[]): Float32Array {
  const range = new Float32Array(COMBO_COUNT);
  for (const label of labels) {
    let found = false;
    for (let i = 0; i < HAND169_COUNT; i++) {
      if (label169(i) === label) {
        for (const [a, b] of combosOf169(i)) range[comboIndex(a, b)] = 1;
        found = true;
        break;
      }
    }
    if (!found) throw new Error(`unknown 169 label: ${label}`);
  }
  return range;
}

/** Range of specific combos: [["Kc","Kd",1], ["As","Ks",0.5], ...]. */
export function rangeOfCombos(entries: ReadonlyArray<readonly [string, string, number?]>): Float32Array {
  const range = new Float32Array(COMBO_COUNT);
  for (const [a, b, w] of entries) {
    range[comboIndex(cardFromString(a), cardFromString(b))] = w ?? 1;
  }
  return range;
}

/** Index that throws instead of returning undefined (noUncheckedIndexedAccess). */
export function at<T>(arr: readonly T[], i: number): T {
  const v = arr[i];
  if (v === undefined) throw new Error(`index ${i} out of bounds (length ${arr.length})`);
  return v;
}
