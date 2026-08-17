/**
 * Canonical hand event log — type definitions, format version 1.
 *
 * Normative spec: docs/hand-format.md. Changes here must be reflected there
 * in the same PR, and must follow the versioning policy (additive-only within v1).
 */

/**
 * Card as an int 0–51: `card = rank * 4 + suit`.
 * rank 0=2 … 12=A; suit 0=club, 1=diamond, 2=heart, 3=spade.
 * Structurally identical to `@poker/core`'s Card; aliased here so the log
 * format is self-describing.
 */
export type Card = number;

export type Street = "preflop" | "flop" | "turn" | "river";
export type BoardStreet = "flop" | "turn" | "river";
export type BlindKind = "sb" | "bb" | "ante";
export type ActionKind = "fold" | "check" | "call" | "bet" | "raise";

/** First event of every hand. Chips are integer cents throughout. */
export interface HandStart {
  t: "start";
  /** 1-based hand number within the session. */
  handNumber: number;
  /** Seat number of the button; must be one of `seats`. */
  button: number;
  /** Seats dealt into this hand with their starting stacks (cents). */
  seats: Array<{ seat: number; stack: number }>;
  /** Blind structure in force for this hand (cents). */
  blinds: { sb: number; bb: number; ante: number };
}

/** A forced posting (small blind, big blind, or ante). */
export interface PostBlind {
  t: "post";
  seat: number;
  kind: BlindKind;
  /** Chips actually posted (may be short of the nominal blind when all-in). */
  amount: number;
}

/** Hole cards dealt to one seat. */
export interface DealHole {
  t: "hole";
  seat: number;
  cards: [Card, Card];
}

/**
 * A voluntary player action.
 * - `call`: `amount` = chips added to the pot by the call.
 * - `bet`: `amount` = size of the bet.
 * - `raise`: `toAmount` = total chips committed by this seat on this street
 *   after the raise (`amount` is not set on raises).
 * - `fold` / `check`: neither `amount` nor `toAmount`.
 * - `thinkTimeMs`: optional observed think time (time is an input, never read).
 */
export interface PlayerAction {
  t: "act";
  seat: number;
  kind: ActionKind;
  amount?: number;
  toAmount?: number;
  thinkTimeMs?: number;
}

/** Community cards dealt for a street (flop: 3 cards; turn/river: 1). */
export interface DealBoard {
  t: "board";
  street: BoardStreet;
  cards: Card[];
}

/** Hole cards revealed at showdown, in reveal order. */
export interface Showdown {
  t: "showdown";
  reveals: Array<{ seat: number; cards: [Card, Card] }>;
}

/** One pot (or side pot) awarded to one seat. potIndex 0 = main pot. */
export interface PotAwarded {
  t: "pot";
  potIndex: number;
  seat: number;
  amount: number;
}

/** Final event: per-seat net chip result for the hand (cents; sums to 0). */
export interface HandEnd {
  t: "end";
  net: Array<{ seat: number; net: number }>;
}

/** Discriminated union of every v1 event, on `t`. */
export type HandEvent =
  | HandStart
  | PostBlind
  | DealHole
  | PlayerAction
  | DealBoard
  | Showdown
  | PotAwarded
  | HandEnd;

/** Table configuration the hand was played under. Additive-only within v1. */
export interface TableConfig {
  variant: "nlhe";
  maxSeats: number;
  /** Small blind in cents. */
  sb: number;
  /** Big blind in cents. */
  bb: number;
  /** Ante in cents (0 when none). */
  ante: number;
}

/** Current hand-record format version. */
export const HAND_RECORD_VERSION = 1;

/**
 * The canonical hand record envelope.
 * `annotations` is keyed by decisionId `${street}:${seat}:${n}` (see
 * decision.ts) and is opaque in v1 — producers/consumers agree out of band.
 */
export interface HandRecord {
  v: 1;
  /** Globally unique hand id. */
  id: string;
  /** Session this hand belongs to. */
  sessionId: string;
  /** Hand seed (from the session seed hierarchy); replay input. */
  seed: string;
  config: TableConfig;
  events: HandEvent[];
  annotations?: Record<string, unknown>;
}
