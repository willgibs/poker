/**
 * Street advancement, runout, showdown, and pot awarding.
 *
 * Called whenever a betting round closes (and by initHand, since a hand can
 * be all-in from the blinds alone). Advancement loops: if no further betting
 * is possible the remaining streets are dealt in one pass (all-in runout)
 * straight to showdown.
 *
 * Dealing: NO burn cards — board cards come sequentially from the injected
 * deck order (burns are physical-casino anti-marking ritual; with an explicit
 * pre-shuffled deck they would only re-index the same distribution).
 *
 * Showdown: every non-folded seat reveals, ordered clockwise starting from
 * the last aggressor of the final betting round (else from the first
 * non-folded seat left of the button). Pots are built from total-committed
 * layers; each pot goes to the eligible seat(s) with the LOWEST injected
 * evaluator score, split evenly with odd cents to the winners closest to the
 * button's left, per pot. A winner whose split share rounds to 0 cents gets
 * no pot event.
 */

import { splitPotEven } from "@poker/core";
import type { HandEvent, Street } from "@poker/history";
import {
  actionableCount,
  buttonIndex,
  clockwiseFrom,
  must,
  nextActorFrom,
  nonFoldedCount,
  rankFromButton,
  seatIndexOf,
  type MutableState,
} from "./internal";
import { potsOf } from "./pots";
import { EngineError } from "./errors";

const NEXT_STREET: Partial<Record<Street, "flop" | "turn" | "river">> = {
  preflop: "flop",
  flop: "turn",
  turn: "river",
};

/** Award every pot; `pickWinners` narrows an eligible set to its winners. */
function awardPots(
  st: MutableState,
  events: HandEvent[],
  pickWinners: (eligible: readonly number[]) => number[],
): void {
  const pots = potsOf(st);
  pots.forEach((pot, potIndex) => {
    const winners = pickWinners(pot.eligible)
      .slice()
      .sort((a, b) => rankFromButton(st, a) - rankFromButton(st, b));
    if (winners.length === 0) {
      throw new EngineError("invariant", `pot ${potIndex} has no winner`);
    }
    const shares = splitPotEven(
      pot.amount,
      winners.length,
      winners.map((_, k) => k),
    );
    winners.forEach((seatNo, k) => {
      const share = must(shares[k], "pot share");
      if (share === 0) return;
      const seat = must(st.seats[seatIndexOf(st, seatNo)], "winning seat");
      seat.stack += share;
      seat.awarded += share;
      events.push({ t: "pot", potIndex, seat: seatNo, amount: share });
    });
  });
}

function finishHand(st: MutableState, events: HandEvent[]): void {
  st.handOver = true;
  st.actionSeat = null;
  events.push({
    t: "end",
    net: st.seats.map((s) => ({ seat: s.seat, net: s.stack - s.startingStack })),
  });
}

function runShowdown(st: MutableState, events: HandEvent[]): void {
  const n = st.seats.length;
  const startIdx =
    st.lastAggressor !== null
      ? seatIndexOf(st, st.lastAggressor)
      : (buttonIndex(st) + 1) % n;

  const revealOrder = clockwiseFrom(st, startIdx).filter(
    (i) => !must(st.seats[i], "seat").folded,
  );
  const reveals = revealOrder.map((i) => {
    const s = must(st.seats[i], "seat");
    const hole = s.holeCards;
    if (hole === null) throw new EngineError("invariant", `seat ${s.seat} has no hole cards`);
    return { seat: s.seat, cards: [hole[0], hole[1]] as [number, number] };
  });
  events.push({ t: "showdown", reveals });

  if (st.board.length !== 5) {
    throw new EngineError("invariant", `showdown with ${st.board.length} board cards`);
  }
  const scoreBySeat = new Map<number, number>();
  for (const r of reveals) {
    scoreBySeat.set(r.seat, st.evaluate7([r.cards[0], r.cards[1], ...st.board]));
  }

  awardPots(st, events, (eligible) => {
    let best = Infinity;
    for (const seatNo of eligible) {
      const score = must(scoreBySeat.get(seatNo), `score for seat ${seatNo}`);
      if (score < best) best = score;
    }
    return eligible.filter((seatNo) => scoreBySeat.get(seatNo) === best);
  });
  finishHand(st, events);
}

/**
 * Resolve a closed betting round: uncontested award, or deal the next
 * street(s) — running out the whole board when no betting remains — or run
 * the showdown. Sets `actionSeat` when betting resumes.
 */
export function advance(st: MutableState, events: HandEvent[]): void {
  for (;;) {
    if (nonFoldedCount(st) === 1) {
      // Uncontested: award without showdown, hole cards stay hidden.
      awardPots(st, events, (eligible) => [...eligible]);
      finishHand(st, events);
      return;
    }
    if (st.street === "river") {
      runShowdown(st, events);
      return;
    }

    const next = must(NEXT_STREET[st.street], "next street");
    const count = next === "flop" ? 3 : 1;
    const cards: number[] = [];
    for (let k = 0; k < count; k++) {
      cards.push(must(st.deck[st.deckCursor], "deck card"));
      st.deckCursor++;
    }
    st.board.push(...cards);
    st.street = next;
    events.push({ t: "board", street: next, cards });

    for (const s of st.seats) {
      s.committedStreet = 0;
      s.actedThisRound = false;
    }
    st.currentBet = 0;
    st.minRaise = st.blinds.bb;
    // Keep the final aggressor for reveal order during an all-in runout;
    // reset only when another betting round will actually happen.
    if (actionableCount(st) >= 2) st.lastAggressor = null;

    const nxt = nextActorFrom(st, buttonIndex(st));
    if (nxt !== null) {
      st.actionSeat = must(st.seats[nxt], "next actor").seat;
      return;
    }
  }
}
