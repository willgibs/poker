/**
 * initHand — validate config, post antes and blinds, deal hole cards, and
 * open the preflop betting round (or run the hand out immediately when the
 * posts already put everyone all-in).
 *
 * Conventions (deterministic; locked by golden fixtures):
 * - Seats are sorted ascending by seat number; clockwise = ascending, wrapping.
 * - Heads-up: the button posts the small blind and acts first preflop.
 * - Post order: antes clockwise from the seat left of the button (button
 *   last), then SB, then BB. Short stacks post short (all-in); a 0-amount
 *   post emits no event.
 * - Preflop `currentBet` is the nominal big blind even when the big blind
 *   posted short.
 * - Deal order: clockwise from the seat left of the button, two consecutive
 *   deck cards per seat.
 */

import { DECK_SIZE, MAX_TABLE_SIZE, MIN_TABLE_SIZE, isCard } from "@poker/core";
import type { HandEvent } from "@poker/history";
import { EngineError } from "./errors";
import {
  clockwiseFrom,
  commit,
  commitAnte,
  must,
  nextActorFrom,
  type MutableSeat,
  type MutableState,
} from "./internal";
import { advance } from "./lifecycle";
import type { EngineResult, HandConfig } from "./types";

function badConfig(message: string): never {
  throw new EngineError("bad_config", message);
}

function assertCents(n: number, what: string): void {
  if (!Number.isSafeInteger(n) || n < 0) {
    badConfig(`${what} must be a non-negative integer (cents), got ${n}`);
  }
}

function validateConfig(config: HandConfig): void {
  if (!Number.isSafeInteger(config.handNumber) || config.handNumber < 1) {
    badConfig(`handNumber must be a positive integer, got ${config.handNumber}`);
  }
  const count = config.seats.length;
  if (count < MIN_TABLE_SIZE || count > MAX_TABLE_SIZE) {
    badConfig(`expected ${MIN_TABLE_SIZE}-${MAX_TABLE_SIZE} seats, got ${count}`);
  }
  const seen = new Set<number>();
  for (const s of config.seats) {
    if (!Number.isSafeInteger(s.seat) || s.seat < 0) {
      badConfig(`seat numbers must be non-negative integers, got ${s.seat}`);
    }
    if (seen.has(s.seat)) badConfig(`duplicate seat ${s.seat}`);
    seen.add(s.seat);
    assertCents(s.stack, `stack for seat ${s.seat}`);
    if (s.stack < 1) badConfig(`stack for seat ${s.seat} must be >= 1 cent`);
  }
  if (!seen.has(config.button)) badConfig(`button ${config.button} is not a dealt-in seat`);
  assertCents(config.blinds.sb, "blinds.sb");
  assertCents(config.blinds.bb, "blinds.bb");
  assertCents(config.blinds.ante, "blinds.ante");
  if (config.blinds.bb < 1) badConfig("blinds.bb must be >= 1 cent");
  if (config.deckOrder.length !== DECK_SIZE) {
    badConfig(`deckOrder must contain all ${DECK_SIZE} cards, got ${config.deckOrder.length}`);
  }
  const cards = new Set<number>();
  for (const c of config.deckOrder) {
    if (!isCard(c)) badConfig(`deckOrder contains invalid card ${c}`);
    if (cards.has(c)) badConfig(`deckOrder contains duplicate card ${c}`);
    cards.add(c);
  }
  if (typeof config.evaluate7 !== "function") badConfig("evaluate7 must be a function");
}

export function initHand(config: HandConfig): EngineResult {
  validateConfig(config);

  const seats: MutableSeat[] = [...config.seats]
    .sort((a, b) => a.seat - b.seat)
    .map((s) => ({
      seat: s.seat,
      startingStack: s.stack,
      stack: s.stack,
      committedStreet: 0,
      committedTotal: 0,
      folded: false,
      allIn: false,
      actedThisRound: false,
      holeCards: null,
      awarded: 0,
    }));

  const st: MutableState = {
    handNumber: config.handNumber,
    button: config.button,
    blinds: { sb: config.blinds.sb, bb: config.blinds.bb, ante: config.blinds.ante },
    seats,
    street: "preflop",
    board: [],
    deck: [...config.deckOrder],
    deckCursor: 0,
    actionSeat: null,
    currentBet: config.blinds.bb,
    minRaise: config.blinds.bb,
    lastAggressor: null,
    handOver: false,
    evaluate7: config.evaluate7,
  };

  const events: HandEvent[] = [
    {
      t: "start",
      handNumber: st.handNumber,
      button: st.button,
      seats: seats.map((s) => ({ seat: s.seat, stack: s.startingStack })),
      blinds: { sb: st.blinds.sb, bb: st.blinds.bb, ante: st.blinds.ante },
    },
  ];

  const n = seats.length;
  const buttonIdx = seats.findIndex((s) => s.seat === st.button);
  const fromLeftOfButton = clockwiseFrom(st, (buttonIdx + 1) % n);

  // Antes — clockwise from left of the button, button last.
  if (st.blinds.ante > 0) {
    for (const idx of fromLeftOfButton) {
      const seat = must(seats[idx], "ante seat");
      const amount = Math.min(st.blinds.ante, seat.stack);
      if (amount > 0) {
        commitAnte(seat, amount);
        events.push({ t: "post", seat: seat.seat, kind: "ante", amount });
      }
    }
  }

  // Blinds — heads-up the button is the small blind.
  const sbIdx = n === 2 ? buttonIdx : (buttonIdx + 1) % n;
  const bbIdx = (sbIdx + 1) % n;
  const sbSeat = must(seats[sbIdx], "sb seat");
  const bbSeat = must(seats[bbIdx], "bb seat");
  const sbAmount = Math.min(st.blinds.sb, sbSeat.stack);
  if (sbAmount > 0) {
    commit(sbSeat, sbAmount);
    events.push({ t: "post", seat: sbSeat.seat, kind: "sb", amount: sbAmount });
  }
  const bbAmount = Math.min(st.blinds.bb, bbSeat.stack);
  if (bbAmount > 0) {
    commit(bbSeat, bbAmount);
    events.push({ t: "post", seat: bbSeat.seat, kind: "bb", amount: bbAmount });
  }

  // Deal — clockwise from left of the button, two consecutive cards each.
  for (const idx of fromLeftOfButton) {
    const seat = must(seats[idx], "deal seat");
    const c1 = must(st.deck[st.deckCursor], "deck card");
    const c2 = must(st.deck[st.deckCursor + 1], "deck card");
    st.deckCursor += 2;
    seat.holeCards = [c1, c2];
    events.push({ t: "hole", seat: seat.seat, cards: [c1, c2] });
  }

  // Open preflop: first decision is left of the big blind. If the posts
  // already ended all possible betting, run the hand out right now.
  const first = nextActorFrom(st, bbIdx);
  if (first !== null) {
    st.actionSeat = must(seats[first], "first actor").seat;
  } else {
    advance(st, events);
  }

  return { state: st, events };
}
