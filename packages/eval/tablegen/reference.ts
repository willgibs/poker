/**
 * Reference 5-card evaluator, built from first principles.
 *
 * This is the slow, obviously-correct oracle used by tablegen and by the test
 * suite. It maps any 5-card hand to a comparable integer "value" where HIGHER
 * value = STRONGER hand, then `buildClassMap` enumerates all C(52,5) hands and
 * densely ranks the distinct values into the standard 7462 equivalence
 * classes (class 1 = royal flush ... class 7462 = 7-5-4-3-2 offsuit).
 *
 * Card ints follow the repo convention: card = rank*4 + suit,
 * rank 0=2 ... 12=A, suit 0=c 1=d 2=h 3=s.
 */

export const CAT_HIGH = 0;
export const CAT_PAIR = 1;
export const CAT_TWO_PAIR = 2;
export const CAT_TRIPS = 3;
export const CAT_STRAIGHT = 4;
export const CAT_FLUSH = 5;
export const CAT_FULL_HOUSE = 6;
export const CAT_QUADS = 7;
export const CAT_STRAIGHT_FLUSH = 8;

/** Published 5-card hand counts per category over all C(52,5) = 2,598,960. */
export const HAND_COUNTS_5 = [
  1302540, // high card
  1098240, // pair
  123552, // two pair
  54912, // trips
  10200, // straight
  5108, // flush
  3744, // full house
  624, // quads
  40, // straight flush
] as const;

/** Distinct equivalence classes per category (sums to 7462). */
export const CLASS_COUNTS_5 = [1277, 2860, 858, 858, 10, 1277, 156, 156, 10] as const;

/**
 * Value of a 5-card hand given its 5 ranks (duplicates allowed) and whether
 * the hand is a flush. Higher = stronger. Encoding: category in bits 20+,
 * then up to five 4-bit tiebreak ranks, most significant first.
 */
export function rankValue5(ranks: readonly number[], flush: boolean): number {
  if (ranks.length !== 5) throw new Error("rankValue5 requires exactly 5 ranks");
  const cnt = new Uint8Array(13);
  for (const r of ranks) {
    if (r < 0 || r > 12) throw new Error(`bad rank ${r}`);
    cnt[r] = cnt[r]! + 1;
  }
  const quads: number[] = [];
  const trips: number[] = [];
  const pairs: number[] = [];
  const singles: number[] = [];
  for (let r = 12; r >= 0; r--) {
    const c = cnt[r]!;
    if (c === 1) singles.push(r);
    else if (c === 2) pairs.push(r);
    else if (c === 3) trips.push(r);
    else if (c === 4) quads.push(r);
  }
  const distinct = quads.length + trips.length + pairs.length + singles.length;

  let straightHigh = -1;
  if (distinct === 5) {
    const hi = singles[0]!;
    const lo = singles[4]!;
    if (hi - lo === 4) straightHigh = hi;
    else if (hi === 12 && singles[1] === 3) straightHigh = 3; // A-5 wheel
  }

  let cat: number;
  let tb: readonly number[];
  if (flush && straightHigh >= 0) {
    cat = CAT_STRAIGHT_FLUSH;
    tb = [straightHigh];
  } else if (quads.length === 1) {
    cat = CAT_QUADS;
    tb = [quads[0]!, singles[0]!];
  } else if (trips.length === 1 && pairs.length === 1) {
    cat = CAT_FULL_HOUSE;
    tb = [trips[0]!, pairs[0]!];
  } else if (flush) {
    cat = CAT_FLUSH;
    tb = singles;
  } else if (straightHigh >= 0) {
    cat = CAT_STRAIGHT;
    tb = [straightHigh];
  } else if (trips.length === 1) {
    cat = CAT_TRIPS;
    tb = [trips[0]!, singles[0]!, singles[1]!];
  } else if (pairs.length === 2) {
    cat = CAT_TWO_PAIR;
    tb = [pairs[0]!, pairs[1]!, singles[0]!];
  } else if (pairs.length === 1) {
    cat = CAT_PAIR;
    tb = [pairs[0]!, singles[0]!, singles[1]!, singles[2]!];
  } else {
    cat = CAT_HIGH;
    tb = singles;
  }

  let v = cat << 20;
  for (let i = 0; i < 5; i++) v |= (tb[i] ?? 0) << ((4 - i) * 4);
  return v;
}

/** Value of a 5-card hand given card ints. Higher = stronger. */
export function evaluate5Value(c0: number, c1: number, c2: number, c3: number, c4: number): number {
  const s = c0 & 3;
  const flush = (c1 & 3) === s && (c2 & 3) === s && (c3 & 3) === s && (c4 & 3) === s;
  return rankValue5([c0 >> 2, c1 >> 2, c2 >> 2, c3 >> 2, c4 >> 2], flush);
}

export interface ClassMap {
  /** 5-card value -> equivalence class 1..7462 (lower = stronger). */
  classOf: Map<number, number>;
  /** class id (1-based) -> category 0..8. Index 0 unused. */
  classCat: Uint8Array;
  /** 5-card hand counts per category over all C(52,5). */
  handCounts5: number[];
  /** Total distinct classes (must be 7462). */
  classCount: number;
}

/**
 * Enumerate all C(52,5) = 2,598,960 five-card hands, rank the distinct hand
 * values, and assign dense class ids 1..7462 (1 = strongest).
 */
export function buildClassMap(): ClassMap {
  const valueSet = new Set<number>();
  const handCounts5 = new Array<number>(9).fill(0);
  for (let a = 0; a < 48; a++) {
    for (let b = a + 1; b < 49; b++) {
      for (let c = b + 1; c < 50; c++) {
        for (let d = c + 1; d < 51; d++) {
          for (let e = d + 1; e < 52; e++) {
            const v = evaluate5Value(a, b, c, d, e);
            valueSet.add(v);
            handCounts5[v >>> 20] = handCounts5[v >>> 20]! + 1;
          }
        }
      }
    }
  }
  const values = [...valueSet].sort((x, y) => y - x); // strongest first
  const classOf = new Map<number, number>();
  const classCat = new Uint8Array(values.length + 1);
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    classOf.set(v, i + 1);
    classCat[i + 1] = v >>> 20;
  }
  return { classOf, classCat, handCounts5, classCount: values.length };
}

/**
 * Best 5-card class of a 7-card hand by brute force over all 21 subsets.
 * Slow oracle for cross-checking evaluate7.
 */
export function best7Ref(cards: readonly number[], classOf: Map<number, number>): number {
  if (cards.length !== 7) throw new Error("best7Ref requires exactly 7 cards");
  let best = 0x7fff;
  const sub = new Array<number>(5);
  for (let i = 0; i < 6; i++) {
    for (let j = i + 1; j < 7; j++) {
      let k = 0;
      for (let t = 0; t < 7; t++) {
        if (t !== i && t !== j) sub[k++] = cards[t]!;
      }
      const v = evaluate5Value(sub[0]!, sub[1]!, sub[2]!, sub[3]!, sub[4]!);
      const cls = classOf.get(v);
      if (cls === undefined) throw new Error("value missing from class map");
      if (cls < best) best = cls;
    }
  }
  return best;
}
