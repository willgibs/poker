/**
 * Stage 1 — context build.
 *
 * Turns engine truth plus the event log into the flat set of facts every later
 * stage reads: pot, price, SPR, position, the betting line, and the board's
 * texture. Nothing here is persona-dependent; two different characters facing
 * the same spot build the identical context, which is what makes the trace
 * comparable across the cast.
 */

import { positionOf, type Card, type PositionLabel } from "@poker/core";
import { legalActions, type LegalActions, type SeatState, type TableState } from "@poker/engine";
import { potOdds } from "@poker/equity";
import type { ActionKind, Street } from "@poker/history";
import { lineFeatures, scanHand, type HandScan, type LineFeatures } from "./eventscan";
import { classifyTexture, isScareCard, type BoardTexture } from "./texture";
import type { DecisionSnapshot } from "./types";

export interface DecisionContext {
  street: Street;
  seat: number;
  /** 1-based hand number within the session, from engine truth. */
  handNumber: number;
  position: PositionLabel;
  /** Number of dealt-in seats — the table size positions are derived from. */
  tableSize: number;
  /** Seats still live (not folded), excluding the bot. */
  opponents: readonly number[];
  /** True when the bot acts last among live players on this street. */
  inPosition: boolean;
  headsUp: boolean;
  /** Total pot including every commitment made so far (cents). */
  pot: number;
  /** Chips required to continue (cents); 0 when checking is available. */
  toCall: number;
  /** Street bet level to match (cents), straight from engine truth. */
  currentBet: number;
  /** The bot's remaining stack (cents). */
  stack: number;
  /** Effective stack against the deepest live opponent (cents). */
  effectiveStack: number;
  /** Effective stack / pot; capped at 100 when the pot is tiny. */
  spr: number;
  bb: number;
  potBb: number;
  /** Equity required to break even on the call, [0, 1). */
  potOddsRequired: number;
  facingBet: boolean;
  isPreflop: boolean;
  board: readonly Card[];
  hole: readonly [Card, Card];
  texture: BoardTexture;
  scareCard: boolean;
  line: LineFeatures;
  legal: LegalActions;
  legalKinds: readonly ActionKind[];
  scan: HandScan;
  /** The bot's own seat state. */
  self: SeatState;
  /** The injected seven-card evaluator (lower = stronger), from engine truth. */
  evaluate7: (cards: number[]) => number;
}

function liveSeats(state: TableState): SeatState[] {
  return state.seats.filter((s) => !s.folded);
}

/**
 * Postflop action-order key: the button acts last, so it sorts highest.
 * Offset 0 is the button (see `@poker/core` positions contract).
 */
function orderKey(offset: number, tableSize: number): number {
  return offset === 0 ? tableSize : offset;
}

/** Offset of `seat` from the button in clockwise (ascending, wrapping) order. */
export function offsetFromButton(state: TableState, seat: number): number {
  const n = state.seats.length;
  let btnIdx = -1;
  let myIdx = -1;
  for (let i = 0; i < n; i++) {
    const s = state.seats[i];
    if (s === undefined) continue;
    if (s.seat === state.button) btnIdx = i;
    if (s.seat === seat) myIdx = i;
  }
  if (btnIdx < 0 || myIdx < 0) throw new RangeError(`seat ${seat} or button ${state.button} not dealt in`);
  return (myIdx - btnIdx + n) % n;
}

/** Build the decision context (stage 1). */
export function buildContext(snapshot: DecisionSnapshot): DecisionContext {
  const { state, seat } = snapshot;
  const self = state.seats.find((s) => s.seat === seat);
  if (self === undefined) throw new RangeError(`seat ${seat} is not dealt into this hand`);
  if (self.holeCards === null) throw new RangeError(`seat ${seat} has no hole cards`);

  const legal = snapshot.legal ?? legalActions(state);
  const legalKinds: ActionKind[] = [];
  if (legal.fold) legalKinds.push("fold");
  if (legal.check) legalKinds.push("check");
  if (legal.call) legalKinds.push("call");
  if (legal.bet) legalKinds.push("bet");
  if (legal.raise) legalKinds.push("raise");

  let pot = 0;
  for (const s of state.seats) pot += s.committedTotal;

  const live = liveSeats(state);
  const opponents = live.filter((s) => s.seat !== seat).map((s) => s.seat);

  const toCall = legal.call?.amount ?? 0;
  const tableSize = state.seats.length;
  const myOffset = offsetFromButton(state, seat);
  const position = positionOf(tableSize, myOffset);

  let maxOppRemaining = 0;
  for (const s of live) {
    if (s.seat === seat) continue;
    const remaining = s.stack + s.committedStreet;
    if (remaining > maxOppRemaining) maxOppRemaining = remaining;
  }
  const effectiveStack = Math.min(self.stack + self.committedStreet, maxOppRemaining);

  const myKey = orderKey(myOffset, tableSize);
  let inPosition = true;
  for (const s of live) {
    if (s.seat === seat) continue;
    if (orderKey(offsetFromButton(state, s.seat), tableSize) > myKey) inPosition = false;
  }

  const board = state.board;
  const scan = scanHand(snapshot.events);
  const line = lineFeatures(scan, seat);
  const bb = state.blinds.bb;

  return {
    street: state.street,
    seat,
    handNumber: state.handNumber,
    position,
    tableSize,
    opponents,
    inPosition,
    headsUp: opponents.length === 1,
    pot,
    toCall,
    currentBet: state.currentBet,
    stack: self.stack,
    effectiveStack,
    spr: pot > 0 ? effectiveStack / pot : 100,
    bb,
    potBb: bb > 0 ? pot / bb : 0,
    potOddsRequired: potOdds(pot, toCall),
    facingBet: toCall > 0,
    isPreflop: state.street === "preflop",
    board,
    hole: self.holeCards,
    texture: classifyTexture(board),
    scareCard: isScareCard(board),
    line,
    legal,
    legalKinds,
    scan,
    self,
    evaluate7: state.evaluate7,
  };
}
