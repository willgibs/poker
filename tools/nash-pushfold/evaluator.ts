/**
 * Naive-but-correct 7-card evaluator for the nash-pushfold tool.
 *
 * TOOL CODE ONLY — never imported by package sources. Two independent
 * implementations live here:
 *
 * 1. `score7` — a direct count-based 7-card scorer used by the generator
 *    (fast enough for hundreds of millions of boards offline).
 * 2. `best21Naive` — a textbook best-of-21 five-card category scorer used
 *    exclusively to cross-check `score7` before any generation run.
 *
 * Both return numbers where LOWER = STRONGER (matching the repo-wide
 * `evaluate7` convention). The scores are order-correct, not the literal
 * 7462-class values; only comparisons are ever used here.
 */

/** Bit mask of ranks A,5,4,3,2 (the wheel). */
const WHEEL_MASK = 0x100f;

// Module-level scratch (single-threaded tool code).
const rankCount = new Int32Array(13);
const suitCount = new Int32Array(4);
const suitMask = new Int32Array(4);

/** Highest straight top-rank in a 13-bit rank mask, or -1 (wheel top = rank 3, the five). */
function straightHighFromMask(m: number): number {
  let run = 0;
  for (let r = 12; r >= 0; r--) {
    if ((m & (1 << r)) !== 0) {
      run++;
      if (run === 5) return r + 4;
    } else {
      run = 0;
    }
  }
  if ((m & WHEEL_MASK) === WHEEL_MASK) return 3;
  return -1;
}

const STRENGTH_MAX = 9 << 20;

/** Tally one card (int 0-51) into the module-level scratch counters. */
function tally(c: number): void {
  const r = c >> 2;
  const s = c & 3;
  rankCount[r] = (rankCount[r] as number) + 1;
  suitCount[s] = (suitCount[s] as number) + 1;
  suitMask[s] = (suitMask[s] as number) | (1 << r);
}

/**
 * Score a 7-card hand; LOWER = STRONGER. Cards are ints 0-51 (rank*4+suit).
 * Internally computes a strength value (category nibble + five tiebreak
 * nibbles, higher = stronger) and inverts it.
 */
export function score7(
  c0: number,
  c1: number,
  c2: number,
  c3: number,
  c4: number,
  c5: number,
  c6: number,
): number {
  rankCount.fill(0);
  suitCount.fill(0);
  suitMask.fill(0);

  tally(c0);
  tally(c1);
  tally(c2);
  tally(c3);
  tally(c4);
  tally(c5);
  tally(c6);

  // Flush / straight flush. With 7 cards a flush excludes quads and full
  // houses (at most 2 of the 5 paired-rank cards can share a suit), so
  // returning here is safe.
  let flushSuit = -1;
  if ((suitCount[0] as number) >= 5) flushSuit = 0;
  else if ((suitCount[1] as number) >= 5) flushSuit = 1;
  else if ((suitCount[2] as number) >= 5) flushSuit = 2;
  else if ((suitCount[3] as number) >= 5) flushSuit = 3;
  if (flushSuit >= 0) {
    const fm = suitMask[flushSuit] as number;
    const sfHigh = straightHighFromMask(fm);
    if (sfHigh >= 0) return STRENGTH_MAX - ((8 << 20) | (sfHigh << 16));
    let tb = 0;
    let taken = 0;
    for (let rr = 12; rr >= 0 && taken < 5; rr--) {
      if ((fm & (1 << rr)) !== 0) {
        tb = (tb << 4) | rr;
        taken++;
      }
    }
    return STRENGTH_MAX - ((5 << 20) | tb);
  }

  const rankMask =
    ((suitMask[0] as number) |
      (suitMask[1] as number) |
      (suitMask[2] as number) |
      (suitMask[3] as number)) >>>
    0;

  // Group ranks by multiplicity, high to low.
  let quad = -1;
  let t1 = -1;
  let t2 = -1;
  let p1 = -1;
  let p2 = -1;
  for (let rr = 12; rr >= 0; rr--) {
    const n = rankCount[rr] as number;
    if (n === 4) quad = rr;
    else if (n === 3) {
      if (t1 < 0) t1 = rr;
      else if (t2 < 0) t2 = rr;
    } else if (n === 2) {
      if (p1 < 0) p1 = rr;
      else if (p2 < 0) p2 = rr;
    }
  }

  if (quad >= 0) {
    let k = -1;
    for (let rr = 12; rr >= 0; rr--) {
      if (rr !== quad && (rankCount[rr] as number) > 0) {
        k = rr;
        break;
      }
    }
    return STRENGTH_MAX - ((7 << 20) | (quad << 16) | (k << 12));
  }

  if (t1 >= 0 && (t2 >= 0 || p1 >= 0)) {
    const pairRank = t2 > p1 ? t2 : p1;
    return STRENGTH_MAX - ((6 << 20) | (t1 << 16) | (pairRank << 12));
  }

  const sHigh = straightHighFromMask(rankMask);
  if (sHigh >= 0) return STRENGTH_MAX - ((4 << 20) | (sHigh << 16));

  if (t1 >= 0) {
    let k1 = -1;
    let k2 = -1;
    for (let rr = 12; rr >= 0; rr--) {
      if (rr !== t1 && (rankCount[rr] as number) > 0) {
        if (k1 < 0) k1 = rr;
        else {
          k2 = rr;
          break;
        }
      }
    }
    return STRENGTH_MAX - ((3 << 20) | (t1 << 16) | (k1 << 12) | (k2 << 8));
  }

  if (p1 >= 0 && p2 >= 0) {
    let k = -1;
    for (let rr = 12; rr >= 0; rr--) {
      if (rr !== p1 && rr !== p2 && (rankCount[rr] as number) > 0) {
        k = rr;
        break;
      }
    }
    return STRENGTH_MAX - ((2 << 20) | (p1 << 16) | (p2 << 12) | (k << 8));
  }

  if (p1 >= 0) {
    let k1 = -1;
    let k2 = -1;
    let k3 = -1;
    for (let rr = 12; rr >= 0; rr--) {
      if (rr !== p1 && (rankCount[rr] as number) > 0) {
        if (k1 < 0) k1 = rr;
        else if (k2 < 0) k2 = rr;
        else {
          k3 = rr;
          break;
        }
      }
    }
    return STRENGTH_MAX - ((1 << 20) | (p1 << 16) | (k1 << 12) | (k2 << 8) | (k3 << 4));
  }

  // High card: top five ranks.
  let tb = 0;
  let taken = 0;
  for (let rr = 12; rr >= 0 && taken < 5; rr--) {
    if ((rankMask & (1 << rr)) !== 0) {
      tb = (tb << 4) | rr;
      taken++;
    }
  }
  return STRENGTH_MAX - tb;
}

// ---------------------------------------------------------------------------
// Independent naive cross-check implementation (best-of-21 five-card).
// ---------------------------------------------------------------------------

/** Score five cards; LOWER = STRONGER. Written independently of score7. */
export function score5Naive(cards: readonly number[]): number {
  const ranks = cards.map((c) => Math.floor(c / 4)).sort((a, b) => b - a);
  const suits = cards.map((c) => c % 4);
  const isFlush = suits.every((x) => x === suits[0]);

  const counts = new Map<number, number>();
  for (const rk of ranks) counts.set(rk, (counts.get(rk) ?? 0) + 1);
  // Groups sorted by count desc, then rank desc.
  const groups = [...counts.entries()].sort((a, b) => (b[1] - a[1] !== 0 ? b[1] - a[1] : b[0] - a[0]));

  const uniq = [...counts.keys()].sort((a, b) => b - a);
  let straightHigh = -1;
  if (uniq.length === 5) {
    if ((uniq[0] as number) - (uniq[4] as number) === 4) straightHigh = uniq[0] as number;
    else if (
      uniq[0] === 12 &&
      uniq[1] === 3 &&
      uniq[2] === 2 &&
      uniq[3] === 1 &&
      uniq[4] === 0
    )
      straightHigh = 3; // wheel: five-high
  }

  let category: number;
  let tie: number[];
  const shape = groups.map((g) => g[1]).join("");
  if (straightHigh >= 0 && isFlush) {
    category = 8;
    tie = [straightHigh];
  } else if (shape === "41") {
    category = 7;
    tie = [groups[0]![0], groups[1]![0]];
  } else if (shape === "32") {
    category = 6;
    tie = [groups[0]![0], groups[1]![0]];
  } else if (isFlush) {
    category = 5;
    tie = ranks;
  } else if (straightHigh >= 0) {
    category = 4;
    tie = [straightHigh];
  } else if (shape === "311") {
    category = 3;
    tie = [groups[0]![0], groups[1]![0], groups[2]![0]];
  } else if (shape === "221") {
    category = 2;
    tie = [groups[0]![0], groups[1]![0], groups[2]![0]];
  } else if (shape === "2111") {
    category = 1;
    tie = [groups[0]![0], groups[1]![0], groups[2]![0], groups[3]![0]];
  } else {
    category = 0;
    tie = ranks;
  }

  // Base-13 packing, padded to five tiebreak digits; higher = stronger.
  let v = category;
  for (let i = 0; i < 5; i++) v = v * 13 + (tie[i] ?? 0);
  const NAIVE_MAX = 9 * 13 ** 5;
  return NAIVE_MAX - v;
}

/** Best-of-21 naive 7-card score; LOWER = STRONGER. */
export function best21Naive(cards: readonly number[]): number {
  if (cards.length !== 7) throw new RangeError(`best21Naive needs 7 cards, got ${cards.length}`);
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < 7; i++) {
    for (let j = i + 1; j < 7; j++) {
      const five: number[] = [];
      for (let k = 0; k < 7; k++) {
        if (k !== i && k !== j) five.push(cards[k] as number);
      }
      const sc = score5Naive(five);
      if (sc < best) best = sc;
    }
  }
  return best;
}
