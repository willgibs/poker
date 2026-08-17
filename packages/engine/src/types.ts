/**
 * Public types of the pure NLHE reducer.
 *
 * The engine is `(TableState, Action) → { state, events }`: no hidden state,
 * no time, no randomness. The caller supplies a pre-shuffled 52-card
 * `deckOrder` and an injected 7-card evaluator; the engine owns only the
 * rules. Chips are integer cents throughout; cards are ints 0–51.
 *
 * Dealing conventions (deterministic, locked by golden fixtures):
 * - Hole cards: clockwise starting one seat left of the button, TWO
 *   consecutive deck cards per seat (button dealt last).
 * - Board: NO burn cards — the flop is the next 3 cards after the last hole
 *   card, the turn the next 1, the river the next 1. Burns add nothing when
 *   the deck order is already an explicit input.
 */

import type { Card } from "@poker/core";
import type { ActionKind, HandEvent, Street } from "@poker/history";

/** Injected 7-card evaluator. LOWER return value = stronger hand. */
export type Evaluate7 = (cards: number[]) => number;

export interface SeatConfig {
  /** Stable seat number (non-negative integer, unique per hand). */
  seat: number;
  /** Starting stack in cents (must be >= 1). */
  stack: number;
}

/** Input to `initHand`. */
export interface HandConfig {
  /** 1-based hand number within the session. */
  handNumber: number;
  /** Seat number of the button; must be one of `seats`. */
  button: number;
  /** Dealt-in seats (2–9). Order is irrelevant; the engine sorts by seat. */
  seats: SeatConfig[];
  /** Blind structure in cents. `bb` must be >= 1; `sb`/`ante` >= 0. */
  blinds: { sb: number; bb: number; ante: number };
  /** Full 52-card deck, pre-shuffled by the caller. */
  deckOrder: Card[];
  /** Injected evaluator (lower = stronger); the engine has no eval dep. */
  evaluate7: Evaluate7;
}

/** Per-seat state. Antes count in `committedTotal` but not `committedStreet`. */
export interface SeatState {
  readonly seat: number;
  /** Stack at hand start (cents). */
  readonly startingStack: number;
  /** Chips behind (cents). */
  readonly stack: number;
  /** Chips committed this betting round (excludes antes). */
  readonly committedStreet: number;
  /** Chips committed this hand in total (includes antes). */
  readonly committedTotal: number;
  readonly folded: boolean;
  readonly allIn: boolean;
  /**
   * True once this seat has voluntarily acted since the street began or since
   * the last FULL bet/raise. A full bet/raise clears the flag for everyone
   * else (action reopens); an all-in wager short of a full raise does not —
   * seats with the flag set may then only call or fold. Blind/ante posts do
   * not set it (that is what gives the big blind its option).
   */
  readonly actedThisRound: boolean;
  /** Dealt hole cards, or null before the deal. */
  readonly holeCards: readonly [Card, Card] | null;
  /** Total chips awarded to this seat from pots this hand. */
  readonly awarded: number;
}

export interface TableState {
  readonly handNumber: number;
  readonly button: number;
  readonly blinds: { readonly sb: number; readonly bb: number; readonly ante: number };
  /** Seats sorted ascending by seat number; clockwise = ascending, wrapping. */
  readonly seats: readonly SeatState[];
  readonly street: Street;
  readonly board: readonly Card[];
  /** The injected deck order (all 52 cards). */
  readonly deck: readonly Card[];
  /** Next undealt index into `deck`. */
  readonly deckCursor: number;
  /** Seat number to act, or null (hand over / between decisions). */
  readonly actionSeat: number | null;
  /**
   * Street bet level to match (cents). Preflop this is the nominal big blind
   * even when the big blind posted short all-in.
   */
  readonly currentBet: number;
  /**
   * Size of the last full bet/raise increment (cents); the minimum next
   * raise increment. Initialized to the big blind each street.
   */
  readonly minRaise: number;
  /** Seat of the last bet/raise this betting round (reveal order), or null. */
  readonly lastAggressor: number | null;
  readonly handOver: boolean;
  readonly evaluate7: Evaluate7;
}

/** Input to `applyAction`. For `bet`, `amount` is the bet size; for `raise`
 * it is the raise-TO total street commitment; for `call` it is optional and,
 * when present, must equal the exact call amount; `fold`/`check` carry none. */
export interface ActionInput {
  seat: number;
  kind: ActionKind;
  amount?: number;
}

export interface EngineResult {
  state: TableState;
  events: HandEvent[];
}

/**
 * Precise action menu for the seat currently to act ({} when no one acts).
 * Every value inside a `bet`/`raise` interval is legal — short-of-minimum
 * all-in sizings are encoded by clamping `min`/`minTo` to the stack.
 */
export interface LegalActions {
  fold?: true;
  check?: true;
  call?: { amount: number };
  bet?: { min: number; max: number };
  raise?: { minTo: number; maxTo: number };
}
