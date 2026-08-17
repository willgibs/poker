/**
 * Test-only helpers: a self-contained seven-card evaluator and engine drivers.
 *
 * The evaluator here is NOT `@poker/eval` on purpose — `bots` does not depend
 * on the evaluator package (see the package map in CLAUDE.md); the engine
 * injects one. Tests need *an* evaluator to inject, so this file carries a
 * compact counting-based implementation: correct category ordering and
 * tiebreaks, no lookup tables, nowhere near fast enough to ship. Production
 * code always receives the real evaluator through `TableState.evaluate7`.
 */

import {
  RANK_COUNT,
  SUIT_COUNT,
  cardFromString,
  freshDeck,
  rankOf,
  suitOf,
  type Card,
} from "@poker/core";
import { applyAction, initHand, legalActions, type TableState } from "@poker/engine";
import type { HandEvent } from "@poker/history";
import { streamFor } from "@poker/rng";
import type { PersonaConfig } from "./persona";
import { initialBotState, type BotState } from "./state";
import { decide } from "./pipeline";
import type { BotDecision, BotStreams, DecisionSnapshot } from "./types";

// ---------------------------------------------------------------------------
// A small, correct 7-card evaluator (lower = stronger).
// ---------------------------------------------------------------------------

function packed(ranks: readonly number[]): number {
  let v = 0;
  for (let i = 0; i < 5; i++) v = v * 13 + (ranks[i] ?? 0);
  return v;
}

/** Highest 5-card straight top rank in a 13-bit mask, or -1 (wheel = 3). */
function straightTop(mask: number): number {
  const withWheel = (mask << 1) | ((mask & (1 << (RANK_COUNT - 1))) !== 0 ? 1 : 0);
  for (let top = RANK_COUNT - 1; top >= 3; top--) {
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

/**
 * Rank exactly seven cards. Returns a value where LOWER is stronger, matching
 * the `Evaluate7` contract the engine and `@poker/equity` rely on.
 */
export function testEvaluate7(cards: number[]): number {
  if (cards.length !== 7) throw new RangeError(`testEvaluate7 needs 7 cards, got ${cards.length}`);
  const rankCounts = new Array<number>(RANK_COUNT).fill(0);
  const suitCounts = new Array<number>(SUIT_COUNT).fill(0);
  const suitMasks = new Array<number>(SUIT_COUNT).fill(0);
  let mask = 0;
  for (const c of cards) {
    const r = rankOf(c);
    const s = suitOf(c);
    rankCounts[r] = (rankCounts[r] ?? 0) + 1;
    suitCounts[s] = (suitCounts[s] ?? 0) + 1;
    suitMasks[s] = (suitMasks[s] ?? 0) | (1 << r);
    mask |= 1 << r;
  }

  let flushSuit = -1;
  for (let s = 0; s < SUIT_COUNT; s++) if ((suitCounts[s] ?? 0) >= 5) flushSuit = s;

  if (flushSuit >= 0) {
    const sm = suitMasks[flushSuit] ?? 0;
    const sfTop = straightTop(sm);
    if (sfTop >= 0) return -(8 * 13 ** 5 + packed([sfTop, 0, 0, 0, 0]));
  }

  const byCount = (n: number): number[] => {
    const out: number[] = [];
    for (let r = RANK_COUNT - 1; r >= 0; r--) if ((rankCounts[r] ?? 0) === n) out.push(r);
    return out;
  };
  const quads = byCount(4);
  const trips = byCount(3);
  const pairs = byCount(2);
  const singles = byCount(1);

  const kickersFrom = (exclude: readonly number[], need: number): number[] => {
    const out: number[] = [];
    for (let r = RANK_COUNT - 1; r >= 0 && out.length < need; r--) {
      if ((rankCounts[r] ?? 0) === 0) continue;
      if (exclude.includes(r)) continue;
      out.push(r);
    }
    return out;
  };

  if (quads.length > 0) {
    const q = quads[0] ?? 0;
    return -(7 * 13 ** 5 + packed([q, ...kickersFrom([q], 1)]));
  }
  if (trips.length > 0 && (pairs.length > 0 || trips.length > 1)) {
    const t = trips[0] ?? 0;
    const p = trips.length > 1 ? Math.max(trips[1] ?? 0, pairs[0] ?? 0) : (pairs[0] ?? 0);
    return -(6 * 13 ** 5 + packed([t, p]));
  }
  if (flushSuit >= 0) {
    const sm = suitMasks[flushSuit] ?? 0;
    const top: number[] = [];
    for (let r = RANK_COUNT - 1; r >= 0 && top.length < 5; r--) if ((sm & (1 << r)) !== 0) top.push(r);
    return -(5 * 13 ** 5 + packed(top));
  }
  const st = straightTop(mask);
  if (st >= 0) return -(4 * 13 ** 5 + packed([st]));
  if (trips.length > 0) {
    const t = trips[0] ?? 0;
    return -(3 * 13 ** 5 + packed([t, ...kickersFrom([t], 2)]));
  }
  if (pairs.length >= 2) {
    const a = pairs[0] ?? 0;
    const b = pairs[1] ?? 0;
    return -(2 * 13 ** 5 + packed([a, b, ...kickersFrom([a, b], 1)]));
  }
  if (pairs.length === 1) {
    const p = pairs[0] ?? 0;
    return -(1 * 13 ** 5 + packed([p, ...kickersFrom([p], 3)]));
  }
  return -packed(singles.slice(0, 5));
}

/** Parse a space-separated card string, e.g. `"As Kd 7c"`. */
export function cards(s: string): Card[] {
  return s
    .split(/\s+/)
    .filter((x) => x.length > 0)
    .map((x) => cardFromString(x));
}

/** Exactly two cards, for hole-card arguments. */
export function hole(s: string): [Card, Card] {
  const c = cards(s);
  const a = c[0];
  const b = c[1];
  if (c.length !== 2 || a === undefined || b === undefined) {
    throw new RangeError(`hole() needs exactly two cards, got ${JSON.stringify(s)}`);
  }
  return [a, b];
}

// ---------------------------------------------------------------------------
// Engine drivers
// ---------------------------------------------------------------------------

export interface TableSetup {
  seed: number | string;
  handNumber?: number;
  button?: number;
  /** Starting stacks in cents, one per seat (seat number = index). */
  stacks?: number[];
  blinds?: { sb: number; bb: number; ante: number };
}

/** Start a hand with a seeded shuffle (or a stacked deck) and the test evaluator. */
export function startHand(setup: TableSetup & { deckOrder?: Card[] }): {
  state: TableState;
  events: HandEvent[];
} {
  const stacks = setup.stacks ?? [20000, 20000, 20000, 20000, 20000, 20000];
  const handNumber = setup.handNumber ?? 1;
  const deckStream = streamFor(setup.seed, `hand/${handNumber}/deck`);
  const deckOrder = setup.deckOrder ?? deckStream.shuffle(freshDeck());
  return initHand({
    handNumber,
    button: setup.button ?? 0,
    seats: stacks.map((stack, seat) => ({ seat, stack })),
    blinds: setup.blinds ?? { sb: 50, bb: 100, ante: 0 },
    deckOrder,
    evaluate7: testEvaluate7,
  });
}

/**
 * Build a deck order that deals exactly the requested hole cards and board.
 *
 * Mirrors the engine's locked dealing convention: clockwise from the seat left
 * of the button, two consecutive cards per seat, then the board with NO burns.
 * Remaining slots are filled with whatever cards are left, ascending.
 */
export function stackedDeck(opts: {
  seats: readonly number[];
  button: number;
  holes: Readonly<Record<number, readonly [Card, Card]>>;
  board?: readonly Card[];
}): Card[] {
  const seats = [...opts.seats].sort((a, b) => a - b);
  const btnIdx = seats.indexOf(opts.button);
  if (btnIdx < 0) throw new RangeError(`button ${opts.button} is not seated`);
  const order: Card[] = [];
  const used = new Set<Card>();
  const take = (c: Card): void => {
    if (used.has(c)) throw new RangeError(`card ${c} used twice in stackedDeck`);
    used.add(c);
    order.push(c);
  };
  const pool = freshDeck().filter((c) => {
    for (const h of Object.values(opts.holes)) if (h[0] === c || h[1] === c) return false;
    return !(opts.board ?? []).includes(c);
  });
  let poolIdx = 0;
  const nextFiller = (): Card => {
    const c = pool[poolIdx++];
    if (c === undefined) throw new RangeError("stackedDeck ran out of filler cards");
    return c;
  };
  for (let k = 1; k <= seats.length; k++) {
    const seat = seats[(btnIdx + k) % seats.length];
    if (seat === undefined) continue;
    const h = opts.holes[seat];
    if (h === undefined) {
      take(nextFiller());
      take(nextFiller());
    } else {
      take(h[0]);
      take(h[1]);
    }
  }
  for (const c of opts.board ?? []) take(c);
  while (order.length < 52) take(nextFiller());
  return order;
}

/** Named streams for one decision, per the architecture's seed hierarchy. */
export function streamsFor(seed: number | string, seat: number, street: string, n: number): BotStreams {
  return {
    decision: streamFor(seed, `bot/${seat}/${street}/${n}`),
    mc: streamFor(seed, `mc/${seat}/${street}/${n}`),
  };
}

export interface PlayedHand {
  events: HandEvent[];
  finalState: TableState;
  decisions: Array<{ seat: number; decision: BotDecision }>;
}

/**
 * Play a whole hand with every seat driven by a persona. Returns the canonical
 * event log plus every decision made — enough for legality, determinism and
 * trace assertions.
 */
export function playHand(
  setup: TableSetup,
  personaFor: (seat: number) => PersonaConfig,
  botStates?: Map<number, BotState>,
): PlayedHand {
  const { state: initial, events } = startHand(setup);
  let state = initial;
  const log: HandEvent[] = [...events];
  const decisions: Array<{ seat: number; decision: BotDecision }> = [];
  const counters = new Map<string, number>();
  const states = botStates ?? new Map<number, BotState>();

  let guard = 0;
  while (!state.handOver && state.actionSeat !== null) {
    if (guard++ > 200) throw new Error("hand did not terminate");
    const seat = state.actionSeat;
    const persona = personaFor(seat);
    const botState = states.get(seat) ?? initialBotState(persona);
    const key = `${state.street}:${seat}`;
    const n = counters.get(key) ?? 0;
    counters.set(key, n + 1);
    const snapshot: DecisionSnapshot = {
      state,
      seat,
      persona,
      events: log,
      legal: legalActions(state),
    };
    const decision = decide(snapshot, botState, streamsFor(setup.seed, seat, state.street, n));
    states.set(seat, decision.nextBotState);
    decisions.push({ seat, decision });
    const input: { seat: number; kind: BotDecision["action"]; amount?: number } = {
      seat,
      kind: decision.action,
    };
    if (decision.amount !== undefined) input.amount = decision.amount;
    const result = applyAction(state, input);
    state = result.state;
    for (const ev of result.events) log.push(ev);
  }

  return { events: log, finalState: state, decisions };
}
