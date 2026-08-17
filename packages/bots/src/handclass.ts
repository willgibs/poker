/**
 * Local made-hand and draw classifier.
 *
 * ## Why this exists next to `@poker/eval`
 *
 * The canonical evaluator is a SEVEN-card function: it cannot score a 5- or
 * 6-card board+holding, which is exactly what a bot needs on the flop and
 * turn. It also answers "how strong is this at showdown", not "what does this
 * player think they have" — a bot needs the second thing: made-hand class,
 * draw class, and a cheap comparable score it can percentile-rank a whole
 * 1326-combo range with (once per decision, not once per combo per trial).
 *
 * So this module is a MODEL, not an oracle: it feeds the range model, the
 * tell triggers ("Barry snap-calls flush draws"), and the strength percentile.
 * Real showdown equity always comes from `@poker/equity` with the injected
 * seven-card evaluator. Nothing here ever decides who wins a pot.
 *
 * Scores are integers, HIGHER = stronger (the opposite of `Evaluate7`, which
 * is lower-is-stronger; this one never crosses that boundary).
 */

import { RANK_COUNT, SUIT_COUNT, rankOf, suitOf, type Card } from "@poker/core";

/** Made-hand classes, weakest to strongest. */
export type MadeClass =
  | "air"
  | "weak-pair"
  | "pair"
  | "top-pair"
  | "over-pair"
  | "two-pair"
  | "trips"
  | "straight"
  | "flush"
  | "full-house"
  | "quads"
  | "straight-flush";

/** Ordinal of each made class (0 = air … 11 = straight flush). */
export const MADE_CLASS_ORDER: readonly MadeClass[] = [
  "air",
  "weak-pair",
  "pair",
  "top-pair",
  "over-pair",
  "two-pair",
  "trips",
  "straight",
  "flush",
  "full-house",
  "quads",
  "straight-flush",
];

const MADE_RANK: ReadonlyMap<MadeClass, number> = new Map(
  MADE_CLASS_ORDER.map((c, i) => [c, i] as const),
);

/** Ordinal rank of a made class; higher is stronger. */
export function madeRankOf(cls: MadeClass): number {
  return MADE_RANK.get(cls) ?? 0;
}

/** Everything the bot model knows about a holding on a board. */
export interface HoldingFeatures {
  made: MadeClass;
  /** Ordinal of `made`, 0-11. */
  madeRank: number;
  /** Four-plus cards of one suit, using at least one hole card. */
  flushDraw: boolean;
  /** Backdoor flush interest (exactly three of a suit incl. a hole card). */
  backdoorFlush: boolean;
  /** Two or more distinct ranks complete a straight. */
  oesd: boolean;
  /** Exactly one distinct rank completes a straight. */
  gutshot: boolean;
  /** Rough count of clean improving cards (draw outs only, never made-hand). */
  outs: number;
  /**
   * Comparable strength score, higher = stronger. Category-major with rank
   * tiebreaks, so a percentile over a range is meaningful.
   */
  score: number;
}

/** Bit for a rank in a 13-bit rank mask. */
function bit(rank: number): number {
  return 1 << rank;
}

/**
 * True when `mask` (13-bit, rank 0 = deuce … 12 = ace) contains five
 * consecutive ranks, wheel included (A2345).
 */
function hasStraight(mask: number): boolean {
  return straightHigh(mask) >= 0;
}

/** Highest straight top-card rank in `mask`, or -1. Wheel returns rank 3 (5). */
function straightHigh(mask: number): number {
  // Ace plays low: mirror the ace bit below the deuce by shifting the whole
  // mask up one and setting bit 0 when an ace is present.
  const withWheel = (mask << 1) | (mask & bit(RANK_COUNT - 1) ? 1 : 0);
  for (let top = RANK_COUNT - 1; top >= 3; top--) {
    // In `withWheel` coordinates, rank r sits at bit r+1.
    let all = true;
    for (let k = 0; k < 5; k++) {
      if ((withWheel & (1 << (top + 1 - k))) === 0) {
        all = false;
        break;
      }
    }
    if (all) return top;
  }
  return -1;
}

/** Number of distinct ranks that, if added, would complete a straight. */
function straightOuts(mask: number): number {
  if (hasStraight(mask)) return 0;
  let count = 0;
  for (let r = 0; r < RANK_COUNT; r++) {
    if ((mask & bit(r)) !== 0) continue;
    if (hasStraight(mask | bit(r))) count++;
  }
  return count;
}

/** Pack up to five rank values into a tiebreak integer (rank 0-12 per slot). */
function tiebreak(ranks: readonly number[]): number {
  let v = 0;
  for (let i = 0; i < 5; i++) v = v * 13 + (ranks[i] ?? 0);
  return v;
}

const CATEGORY_STRIDE = 13 * 13 * 13 * 13 * 13; // 371,293 — one slot per tiebreak

interface RankCounts {
  /** counts[rank] = how many cards of that rank. */
  counts: number[];
  /** Ranks appearing EXACTLY `n` times, descending. Exactness matters: a set
   * must not also register as a pair, or every set reads as a full house. */
  byCount: (n: number) => number[];
  mask: number;
}

function countRanks(cards: readonly Card[]): RankCounts {
  const counts = new Array<number>(RANK_COUNT).fill(0);
  let mask = 0;
  for (const c of cards) {
    const r = rankOf(c);
    counts[r] = (counts[r] ?? 0) + 1;
    mask |= bit(r);
  }
  return {
    counts,
    mask,
    byCount(n: number): number[] {
      const out: number[] = [];
      for (let r = RANK_COUNT - 1; r >= 0; r--) if ((counts[r] ?? 0) === n) out.push(r);
      return out;
    },
  };
}

function suitCounts(cards: readonly Card[]): number[] {
  const s = new Array<number>(SUIT_COUNT).fill(0);
  for (const c of cards) s[suitOf(c)] = (s[suitOf(c)] ?? 0) + 1;
  return s;
}

/**
 * Classify a two-card holding on a 0-5 card board.
 *
 * Preflop (empty board) the made class is `over-pair` for a pocket pair and
 * `air` otherwise, and the score is a pure high-card packing — callers should
 * use the preflop ranking percentile there instead (see policy.ts), which this
 * module deliberately does not duplicate.
 */
export function holdingFeatures(
  hole: readonly [Card, Card],
  board: readonly Card[],
): HoldingFeatures {
  const all: Card[] = [hole[0], hole[1], ...board];
  const rc = countRanks(all);
  const suits = suitCounts(all);
  const holeSuits: number[] = [suitOf(hole[0]), suitOf(hole[1])];
  const boardRanks: number[] = board.map(rankOf);
  const topBoard = boardRanks.length > 0 ? Math.max(...boardRanks) : -1;

  // --- flushes -------------------------------------------------------------
  let flushSuit = -1;
  let bestSuitCount = 0;
  for (let s = 0; s < SUIT_COUNT; s++) {
    const n = suits[s] ?? 0;
    if (n > bestSuitCount) {
      bestSuitCount = n;
      flushSuit = s;
    }
  }
  const usesHole = flushSuit >= 0 && holeSuits.includes(flushSuit);
  const flush = bestSuitCount >= 5;
  const flushDraw = !flush && bestSuitCount === 4 && usesHole;
  const backdoorFlush = !flush && bestSuitCount === 3 && usesHole && board.length <= 4;

  // --- straights -----------------------------------------------------------
  const straightTop = straightHigh(rc.mask);
  const straight = straightTop >= 0;
  const sOuts = straightOuts(rc.mask);
  const oesd = !straight && sOuts >= 2;
  const gutshot = !straight && sOuts === 1;

  let straightFlush = false;
  if (flush && flushSuit >= 0) {
    let sfMask = 0;
    for (const c of all) if (suitOf(c) === flushSuit) sfMask |= bit(rankOf(c));
    straightFlush = hasStraight(sfMask);
  }

  // --- rank shapes ---------------------------------------------------------
  const quads = rc.byCount(4);
  const trips = rc.byCount(3);
  const pairs = rc.byCount(2);
  const singles = rc.byCount(1);
  const holeRanks: number[] = [rankOf(hole[0]), rankOf(hole[1])].sort((a, b) => b - a);
  const pocketPair = holeRanks[0] === holeRanks[1];

  // Pairs the holding actually participates in (a board pair the bot does not
  // hold is not "their" pair — it is part of everyone's hand).
  const holeSet = new Set(holeRanks);
  const ownPairs = pairs.filter((r) => holeSet.has(r));

  let cls: MadeClass;
  let tb = 0;
  if (straightFlush) {
    cls = "straight-flush";
    tb = tiebreak([straightTop]);
  } else if (quads.length > 0) {
    cls = "quads";
    tb = tiebreak(quads);
  } else if (trips.length > 0 && (pairs.length > 0 || trips.length > 1)) {
    cls = "full-house";
    tb = tiebreak([trips[0] ?? 0, pairs[0] ?? trips[1] ?? 0]);
  } else if (flush) {
    cls = "flush";
    tb = tiebreak([bestSuitCount, holeRanks[0] ?? 0]);
  } else if (straight) {
    cls = "straight";
    tb = tiebreak([straightTop]);
  } else if (trips.length > 0) {
    cls = "trips";
    tb = tiebreak(trips);
  } else if (pairs.length >= 2 && ownPairs.length >= 1) {
    cls = "two-pair";
    tb = tiebreak(pairs);
  } else if (pocketPair && board.length > 0 && (holeRanks[0] ?? 0) > topBoard) {
    cls = "over-pair";
    tb = tiebreak(holeRanks);
  } else if (ownPairs.length >= 1) {
    const pairRank = ownPairs[0] ?? 0;
    if (board.length === 0) cls = "over-pair";
    else if (pairRank === topBoard) cls = "top-pair";
    else if (pairRank >= (boardRanks.length >= 2 ? sortedDesc(boardRanks)[1] ?? 0 : 0)) cls = "pair";
    else cls = "weak-pair";
    tb = tiebreak([pairRank, ...holeRanks]);
  } else if (pocketPair && board.length === 0) {
    cls = "over-pair";
    tb = tiebreak(holeRanks);
  } else {
    cls = "air";
    tb = tiebreak([...holeRanks, ...singles.slice(0, 3)]);
  }

  const madeRank = madeRankOf(cls);
  const drawOuts = (flushDraw ? 9 : 0) + (oesd ? 8 : gutshot ? 4 : 0) - (flushDraw && (oesd || gutshot) ? 2 : 0);

  return {
    made: cls,
    madeRank,
    flushDraw,
    backdoorFlush,
    oesd,
    gutshot,
    outs: Math.max(0, drawOuts),
    score: madeRank * CATEGORY_STRIDE + tb,
  };
}

function sortedDesc(xs: readonly number[]): number[] {
  return [...xs].sort((a, b) => b - a);
}

/**
 * A cheap strength SCORE for the same holding, used to percentile-rank a
 * whole range. Adds a small draw bonus so semi-bluff candidates rank above
 * pure air, which is what a human means by "I have something here".
 */
export function holdingScore(hole: readonly [Card, Card], board: readonly Card[]): number {
  const f = holdingFeatures(hole, board);
  const drawBonus = f.flushDraw ? 2 : f.oesd ? 1.5 : f.gutshot ? 0.5 : f.backdoorFlush ? 0.2 : 0;
  return f.score + Math.round(drawBonus * (CATEGORY_STRIDE / 4));
}
