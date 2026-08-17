/**
 * Board-relative hand strength — the axis the villain-policy model bends along.
 *
 * ## Why a local evaluator
 *
 * `@poker/eval` evaluates exactly seven cards. The policy model needs to rank
 * holdings on a THREE- or FOUR-card board too (flop and turn), where a hand is
 * only five or six cards. {@link handRank} handles 5, 6 and 7 cards with the
 * same categorization, so a combo's ordering is computed the same way on every
 * street. It is used only to ORDER holdings for the policy model and for
 * strength percentiles — never to settle a showdown and never inside an equity
 * computation, both of which use the injected 7-card evaluator.
 *
 * Ordering agreement with `@poker/eval` on 7-card inputs is a test in this
 * package (`strength.test.ts`), so the two never drift.
 *
 * ## Why the flush shortcut is safe
 *
 * With at most 7 cards, five cards of one suit rules out quads (a rank needs 4
 * suits, only 2 cards sit outside the flush suit) and a full house (trips needs
 * 3 suits likewise). So when a 5+ card suit exists, the best hand is a straight
 * flush or a flush — nothing between them can occur.
 */

import {
  type Card,
  ALL_COMBOS,
  COMBO_COUNT,
  DECK_SIZE,
  RANK_COUNT,
  SUIT_COUNT,
} from "@poker/core";

/** Hand categories, weakest to strongest. */
export const HAND_CATEGORY = {
  HIGH_CARD: 0,
  PAIR: 1,
  TWO_PAIR: 2,
  TRIPS: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  QUADS: 7,
  STRAIGHT_FLUSH: 8,
} as const;

export type HandCategoryValue = (typeof HAND_CATEGORY)[keyof typeof HAND_CATEGORY];

/** Highest rank completing a straight in `mask`, or -1. Wheel returns rank 3 (five-high). */
function straightHigh(mask: number): number {
  for (let high = RANK_COUNT - 1; high >= 4; high--) {
    const need = 0b11111 << (high - 4);
    if ((mask & need) === need) return high;
  }
  // Wheel: A-5-4-3-2 — ace (rank 12) plays low, the straight is five-high.
  const wheel = (1 << 12) | 0b1111;
  if ((mask & wheel) === wheel) return 3;
  return -1;
}

/** Top `n` set bits of `mask`, highest first. */
function topRanks(mask: number, n: number, out: number[]): void {
  let k = 0;
  for (let r = RANK_COUNT - 1; r >= 0 && k < n; r--) {
    if ((mask >> r) & 1) out[k++] = r;
  }
  while (k < n) out[k++] = 0;
}

/**
 * Strength of the best 5-card hand inside 5, 6 or 7 cards.
 * **Higher = stronger** (the opposite convention to `@poker/eval`, which is
 * lower-is-stronger; that package's contract is order-only, so both are fine
 * as long as each is used consistently).
 *
 * The value packs `category` and five tiebreak ranks into 24 bits; only its
 * ordering is meaningful.
 */
export function handRank(cards: readonly Card[]): number {
  const n = cards.length;
  if (n < 5 || n > 7) {
    throw new RangeError(`handRank requires 5-7 cards, got ${n}`);
  }
  const rankCount = new Int8Array(RANK_COUNT);
  const suitCount = new Int8Array(SUIT_COUNT);
  const suitMask = new Int16Array(SUIT_COUNT);
  let mask = 0;
  for (let i = 0; i < n; i++) {
    const c = cards[i] ?? 0;
    const r = (c / SUIT_COUNT) | 0;
    const s = c % SUIT_COUNT;
    rankCount[r] = (rankCount[r] ?? 0) + 1;
    suitCount[s] = (suitCount[s] ?? 0) + 1;
    suitMask[s] = (suitMask[s] ?? 0) | (1 << r);
    mask |= 1 << r;
  }

  const tb = [0, 0, 0, 0, 0];
  let category: number = HAND_CATEGORY.HIGH_CARD;

  let flushSuit = -1;
  for (let s = 0; s < SUIT_COUNT; s++) {
    if ((suitCount[s] ?? 0) >= 5) flushSuit = s;
  }
  if (flushSuit >= 0) {
    const fm = suitMask[flushSuit] ?? 0;
    const sf = straightHigh(fm);
    if (sf >= 0) {
      category = HAND_CATEGORY.STRAIGHT_FLUSH;
      tb[0] = sf;
      tb[1] = 0;
      tb[2] = 0;
      tb[3] = 0;
      tb[4] = 0;
    } else {
      category = HAND_CATEGORY.FLUSH;
      topRanks(fm, 5, tb);
    }
    return pack(category, tb);
  }

  // Rank-count shape.
  let quad = -1;
  let trip = -1;
  let trip2 = -1;
  let pair = -1;
  let pair2 = -1;
  for (let r = RANK_COUNT - 1; r >= 0; r--) {
    const c = rankCount[r] ?? 0;
    if (c === 4 && quad < 0) quad = r;
    else if (c === 3) {
      if (trip < 0) trip = r;
      else if (trip2 < 0) trip2 = r;
    } else if (c === 2) {
      if (pair < 0) pair = r;
      else if (pair2 < 0) pair2 = r;
    }
  }

  if (quad >= 0) {
    category = HAND_CATEGORY.QUADS;
    tb[0] = quad;
    const kicker = mask & ~(1 << quad);
    const k = [0];
    topRanks(kicker, 1, k);
    tb[1] = k[0] ?? 0;
    tb[2] = 0;
    tb[3] = 0;
    tb[4] = 0;
    return pack(category, tb);
  }
  if (trip >= 0 && (trip2 >= 0 || pair >= 0)) {
    category = HAND_CATEGORY.FULL_HOUSE;
    tb[0] = trip;
    tb[1] = Math.max(trip2, pair);
    tb[2] = 0;
    tb[3] = 0;
    tb[4] = 0;
    return pack(category, tb);
  }

  const st = straightHigh(mask);
  if (st >= 0) {
    category = HAND_CATEGORY.STRAIGHT;
    tb[0] = st;
    tb[1] = 0;
    tb[2] = 0;
    tb[3] = 0;
    tb[4] = 0;
    return pack(category, tb);
  }
  if (trip >= 0) {
    category = HAND_CATEGORY.TRIPS;
    tb[0] = trip;
    const k = [0, 0];
    topRanks(mask & ~(1 << trip), 2, k);
    tb[1] = k[0] ?? 0;
    tb[2] = k[1] ?? 0;
    tb[3] = 0;
    tb[4] = 0;
    return pack(category, tb);
  }
  if (pair >= 0 && pair2 >= 0) {
    category = HAND_CATEGORY.TWO_PAIR;
    tb[0] = pair;
    tb[1] = pair2;
    const k = [0];
    topRanks(mask & ~(1 << pair) & ~(1 << pair2), 1, k);
    tb[2] = k[0] ?? 0;
    tb[3] = 0;
    tb[4] = 0;
    return pack(category, tb);
  }
  if (pair >= 0) {
    category = HAND_CATEGORY.PAIR;
    tb[0] = pair;
    const k = [0, 0, 0];
    topRanks(mask & ~(1 << pair), 3, k);
    tb[1] = k[0] ?? 0;
    tb[2] = k[1] ?? 0;
    tb[3] = k[2] ?? 0;
    tb[4] = 0;
    return pack(category, tb);
  }
  category = HAND_CATEGORY.HIGH_CARD;
  topRanks(mask, 5, tb);
  return pack(category, tb);
}

function pack(category: number, tb: readonly number[]): number {
  return (
    category * 0x100000 +
    (tb[0] ?? 0) * 0x10000 +
    (tb[1] ?? 0) * 0x1000 +
    (tb[2] ?? 0) * 0x100 +
    (tb[3] ?? 0) * 0x10 +
    (tb[4] ?? 0)
  );
}

/** Category of a packed {@link handRank} value. */
export function categoryOf(rank: number): HandCategoryValue {
  return Math.floor(rank / 0x100000) as HandCategoryValue;
}

/**
 * Per-combo strength percentile on a board: `0` = weakest holding available,
 * `1` = strongest. Blocked combos (containing a board or dead card) get `-1`.
 *
 * Percentile is the standard mid-rank: `(weaker + ties / 2) / live`, so hands
 * that tie share a value. Requires a 3-5 card board — preflop strength is a
 * ranking question, not a board question, and belongs to `@poker/ranges`.
 */
export function comboStrengths(board: readonly Card[], dead: readonly Card[] = []): Float64Array {
  if (board.length < 3 || board.length > 5) {
    throw new RangeError(`comboStrengths requires a 3-5 card board, got ${board.length}`);
  }
  const blocked = new Uint8Array(DECK_SIZE);
  for (const c of board) blocked[c] = 1;
  for (const c of dead) blocked[c] = 1;

  const ranks = new Float64Array(COMBO_COUNT).fill(-1);
  const seven: Card[] = [0, 0, ...board];
  const live: number[] = [];
  for (let i = 0; i < COMBO_COUNT; i++) {
    const combo = ALL_COMBOS[i];
    if (combo === undefined) continue;
    if (blocked[combo[0]] === 1 || blocked[combo[1]] === 1) continue;
    seven[0] = combo[0];
    seven[1] = combo[1];
    const r = handRank(seven);
    ranks[i] = r;
    live.push(r);
  }
  if (live.length === 0) return new Float64Array(COMBO_COUNT).fill(-1);

  live.sort((a, b) => a - b);
  const out = new Float64Array(COMBO_COUNT).fill(-1);
  const denom = live.length;
  for (let i = 0; i < COMBO_COUNT; i++) {
    const r = ranks[i] ?? -1;
    if (r < 0) continue;
    const lo = lowerBound(live, r);
    const hi = upperBound(live, r);
    out[i] = (lo + (hi - lo) / 2) / denom;
  }
  return out;
}

function lowerBound(sorted: readonly number[], value: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((sorted[mid] ?? 0) < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function upperBound(sorted: readonly number[], value: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((sorted[mid] ?? 0) <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Memoized {@link comboStrengths}. Boards recur constantly inside one graded
 * hand (every villain action on a street shares one board), and the table costs
 * 1326 evaluations to build.
 */
export function createStrengthCache(): (board: readonly Card[], dead?: readonly Card[]) => Float64Array {
  const cache = new Map<string, Float64Array>();
  return (board, dead = []) => {
    const key = `${[...board].sort((a, b) => a - b).join(",")}|${[...dead].sort((a, b) => a - b).join(",")}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const built = comboStrengths(board, dead);
    cache.set(key, built);
    return built;
  };
}
