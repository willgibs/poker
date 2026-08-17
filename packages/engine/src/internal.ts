/**
 * Internal mutable working state + seat-order helpers.
 *
 * The public reducer never mutates its input: `cloneState` produces a fresh
 * mutable copy (seats and board copied; the deck is shared — it is never
 * written). All mutation happens on the clone, which is then returned as the
 * readonly public `TableState`.
 */

import { EngineError } from "./errors";
import type { Evaluate7, TableState } from "./types";
import type { Street } from "@poker/history";

export function must<T>(v: T | undefined, what: string): T {
  if (v === undefined) {
    throw new EngineError("invariant", `internal invariant violated: missing ${what}`);
  }
  return v;
}

export interface MutableSeat {
  seat: number;
  startingStack: number;
  stack: number;
  committedStreet: number;
  committedTotal: number;
  folded: boolean;
  allIn: boolean;
  actedThisRound: boolean;
  holeCards: readonly [number, number] | null;
  awarded: number;
}

export interface MutableState {
  handNumber: number;
  button: number;
  blinds: { sb: number; bb: number; ante: number };
  seats: MutableSeat[];
  street: Street;
  board: number[];
  deck: readonly number[];
  deckCursor: number;
  actionSeat: number | null;
  currentBet: number;
  minRaise: number;
  lastAggressor: number | null;
  handOver: boolean;
  evaluate7: Evaluate7;
}

export function cloneState(s: TableState): MutableState {
  return {
    handNumber: s.handNumber,
    button: s.button,
    blinds: { sb: s.blinds.sb, bb: s.blinds.bb, ante: s.blinds.ante },
    seats: s.seats.map((seat) => ({
      seat: seat.seat,
      startingStack: seat.startingStack,
      stack: seat.stack,
      committedStreet: seat.committedStreet,
      committedTotal: seat.committedTotal,
      folded: seat.folded,
      allIn: seat.allIn,
      actedThisRound: seat.actedThisRound,
      holeCards: seat.holeCards,
      awarded: seat.awarded,
    })),
    street: s.street,
    board: [...s.board],
    deck: s.deck,
    deckCursor: s.deckCursor,
    actionSeat: s.actionSeat,
    currentBet: s.currentBet,
    minRaise: s.minRaise,
    lastAggressor: s.lastAggressor,
    handOver: s.handOver,
    evaluate7: s.evaluate7,
  };
}

/** Index into `state.seats` for a seat number; throws on unknown seat. */
export function seatIndexOf(state: TableState, seat: number): number {
  const idx = state.seats.findIndex((s) => s.seat === seat);
  if (idx < 0) throw new EngineError("unknown_seat", `seat ${seat} is not dealt in`);
  return idx;
}

export function buttonIndex(state: TableState): number {
  return seatIndexOf(state, state.button);
}

/** Seat indices clockwise starting AT `startIdx` (length = seat count). */
export function clockwiseFrom(state: TableState, startIdx: number): number[] {
  const n = state.seats.length;
  const out: number[] = [];
  for (let k = 0; k < n; k++) out.push((startIdx + k) % n);
  return out;
}

/** Clockwise distance from the seat left of the button (0 = SB position; button = n-1). */
export function rankFromButton(state: TableState, seat: number): number {
  const n = state.seats.length;
  return (seatIndexOf(state, seat) - buttonIndex(state) - 1 + n) % n;
}

/** A seat that can still put chips in voluntarily: not folded, not all-in. */
export function isActionable(state: TableState, idx: number): boolean {
  const s = must(state.seats[idx], `seat index ${idx}`);
  return !s.folded && !s.allIn;
}

export function actionableCount(state: TableState): number {
  let n = 0;
  for (let i = 0; i < state.seats.length; i++) if (isActionable(state, i)) n++;
  return n;
}

export function nonFoldedCount(state: TableState): number {
  return state.seats.filter((s) => !s.folded).length;
}

/**
 * Does this seat still owe a decision this betting round?
 * - Facing chips: committedStreet < currentBet.
 * - Or unacted with at least one OTHER actionable opponent (an option is only
 *   real if someone with chips could respond; a lone live player facing only
 *   shorter all-ins has nothing to decide — the hand runs out).
 */
export function needsAction(state: TableState, idx: number): boolean {
  if (!isActionable(state, idx)) return false;
  const s = must(state.seats[idx], `seat index ${idx}`);
  if (s.committedStreet < state.currentBet) return true;
  if (s.actedThisRound) return false;
  for (let j = 0; j < state.seats.length; j++) {
    if (j !== idx && isActionable(state, j)) return true;
  }
  return false;
}

/**
 * Next seat index owing a decision, scanning clockwise starting AFTER
 * `fromIdx` (a full circle, ending with `fromIdx` itself). Null = round closed.
 */
export function nextActorFrom(state: TableState, fromIdx: number): number | null {
  const n = state.seats.length;
  for (let k = 1; k <= n; k++) {
    const idx = (fromIdx + k) % n;
    if (needsAction(state, idx)) return idx;
  }
  return null;
}

/** Move chips from stack to this street's + the hand's committed. */
export function commit(seat: MutableSeat, amount: number): void {
  if (amount < 0 || amount > seat.stack) {
    throw new EngineError("invariant", `commit ${amount} exceeds stack ${seat.stack}`);
  }
  seat.stack -= amount;
  seat.committedStreet += amount;
  seat.committedTotal += amount;
  if (seat.stack === 0) seat.allIn = true;
}

/** Ante: into the pot (committedTotal) but not toward the street bet level. */
export function commitAnte(seat: MutableSeat, amount: number): void {
  if (amount < 0 || amount > seat.stack) {
    throw new EngineError("invariant", `ante ${amount} exceeds stack ${seat.stack}`);
  }
  seat.stack -= amount;
  seat.committedTotal += amount;
  if (seat.stack === 0) seat.allIn = true;
}
