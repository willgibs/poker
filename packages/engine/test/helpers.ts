/**
 * Test-only helpers: a naive-but-correct 7-card evaluator (best of the 21
 * five-card hands, simple category scoring — deliberately NOT @poker/eval),
 * a tiny seeded LCG, deck builders, and a scripted-hand driver.
 */

import { cardFromString, freshDeck, DECK_SIZE } from "@poker/core";
import type { ActionKind, HandEvent } from "@poker/history";
import {
  applyAction,
  initHand,
  type EngineResult,
  type HandConfig,
  type TableState,
} from "../src/index";

// --- naive 7-card evaluator ------------------------------------------------

// Category ranks: lower = stronger.
const CAT_STRAIGHT_FLUSH = 0;
const CAT_QUADS = 1;
const CAT_FULL_HOUSE = 2;
const CAT_FLUSH = 3;
const CAT_STRAIGHT = 4;
const CAT_TRIPS = 5;
const CAT_TWO_PAIR = 6;
const CAT_PAIR = 7;
const CAT_HIGH = 8;

const BASE = 14;

/** Score = category * 14^5 + significance digits (12 - rank, padded with 13). */
function pack(category: number, significant: number[]): number {
  let score = category;
  for (let i = 0; i < 5; i++) {
    const r = significant[i];
    score = score * BASE + (r === undefined ? 13 : 12 - r);
  }
  return score;
}

/** Straight high-card rank for 5 distinct ranks, or null. Wheel high = 3 (the five). */
function straightHigh(distinctDesc: number[]): number | null {
  if (distinctDesc.length !== 5) return null;
  const hi = distinctDesc[0]!;
  const lo = distinctDesc[4]!;
  if (hi - lo === 4) return hi;
  // Wheel: A 5 4 3 2 → [12, 3, 2, 1, 0]
  if (hi === 12 && distinctDesc[1] === 3 && lo === 0) return 3;
  return null;
}

function score5(cards: readonly number[]): number {
  const ranks = cards.map((c) => Math.floor(c / 4));
  const suits = cards.map((c) => c % 4);
  const isFlush = suits.every((s) => s === suits[0]);

  const countByRank = new Map<number, number>();
  for (const r of ranks) countByRank.set(r, (countByRank.get(r) ?? 0) + 1);
  // Groups sorted by count desc, then rank desc.
  const groups = [...countByRank.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const distinctDesc = groups.map(([r]) => r).sort((a, b) => b - a);
  const sHigh = straightHigh(distinctDesc);

  if (isFlush && sHigh !== null) return pack(CAT_STRAIGHT_FLUSH, [sHigh]);
  const [g0, g1] = groups;
  if (g0 !== undefined && g0[1] === 4) return pack(CAT_QUADS, [g0[0], g1![0]]);
  if (g0 !== undefined && g1 !== undefined && g0[1] === 3 && g1[1] === 2) {
    return pack(CAT_FULL_HOUSE, [g0[0], g1[0]]);
  }
  const ranksDesc = [...ranks].sort((a, b) => b - a);
  if (isFlush) return pack(CAT_FLUSH, ranksDesc);
  if (sHigh !== null) return pack(CAT_STRAIGHT, [sHigh]);
  if (g0 !== undefined && g0[1] === 3) {
    const kickers = distinctDesc.filter((r) => r !== g0[0]);
    return pack(CAT_TRIPS, [g0[0], ...kickers]);
  }
  if (g0 !== undefined && g1 !== undefined && g0[1] === 2 && g1[1] === 2) {
    const hi = Math.max(g0[0], g1[0]);
    const lo = Math.min(g0[0], g1[0]);
    const kicker = distinctDesc.find((r) => r !== hi && r !== lo)!;
    return pack(CAT_TWO_PAIR, [hi, lo, kicker]);
  }
  if (g0 !== undefined && g0[1] === 2) {
    const kickers = distinctDesc.filter((r) => r !== g0[0]);
    return pack(CAT_PAIR, [g0[0], ...kickers]);
  }
  return pack(CAT_HIGH, ranksDesc);
}

/** Naive 7-card evaluator: best (lowest) of all C(7,5)=21 five-card hands. */
export function evaluate7Naive(cards: number[]): number {
  if (cards.length !== 7) throw new Error(`evaluate7Naive needs 7 cards, got ${cards.length}`);
  let best = Infinity;
  for (let a = 0; a < 7; a++) {
    for (let b = a + 1; b < 7; b++) {
      const five: number[] = [];
      for (let i = 0; i < 7; i++) if (i !== a && i !== b) five.push(cards[i]!);
      const s = score5(five);
      if (s < best) best = s;
    }
  }
  return best;
}

// --- seeded PRNG (tests only) ----------------------------------------------

export interface Lcg {
  next(): number;
  /** Uniform-ish integer in [0, n). */
  int(n: number): number;
}

/** Tiny 32-bit LCG (Numerical Recipes constants). Deterministic per seed. */
export function lcg(seed: number): Lcg {
  let s = seed >>> 0;
  const next = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s;
  };
  return { next, int: (n: number) => next() % n };
}

// --- decks ------------------------------------------------------------------

export function shuffledDeck(rng: Lcg): number[] {
  const deck = freshDeck();
  for (let i = DECK_SIZE - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const t = deck[i]!;
    deck[i] = deck[j]!;
    deck[j] = t;
  }
  return deck;
}

/**
 * Deck whose first cards are exactly `firstCards` (card strings, in deal
 * order: hole pairs clockwise from left of the button, then flop/turn/river),
 * padded with the remaining cards ascending.
 */
export function riggedDeck(firstCards: string[]): number[] {
  const first = firstCards.map(cardFromString);
  const used = new Set(first);
  if (used.size !== first.length) throw new Error("riggedDeck: duplicate card");
  const rest = freshDeck().filter((c) => !used.has(c));
  return [...first, ...rest];
}

// --- scripted-hand driver ---------------------------------------------------

export type Scripted = [seat: number, kind: ActionKind, amount?: number];

export interface PlayResult {
  state: TableState;
  /** Full event log: init events + every action's events, concatenated. */
  events: HandEvent[];
}

export function play(config: HandConfig, actions: readonly Scripted[]): PlayResult {
  let r: EngineResult = initHand(config);
  const events = [...r.events];
  for (const [seat, kind, amount] of actions) {
    r = applyAction(r.state, amount === undefined ? { seat, kind } : { seat, kind, amount });
    events.push(...r.events);
  }
  return { state: r.state, events };
}

/** Standard config shorthand used across tests. */
export function config(
  overrides: Partial<HandConfig> & Pick<HandConfig, "seats" | "button" | "deckOrder">,
): HandConfig {
  return {
    handNumber: 1,
    blinds: { sb: 50, bb: 100, ante: 0 },
    evaluate7: evaluate7Naive,
    ...overrides,
  };
}

export function totalStacks(state: TableState): number {
  return state.seats.reduce((a, s) => a + s.stack, 0);
}

export function seat(state: TableState, seatNo: number) {
  const s = state.seats.find((x) => x.seat === seatNo);
  if (s === undefined) throw new Error(`no seat ${seatNo}`);
  return s;
}

/** Events of a given type, typed. */
export function ofType<K extends HandEvent["t"]>(
  events: readonly HandEvent[],
  t: K,
): Array<Extract<HandEvent, { t: K }>> {
  return events.filter((e): e is Extract<HandEvent, { t: K }> => e.t === t);
}
