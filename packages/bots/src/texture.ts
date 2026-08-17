/**
 * Minimal board-texture classifier.
 *
 * The pipeline's stage 1 needs one honest scalar ("how wet is this?") plus the
 * structural facts personas react to (paired boards, monotone flops, scare
 * cards Rocco treats as personal property). This is a bot-model heuristic, not
 * solver output: it exists to make barrel weights, continuance estimates and
 * think-time bands respond to the board the way a human's would.
 *
 * Deterministic and allocation-light: no rng, no time, no floats leaking into
 * chip math.
 */

import { RANK_COUNT, SUIT_COUNT, rankOf, suitOf, type Card } from "@poker/core";
import type { Street } from "@poker/history";

/** Coarse label for the trace and for tell triggers. */
export type TextureLabel = "dry" | "semi-wet" | "wet";

export interface BoardTexture {
  street: Street;
  /** Number of board cards (0, 3, 4 or 5). */
  cardCount: number;
  /** Two or more board cards share a rank. */
  paired: boolean;
  /** Three or more board cards share a rank. */
  trips: boolean;
  /** Largest same-suit count on the board. */
  maxSuitCount: number;
  /** Three-plus of one suit on a three-card board (or 3+ generally). */
  monotone: boolean;
  twoTone: boolean;
  rainbow: boolean;
  /** Straight-connectivity of the board, [0, 1]. */
  connectedness: number;
  /** Fraction of board cards that are ten or better, [0, 1]. */
  highness: number;
  /** Number of board ranks that are ten or better. */
  highCards: number;
  /** Composite wetness, [0, 1]. */
  wetness: number;
  label: TextureLabel;
}

/** Street implied by a board length. */
export function streetOfBoard(cardCount: number): Street {
  if (cardCount >= 5) return "river";
  if (cardCount === 4) return "turn";
  if (cardCount >= 3) return "flop";
  return "preflop";
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * Connectivity of the board: how close its three tightest distinct ranks sit,
 * with a bump for any adjacent pair of ranks. An empty or one-rank board is 0.
 */
function connectednessOf(ranks: readonly number[]): number {
  const distinct = [...new Set(ranks)].sort((a, b) => a - b);
  if (distinct.length < 2) return 0;
  let adjacency = 0;
  for (let i = 1; i < distinct.length; i++) {
    const gap = (distinct[i] ?? 0) - (distinct[i - 1] ?? 0);
    if (gap === 1) adjacency += 1;
    else if (gap === 2) adjacency += 0.5;
  }
  let tightestSpan = RANK_COUNT;
  if (distinct.length >= 3) {
    for (let i = 0; i + 2 < distinct.length; i++) {
      const span = (distinct[i + 2] ?? 0) - (distinct[i] ?? 0);
      if (span < tightestSpan) tightestSpan = span;
    }
  } else {
    tightestSpan = (distinct[1] ?? 0) - (distinct[0] ?? 0) + 2;
  }
  const spanScore = tightestSpan <= 2 ? 1 : tightestSpan <= 4 ? 0.7 : tightestSpan <= 6 ? 0.35 : 0.05;
  const adjacencyScore = Math.min(1, adjacency / 2);
  return clamp01(0.7 * spanScore + 0.3 * adjacencyScore);
}

/**
 * Classify a board. Accepts 0-5 cards; a 0-card board is the preflop
 * "no texture" case (everything false / zero, label `dry`).
 */
export function classifyTexture(board: readonly Card[]): BoardTexture {
  const cardCount = board.length;
  const street = streetOfBoard(cardCount);
  const rankCounts = new Array<number>(RANK_COUNT).fill(0);
  const suits = new Array<number>(SUIT_COUNT).fill(0);
  const ranks: number[] = [];
  for (const c of board) {
    const r = rankOf(c);
    ranks.push(r);
    rankCounts[r] = (rankCounts[r] ?? 0) + 1;
    suits[suitOf(c)] = (suits[suitOf(c)] ?? 0) + 1;
  }
  let maxRankCount = 0;
  for (const n of rankCounts) if (n > maxRankCount) maxRankCount = n;
  let maxSuitCount = 0;
  for (const n of suits) if (n > maxSuitCount) maxSuitCount = n;

  const connectedness = connectednessOf(ranks);
  const highCards = ranks.filter((r) => r >= 8).length; // T, J, Q, K, A
  const highness = cardCount === 0 ? 0 : highCards / cardCount;

  // Suitedness: a two-tone flop already carries a flush draw; monotone is the
  // maximum. Later streets need one more card of the suit for the same weight.
  let suitedness = 0;
  if (cardCount > 0) {
    if (maxSuitCount >= 5) suitedness = 1;
    else if (maxSuitCount === 4) suitedness = 1;
    else if (maxSuitCount === 3) suitedness = cardCount === 3 ? 1 : 0.6;
    else if (maxSuitCount === 2) suitedness = cardCount === 3 ? 0.45 : 0.3;
  }

  const wetness =
    cardCount === 0 ? 0 : clamp01(0.4 * suitedness + 0.45 * connectedness + 0.15 * highness);
  const label: TextureLabel = wetness < 0.3 ? "dry" : wetness < 0.6 ? "semi-wet" : "wet";

  return {
    street,
    cardCount,
    paired: maxRankCount >= 2,
    trips: maxRankCount >= 3,
    maxSuitCount,
    monotone: cardCount > 0 && maxSuitCount >= 3,
    twoTone: maxSuitCount === 2,
    rainbow: cardCount > 0 && maxSuitCount <= 1,
    connectedness,
    highness,
    highCards,
    wetness,
    label,
  };
}

/**
 * True when the newest board card is a "scare card" relative to the previous
 * street: an ace/king, a card that completes a flush, or one that completes an
 * obvious straight. Rocco's barrel weights and Maxine's story-forcing both key
 * off this.
 */
export function isScareCard(board: readonly Card[]): boolean {
  if (board.length < 4) return false;
  const last = board[board.length - 1];
  if (last === undefined) return false;
  const prev = board.slice(0, board.length - 1);
  const before = classifyTexture(prev);
  const after = classifyTexture(board);
  if (rankOf(last) >= 11) return true; // K or A
  if (after.maxSuitCount >= 3 && before.maxSuitCount < 3) return true;
  if (after.connectedness - before.connectedness >= 0.25) return true;
  if (after.paired && !before.paired) return true;
  return false;
}
