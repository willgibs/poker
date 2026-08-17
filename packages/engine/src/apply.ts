/**
 * applyAction — validate one player action against the exact `legalActions`
 * menu (menu and validation share one code path and cannot diverge), apply
 * it, then advance: pass the action pointer on, or close the betting round —
 * dealing further streets, running out all-in boards, and settling showdowns
 * or uncontested pots as needed. Throws EngineError on any illegal input;
 * the input state is never mutated.
 */

import type { HandEvent } from "@poker/history";
import { EngineError } from "./errors";
import {
  cloneState,
  commit,
  must,
  nextActorFrom,
  nonFoldedCount,
  seatIndexOf,
  type MutableSeat,
  type MutableState,
} from "./internal";
import { advance } from "./lifecycle";
import { legalActions } from "./legal";
import type { ActionInput, EngineResult, TableState } from "./types";

function illegal(message: string): never {
  throw new EngineError("illegal_action", message);
}

function requireNoAmount(input: ActionInput): void {
  if (input.amount !== undefined) {
    throw new EngineError("illegal_amount", `${input.kind} must not carry an amount`);
  }
}

function requireAmount(input: ActionInput): number {
  const a = input.amount;
  if (a === undefined || !Number.isSafeInteger(a) || a < 1) {
    throw new EngineError(
      "illegal_amount",
      `${input.kind} requires a positive integer amount, got ${a}`,
    );
  }
  return a;
}

/** Clear everyone else's acted flag: a full bet/raise reopens the action. */
function reopenOthers(st: MutableState, actor: MutableSeat): void {
  for (const s of st.seats) {
    if (s !== actor) s.actedThisRound = false;
  }
}

export function applyAction(state: TableState, input: ActionInput): EngineResult {
  if (state.handOver) throw new EngineError("hand_over", "the hand is over");
  if (state.actionSeat === null) {
    throw new EngineError("invariant", "no seat to act on a live hand");
  }
  seatIndexOf(state, input.seat); // throws unknown_seat
  if (input.seat !== state.actionSeat) {
    throw new EngineError(
      "out_of_turn",
      `seat ${input.seat} acted out of turn (action is on seat ${state.actionSeat})`,
    );
  }

  const menu = legalActions(state);
  const st = cloneState(state);
  const actorIdx = seatIndexOf(st, input.seat);
  const actor = must(st.seats[actorIdx], "acting seat");
  const events: HandEvent[] = [];

  switch (input.kind) {
    case "fold": {
      if (menu.fold === undefined) illegal("fold is not available");
      requireNoAmount(input);
      actor.folded = true;
      actor.actedThisRound = true;
      events.push({ t: "act", seat: actor.seat, kind: "fold" });
      break;
    }
    case "check": {
      if (menu.check === undefined) illegal("cannot check facing a bet");
      requireNoAmount(input);
      actor.actedThisRound = true;
      events.push({ t: "act", seat: actor.seat, kind: "check" });
      break;
    }
    case "call": {
      const call = menu.call;
      if (call === undefined) illegal("nothing to call");
      if (input.amount !== undefined && input.amount !== call.amount) {
        throw new EngineError(
          "illegal_amount",
          `call amount must be ${call.amount}, got ${input.amount}`,
        );
      }
      commit(actor, call.amount);
      actor.actedThisRound = true;
      events.push({ t: "act", seat: actor.seat, kind: "call", amount: call.amount });
      break;
    }
    case "bet": {
      const bet = menu.bet;
      if (bet === undefined) illegal("betting is not available (facing a bet: raise instead)");
      const amount = requireAmount(input);
      if (amount < bet.min || amount > bet.max) {
        throw new EngineError(
          "illegal_amount",
          `bet must be between ${bet.min} and ${bet.max}, got ${amount}`,
        );
      }
      commit(actor, amount);
      st.currentBet = actor.committedStreet;
      // A full bet resets the raise unit and reopens action; an all-in bet
      // short of the minimum does neither.
      if (amount >= st.minRaise) {
        st.minRaise = amount;
        reopenOthers(st, actor);
      }
      st.lastAggressor = actor.seat;
      actor.actedThisRound = true;
      events.push({ t: "act", seat: actor.seat, kind: "bet", amount });
      break;
    }
    case "raise": {
      const raise = menu.raise;
      if (raise === undefined) illegal("raising is not available");
      const to = requireAmount(input);
      if (to < raise.minTo || to > raise.maxTo) {
        throw new EngineError(
          "illegal_amount",
          `raise must be to between ${raise.minTo} and ${raise.maxTo}, got ${to}`,
        );
      }
      const increment = to - st.currentBet;
      commit(actor, to - actor.committedStreet);
      st.currentBet = to;
      // A full raise resets the raise unit and reopens action; an all-in
      // raise short of a full raise does neither (seats that already acted
      // may then only call or fold).
      if (increment >= st.minRaise) {
        st.minRaise = increment;
        reopenOthers(st, actor);
      }
      st.lastAggressor = actor.seat;
      actor.actedThisRound = true;
      events.push({ t: "act", seat: actor.seat, kind: "raise", toAmount: to });
      break;
    }
    default:
      illegal(`unknown action kind ${String(input.kind)}`);
  }

  if (nonFoldedCount(st) === 1) {
    // Everyone else folded: settle immediately, no showdown.
    st.actionSeat = null;
    advance(st, events);
  } else {
    const nxt = nextActorFrom(st, actorIdx);
    if (nxt !== null) {
      st.actionSeat = must(st.seats[nxt], "next actor").seat;
    } else {
      st.actionSeat = null;
      advance(st, events);
    }
  }

  return { state: st, events };
}
