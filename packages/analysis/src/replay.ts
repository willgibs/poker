/**
 * Hand-record reconstruction: the event log turned into a decision-by-decision
 * view every analysis module reads.
 *
 * The hand format is deliberately minimal — it records *what happened*, not
 * derived state. Grading, leak stats and the HUD all need the same derived
 * state (pot before each action, price to call, who is still live, which
 * street, what position), so it is reconstructed exactly once, here.
 *
 * ## Chip bookkeeping
 *
 * Mirrors the engine: `committedStreet` excludes antes, `committedTotal`
 * includes them, and the pot at any moment is the sum of every seat's
 * `committedTotal`. All chip fields stay integer cents.
 *
 * ## Privacy
 *
 * {@link publicEvents} strips `hole` events for seats other than the hero.
 * The earned HUD builds its view from that projection, so villain hole cards
 * are not merely unread — they are structurally absent from the data the HUD
 * ever sees. Showdown reveals survive: those hero legitimately saw.
 */

import { type PositionLabel, MAX_TABLE_SIZE, MIN_TABLE_SIZE, positionOf } from "@poker/core";
import {
  type ActionKind,
  type Card,
  type HandEvent,
  type HandRecord,
  type Street,
  type TableConfig,
  decisionRefs,
} from "@poker/history";

/** Per-seat summary for one hand. */
export interface SeatView {
  seat: number;
  /** Stack at hand start, cents. */
  startingStack: number;
  /** 0 = button, then clockwise (ascending seat, wrapping). */
  seatFromButton: number;
  position: PositionLabel;
  /** Forced postings (blinds + antes) in cents. */
  posted: number;
  /** Hole cards from a `hole` event, when present in the projection used. */
  holeCards: readonly [Card, Card] | null;
  /** Hole cards from the `showdown` event — what hero legitimately saw. */
  revealed: readonly [Card, Card] | null;
  /** Net chips for the hand from the `end` event, cents (may be negative). */
  net: number;
  /** Total chips awarded from `pot` events, cents. */
  awarded: number;
  /** True when the seat folded at some point. */
  folded: boolean;
  /** True when the seat was still live when the flop was dealt. */
  sawFlop: boolean;
  /** True when the seat reached showdown (revealed, or won a pot at showdown). */
  wentToShowdown: boolean;
}

/** One `act` event with all the derived state a grader needs. */
export interface ActionView {
  /** Index into `record.events`. */
  eventIndex: number;
  /** `${street}:${seat}:${n}` — identical to `decisionRefs` in @poker/history. */
  decisionId: string;
  street: Street;
  seat: number;
  kind: ActionKind;
  /** Chips this action added to the pot (0 for check/fold). */
  invested: number;
  /** Pot before the action: every seat's total commitment so far. */
  potBefore: number;
  /** Chips needed to continue, capped by the seat's stack. 0 = check is legal. */
  toCall: number;
  /** Stack before the action, cents. */
  stackBefore: number;
  /** This seat's street commitment before the action, cents. */
  committedStreetBefore: number;
  /** Seats not yet folded when the action happens, hero included. */
  livePlayers: number;
  /** Board as of this action (0/3/4/5 cards). */
  board: readonly Card[];
  /** Prior bet/raise actions on this street. 0 = first aggression. */
  aggressionIndex: number;
  /** True when the seat is all-in after the action. */
  allIn: boolean;
  /** Bet/raise size as a fraction of `potBefore` (0 for fold/check/call). */
  sizeFraction: number;
}

/** A whole hand, reconstructed. */
export interface HandView {
  id: string;
  sessionId: string;
  seed: string;
  config: TableConfig;
  handNumber: number;
  button: number;
  /** Big blind in cents (from the `start` event's blind structure). */
  bb: number;
  /** Number of seats dealt in — the effective table size for positions. */
  tableSize: number;
  /** Seats ascending by seat number. */
  seats: readonly SeatView[];
  actions: readonly ActionView[];
  /** Final board (0-5 cards). */
  board: readonly Card[];
  /** True when the hand reached a `showdown` event. */
  showdown: boolean;
  /** Total chips awarded across all pots, cents. */
  potTotal: number;
}

/** Thrown when a record cannot be reconstructed (structurally broken log). */
export class ReplayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplayError";
  }
}

/**
 * The projection of an event log that a player at `heroSeat` legitimately saw:
 * every `hole` event for another seat is removed. Showdown reveals, board
 * cards and all actions are public and pass through untouched.
 *
 * Pass `heroSeat: null` for a pure-spectator projection (no hole cards at all).
 */
export function publicEvents(events: readonly HandEvent[], heroSeat: number | null): HandEvent[] {
  return events.filter((e) => e.t !== "hole" || e.seat === heroSeat);
}

function seatOrderFromButton(seats: readonly number[], button: number): number[] {
  const sorted = [...seats].sort((a, b) => a - b);
  const at = sorted.indexOf(button);
  if (at < 0) throw new ReplayError(`button seat ${button} is not dealt in`);
  return [...sorted.slice(at), ...sorted.slice(0, at)];
}

interface Mutable {
  stack: number;
  committedStreet: number;
  committedTotal: number;
  folded: boolean;
  posted: number;
}

/**
 * Reconstruct a hand record. `events` defaults to `record.events`; pass a
 * {@link publicEvents} projection to reconstruct from what a player saw.
 *
 * Throws {@link ReplayError} on a log this package cannot make sense of
 * (missing `start`, unknown seat, non-integer chips). Betting legality is the
 * engine's business, not ours — we reconstruct what the log says happened.
 */
export function buildHandView(record: HandRecord, events?: readonly HandEvent[]): HandView {
  const log = events ?? record.events;
  const start = log.find((e) => e.t === "start");
  if (start === undefined || start.t !== "start") {
    throw new ReplayError("hand record has no start event");
  }
  const seatNumbers = start.seats.map((s) => s.seat);
  if (seatNumbers.length < MIN_TABLE_SIZE || seatNumbers.length > MAX_TABLE_SIZE) {
    throw new ReplayError(
      `hand has ${seatNumbers.length} dealt-in seats (expected ${MIN_TABLE_SIZE}-${MAX_TABLE_SIZE})`,
    );
  }
  const tableSize = seatNumbers.length;
  const order = seatOrderFromButton(seatNumbers, start.button);

  const state = new Map<number, Mutable>();
  const views = new Map<number, SeatView>();
  for (const s of start.seats) {
    state.set(s.seat, {
      stack: s.stack,
      committedStreet: 0,
      committedTotal: 0,
      folded: false,
      posted: 0,
    });
    const seatFromButton = order.indexOf(s.seat);
    views.set(s.seat, {
      seat: s.seat,
      startingStack: s.stack,
      seatFromButton,
      position: positionOf(tableSize, seatFromButton),
      posted: 0,
      holeCards: null,
      revealed: null,
      net: 0,
      awarded: 0,
      folded: false,
      sawFlop: false,
      wentToShowdown: false,
    });
  }

  const must = (seat: number): Mutable => {
    const m = state.get(seat);
    if (m === undefined) throw new ReplayError(`event references seat ${seat}, which is not dealt in`);
    return m;
  };
  const view = (seat: number): SeatView => {
    const v = views.get(seat);
    if (v === undefined) throw new ReplayError(`event references seat ${seat}, which is not dealt in`);
    return v;
  };

  const idByEventIndex = new Map<number, string>();
  for (const ref of decisionRefs(log)) idByEventIndex.set(ref.eventIndex, ref.id);

  const actions: ActionView[] = [];
  const board: Card[] = [];
  let street: Street = "preflop";
  let aggressionIndex = 0;
  let showdown = false;
  let potTotal = 0;

  const potNow = (): number => {
    let sum = 0;
    for (const m of state.values()) sum += m.committedTotal;
    return sum;
  };
  const liveNow = (): number => {
    let n = 0;
    for (const m of state.values()) if (!m.folded) n++;
    return n;
  };
  const maxStreetNow = (): number => {
    let max = 0;
    for (const m of state.values()) if (m.committedStreet > max) max = m.committedStreet;
    return max;
  };

  for (let i = 0; i < log.length; i++) {
    const e = log[i];
    if (e === undefined) continue;
    switch (e.t) {
      case "start":
        break;
      case "post": {
        const m = must(e.seat);
        m.stack -= e.amount;
        m.committedTotal += e.amount;
        m.posted += e.amount;
        if (e.kind !== "ante") m.committedStreet += e.amount;
        view(e.seat).posted = m.posted;
        break;
      }
      case "hole": {
        const v = view(e.seat);
        views.set(e.seat, { ...v, holeCards: [e.cards[0], e.cards[1]] });
        break;
      }
      case "board": {
        if (street === "preflop") {
          for (const [seat, m] of state) {
            if (!m.folded) views.set(seat, { ...view(seat), sawFlop: true });
          }
        }
        street = e.street;
        aggressionIndex = 0;
        for (const m of state.values()) m.committedStreet = 0;
        for (const c of e.cards) board.push(c);
        break;
      }
      case "act": {
        const m = must(e.seat);
        const potBefore = potNow();
        const owed = maxStreetNow() - m.committedStreet;
        const toCall = Math.max(0, Math.min(owed, m.stack));
        let invested = 0;
        if (e.kind === "call") invested = e.amount ?? 0;
        else if (e.kind === "bet") invested = e.amount ?? 0;
        else if (e.kind === "raise") invested = (e.toAmount ?? 0) - m.committedStreet;
        if (!Number.isInteger(invested) || invested < 0) {
          throw new ReplayError(`event ${i}: non-integer chips invested (${invested})`);
        }
        const stackBefore = m.stack;
        const committedStreetBefore = m.committedStreet;
        const aggressive = e.kind === "bet" || e.kind === "raise";
        actions.push({
          eventIndex: i,
          decisionId: idByEventIndex.get(i) ?? `${street}:${e.seat}:0`,
          street,
          seat: e.seat,
          kind: e.kind,
          invested,
          potBefore,
          toCall,
          stackBefore,
          committedStreetBefore,
          livePlayers: liveNow(),
          board: board.slice(),
          aggressionIndex,
          allIn: stackBefore - invested === 0,
          sizeFraction: aggressive && potBefore > 0 ? invested / potBefore : 0,
        });
        m.stack -= invested;
        m.committedStreet += invested;
        m.committedTotal += invested;
        if (e.kind === "fold") {
          m.folded = true;
          views.set(e.seat, { ...view(e.seat), folded: true });
        }
        if (aggressive) aggressionIndex++;
        break;
      }
      case "showdown": {
        showdown = true;
        for (const r of e.reveals) {
          views.set(r.seat, {
            ...view(r.seat),
            revealed: [r.cards[0], r.cards[1]],
            wentToShowdown: true,
          });
        }
        break;
      }
      case "pot": {
        potTotal += e.amount;
        const v = view(e.seat);
        views.set(e.seat, { ...v, awarded: v.awarded + e.amount });
        break;
      }
      case "end": {
        for (const n of e.net) views.set(n.seat, { ...view(n.seat), net: n.net });
        break;
      }
      default:
        break;
    }
  }

  // Reaching showdown is not the same as revealing: a seat that mucks face-
  // down still went to showdown. The format records reveals only, so "reached
  // showdown" = a showdown event happened and this seat had not folded.
  if (showdown) {
    for (const [seat, m] of state) {
      if (!m.folded) views.set(seat, { ...view(seat), wentToShowdown: true });
    }
  }
  const seats = [...views.values()].sort((a, b) => a.seat - b.seat);

  return {
    id: record.id,
    sessionId: record.sessionId,
    seed: record.seed,
    config: record.config,
    handNumber: start.handNumber,
    button: start.button,
    bb: start.blinds.bb,
    tableSize,
    seats,
    actions,
    board,
    showdown,
    potTotal,
  };
}

/** The seat view for `seat`, or undefined when not dealt in. */
export function seatView(view: HandView, seat: number): SeatView | undefined {
  return view.seats.find((s) => s.seat === seat);
}

/**
 * Effective stack (cents) for `seat` at hand start: the most that can actually
 * change hands between this seat and the deepest opponent it is still against.
 */
export function effectiveStack(view: HandView, seat: number): number {
  const me = seatView(view, seat);
  if (me === undefined) return 0;
  let deepestOther = 0;
  for (const s of view.seats) {
    if (s.seat !== seat && s.startingStack > deepestOther) deepestOther = s.startingStack;
  }
  return Math.min(me.startingStack, deepestOther);
}

/** Seat of the last preflop raiser, or undefined when the pot went unraised. */
export function preflopAggressor(view: HandView): number | undefined {
  let seat: number | undefined;
  for (const a of view.actions) {
    if (a.street !== "preflop") break;
    if (a.kind === "raise") seat = a.seat;
  }
  return seat;
}

/** Actions on one street, in order. */
export function actionsOn(view: HandView, street: Street): ActionView[] {
  return view.actions.filter((a) => a.street === street);
}
