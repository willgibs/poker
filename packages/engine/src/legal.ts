/**
 * legalActions — the precise action menu for the seat to act.
 *
 * NLHE rules encoded here (applyAction validates against this same menu, so
 * menu and validation cannot diverge):
 * - fold is always available on your turn (open-folding is legal poker);
 * - check iff the street commitment already matches `currentBet`;
 * - call iff facing chips, capped at stack (all-in call for less);
 * - bet iff no bet yet this street (`currentBet === 0`); min = big blind,
 *   max = stack; a stack below the min bet may only go all-in (min clamps);
 * - raise iff facing a bet level, holding chips beyond a call, AND action is
 *   open to this seat (`!actedThisRound`) — an all-in short of a full raise
 *   does not reopen action for seats that already acted. minTo =
 *   currentBet + minRaise (the last full raise, or the big blind), clamped
 *   down to the all-in total when the stack cannot make a full raise;
 *   maxTo = full stack (no-limit). Every value in [min,max] / [minTo,maxTo]
 *   is legal.
 */

import { must, seatIndexOf } from "./internal";
import type { LegalActions, TableState } from "./types";

export function legalActions(state: TableState): LegalActions {
  if (state.handOver || state.actionSeat === null) return {};
  const s = must(state.seats[seatIndexOf(state, state.actionSeat)], "acting seat");

  const out: LegalActions = { fold: true };
  const toCall = state.currentBet - s.committedStreet;
  if (toCall <= 0) {
    out.check = true;
  } else {
    out.call = { amount: Math.min(toCall, s.stack) };
  }

  if (state.currentBet === 0) {
    out.bet = { min: Math.min(state.minRaise, s.stack), max: s.stack };
  } else if (!s.actedThisRound) {
    const maxTo = s.committedStreet + s.stack;
    if (maxTo > state.currentBet) {
      out.raise = { minTo: Math.min(state.currentBet + state.minRaise, maxTo), maxTo };
    }
  }
  return out;
}
