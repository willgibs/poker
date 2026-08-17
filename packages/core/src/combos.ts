/**
 * Hole-card combos.
 *
 * -- 1326 two-card combos ------------------------------------------------------
 * Canonical combo order (a PUBLIC CONTRACT — do not change): all unordered
 * pairs (a, b) with a < b, ordered lexicographically by (a, b):
 *   index 0 = (0, 1), index 1 = (0, 2), … index 50 = (0, 51),
 *   index 51 = (1, 2), … index 1325 = (50, 51).
 *
 * -- 169 canonical hands -------------------------------------------------------
 * Canonical 169 order (a PUBLIC CONTRACT — do not change):
 *   indices   0–12:  pairs, AA=0, KK=1, … 22=12 (high rank descending);
 *   indices  13–90:  suited non-pairs, ordered by high rank descending then
 *                    low rank descending: AKs=13, AQs=14, … A2s=24,
 *                    KQs=25, … 32s=90;
 *   indices 91–168:  offsuit non-pairs in the same rank order:
 *                    AKo=91, … 32o=168.
 * Labels: rank chars high-first from "23456789TJQKA", pairs "AA"…"22",
 * suited suffixed "s", offsuit suffixed "o" (e.g. "AKs", "T9o", "77").
 */

import {
  type Card,
  DECK_SIZE,
  RANK_CHARS,
  RANK_COUNT,
  SUIT_COUNT,
  isCard,
  makeCard,
  rankOf,
  suitOf,
} from "./cards";

export const COMBO_COUNT = 1326; // C(52, 2)
export const HAND169_COUNT = 169;

const NON_PAIR_KINDS = 78; // C(13, 2)
const PAIR_KINDS = 13;
const SUITED_BASE = PAIR_KINDS; // 13
const OFFSUIT_BASE = PAIR_KINDS + NON_PAIR_KINDS; // 91

function assertDistinctCards(a: number, b: number): void {
  if (!isCard(a) || !isCard(b)) {
    throw new RangeError(`invalid combo cards: (${a}, ${b})`);
  }
  if (a === b) {
    throw new RangeError(`combo cards must be distinct: (${a}, ${b})`);
  }
}

/**
 * Canonical index (0–1325) of the combo holding cards `a` and `b`.
 * Order-insensitive: comboIndex(a, b) === comboIndex(b, a). Throws on
 * invalid or equal cards.
 */
export function comboIndex(a: Card, b: Card): number {
  assertDistinctCards(a, b);
  const lo = a < b ? a : b;
  const hi = a < b ? b : a;
  // combos with first card < lo: sum_{k=0}^{lo-1} (51 - k)
  return lo * (DECK_SIZE - 1) - (lo * (lo - 1)) / 2 + (hi - lo - 1);
}

/** Inverse of comboIndex: canonical combo `i` as [a, b] with a < b. Throws on invalid index. */
export function comboFromIndex(i: number): readonly [Card, Card] {
  if (!Number.isInteger(i) || i < 0 || i >= COMBO_COUNT) {
    throw new RangeError(`invalid combo index: ${i} (expected integer 0-${COMBO_COUNT - 1})`);
  }
  let rest = i;
  let lo = 0;
  for (;;) {
    const rowSize = DECK_SIZE - 1 - lo;
    if (rest < rowSize) return [lo, lo + 1 + rest];
    rest -= rowSize;
    lo++;
  }
}

function buildAllCombos(): ReadonlyArray<readonly [Card, Card]> {
  const combos: Array<readonly [Card, Card]> = [];
  for (let a = 0; a < DECK_SIZE; a++) {
    for (let b = a + 1; b < DECK_SIZE; b++) combos.push([a, b]);
  }
  return combos;
}

/** All 1326 combos in canonical order; ALL_COMBOS[i] === comboFromIndex(i). */
export const ALL_COMBOS: ReadonlyArray<readonly [Card, Card]> = buildAllCombos();

export interface Hand169 {
  /** Canonical 169 index, 0–168 (see ordering contract above). */
  index: number;
  /** Label such as "AA", "AKs", "T9o". */
  label: string;
}

/** Row offset of high-rank `hi` within a 78-entry non-pair block. */
function nonPairOffset(hi: number, lo: number): number {
  const row = RANK_COUNT - 1 - hi; // 0 for A-high, 11 for 3-high
  // rows above: sum_{k=0}^{row-1} (12 - k)
  const rowStart = (RANK_COUNT - 1) * row - (row * (row - 1)) / 2;
  return rowStart + (hi - 1 - lo);
}

/** Canonical 169 index and label for a two-card combo. Throws on invalid or equal cards. */
export function hand169(a: Card, b: Card): Hand169 {
  assertDistinctCards(a, b);
  const ra = rankOf(a);
  const rb = rankOf(b);
  if (ra === rb) {
    const ch = RANK_CHARS.charAt(ra);
    return { index: RANK_COUNT - 1 - ra, label: ch + ch };
  }
  const hi = ra > rb ? ra : rb;
  const lo = ra > rb ? rb : ra;
  const suited = suitOf(a) === suitOf(b);
  const index = (suited ? SUITED_BASE : OFFSUIT_BASE) + nonPairOffset(hi, lo);
  const label = RANK_CHARS.charAt(hi) + RANK_CHARS.charAt(lo) + (suited ? "s" : "o");
  return { index, label };
}

type Hand169Shape =
  | { kind: "pair"; rank: number }
  | { kind: "suited" | "offsuit"; hi: number; lo: number };

function decode169(index: number): Hand169Shape {
  if (!Number.isInteger(index) || index < 0 || index >= HAND169_COUNT) {
    throw new RangeError(`invalid 169 index: ${index} (expected integer 0-${HAND169_COUNT - 1})`);
  }
  if (index < SUITED_BASE) return { kind: "pair", rank: RANK_COUNT - 1 - index };
  const kind = index < OFFSUIT_BASE ? "suited" : "offsuit";
  let rest = index - (kind === "suited" ? SUITED_BASE : OFFSUIT_BASE);
  let row = 0;
  for (;;) {
    const rowSize = RANK_COUNT - 1 - row;
    if (rest < rowSize) {
      const hi = RANK_COUNT - 1 - row;
      return { kind, hi, lo: hi - 1 - rest };
    }
    rest -= rowSize;
    row++;
  }
}

/** Label for a canonical 169 index, e.g. label169(0) === "AA", label169(13) === "AKs". */
export function label169(index: number): string {
  const shape = decode169(index);
  if (shape.kind === "pair") {
    const ch = RANK_CHARS.charAt(shape.rank);
    return ch + ch;
  }
  return (
    RANK_CHARS.charAt(shape.hi) +
    RANK_CHARS.charAt(shape.lo) +
    (shape.kind === "suited" ? "s" : "o")
  );
}

/**
 * All specific combos of a canonical 169 hand: 6 for pairs, 4 suited,
 * 12 offsuit. Each combo is [a, b] with a < b (canonical combo form).
 */
export function combosOf169(index: number): Array<readonly [Card, Card]> {
  const shape = decode169(index);
  const out: Array<readonly [Card, Card]> = [];
  if (shape.kind === "pair") {
    for (let s1 = 0; s1 < SUIT_COUNT; s1++) {
      for (let s2 = s1 + 1; s2 < SUIT_COUNT; s2++) {
        out.push([makeCard(shape.rank, s1), makeCard(shape.rank, s2)]);
      }
    }
    return out;
  }
  if (shape.kind === "suited") {
    for (let s = 0; s < SUIT_COUNT; s++) {
      out.push([makeCard(shape.lo, s), makeCard(shape.hi, s)]);
    }
    return out;
  }
  for (let sHi = 0; sHi < SUIT_COUNT; sHi++) {
    for (let sLo = 0; sLo < SUIT_COUNT; sLo++) {
      if (sHi === sLo) continue;
      out.push([makeCard(shape.lo, sLo), makeCard(shape.hi, sHi)]);
    }
  }
  return out;
}
