/**
 * Read-only projections over a `@poker/history` event log.
 *
 * The pipeline's line features (stage 1), the Bayesian range updates (stage 2),
 * bad-beat detection (stage 6) and the opponent memory (stage 7) all need the
 * same thing: the hand's actions, in order, tagged with the street they
 * happened on. `@poker/history` deliberately stops at structure, so the walk
 * lives here — once, tested once.
 */

import type { Card } from "@poker/core";
import type { ActionKind, HandEvent, Street } from "@poker/history";

/** One `act` event, resolved onto its street with the pot it faced. */
export interface ActRecord {
  seat: number;
  kind: ActionKind;
  street: Street;
  /** Chips added by the action (call amount, bet size, raise increment). */
  invest: number;
  /** Total street commitment after a raise, when the event carried one. */
  toAmount?: number;
  /** Pot size before the action (cents), from the walk's own accounting. */
  potBefore: number;
  /** Chips the seat had to put in to continue when it acted (0 = unopened). */
  facing: number;
  /** Size of the action as a fraction of the pot it faced. */
  sizeFraction: number;
  /** Index of this action within the whole hand. */
  order: number;
}

export interface HandScan {
  /** Actions in event order. */
  acts: readonly ActRecord[];
  /** Actions grouped by street. */
  byStreet: Readonly<Record<Street, readonly ActRecord[]>>;
  /** Board cards revealed so far. */
  board: readonly Card[];
  /** Street the log currently sits on. */
  street: Street;
  /** Hole cards by seat, when the log carried them. */
  holeBySeat: ReadonlyMap<number, readonly [Card, Card]>;
  /** Showdown reveals by seat. */
  revealsBySeat: ReadonlyMap<number, readonly [Card, Card]>;
  /** Net result by seat, when the hand ended. */
  netBySeat: ReadonlyMap<number, number>;
  /** Chips awarded by seat across all pots. */
  awardedBySeat: ReadonlyMap<number, number>;
  /** Seats dealt into the hand, in `start` order. */
  seats: readonly number[];
  /** Big blind in cents, from the `start` event (0 when absent). */
  bb: number;
  /** 1-based hand number, or 0 when absent. */
  handNumber: number;
  /** Seats that folded at some point. */
  foldedSeats: ReadonlySet<number>;
  /** Seats that voluntarily put money in preflop (VPIP). */
  vpipSeats: ReadonlySet<number>;
  /** Seats that raised preflop (PFR). */
  pfrSeats: ReadonlySet<number>;
  /** True once at least one board event appeared. */
  sawFlop: boolean;
}

const EMPTY_STREETS = (): Record<Street, ActRecord[]> => ({
  preflop: [],
  flop: [],
  turn: [],
  river: [],
});

/**
 * Walk an event log into a {@link HandScan}. Tolerates partial logs (a hand in
 * progress): fields that need the `end` event are simply empty.
 */
export function scanHand(events: readonly HandEvent[]): HandScan {
  const acts: ActRecord[] = [];
  const byStreet = EMPTY_STREETS();
  const board: Card[] = [];
  const holeBySeat = new Map<number, readonly [Card, Card]>();
  const revealsBySeat = new Map<number, readonly [Card, Card]>();
  const netBySeat = new Map<number, number>();
  const awardedBySeat = new Map<number, number>();
  const foldedSeats = new Set<number>();
  const vpipSeats = new Set<number>();
  const pfrSeats = new Set<number>();
  const seats: number[] = [];
  let street: Street = "preflop";
  let bb = 0;
  let handNumber = 0;
  let sawFlop = false;

  // Street-local betting accounting so `potBefore` and `sizeFraction` are real.
  let pot = 0;
  let committed = new Map<number, number>();
  let level = 0;
  let order = 0;

  const resetStreet = (): void => {
    committed = new Map<number, number>();
    level = 0;
  };

  for (const ev of events) {
    switch (ev.t) {
      case "start": {
        handNumber = ev.handNumber;
        bb = ev.blinds.bb;
        for (const s of ev.seats) seats.push(s.seat);
        break;
      }
      case "post": {
        pot += ev.amount;
        if (ev.kind !== "ante") {
          const prev = committed.get(ev.seat) ?? 0;
          const now = prev + ev.amount;
          committed.set(ev.seat, now);
          if (now > level) level = now;
        }
        break;
      }
      case "hole": {
        holeBySeat.set(ev.seat, [ev.cards[0], ev.cards[1]]);
        break;
      }
      case "board": {
        sawFlop = true;
        for (const c of ev.cards) board.push(c);
        street = ev.street;
        pot += 0;
        resetStreet();
        break;
      }
      case "act": {
        const prev = committed.get(ev.seat) ?? 0;
        let invest = 0;
        if (ev.kind === "call") invest = ev.amount ?? 0;
        else if (ev.kind === "bet") invest = ev.amount ?? 0;
        else if (ev.kind === "raise") invest = Math.max(0, (ev.toAmount ?? 0) - prev);
        const potBefore = pot;
        const facing = Math.max(0, level - prev);
        const denom = potBefore > 0 ? potBefore : Math.max(bb, 1);
        const sizeFraction =
          ev.kind === "fold" || ev.kind === "check"
            ? 0
            : ev.kind === "call"
              ? facing / denom
              : invest / denom;
        const rec: ActRecord = {
          seat: ev.seat,
          kind: ev.kind,
          street,
          invest,
          potBefore,
          facing,
          sizeFraction,
          order: order++,
        };
        if (ev.toAmount !== undefined) rec.toAmount = ev.toAmount;
        acts.push(rec);
        (byStreet[street] as ActRecord[]).push(rec);

        if (ev.kind === "fold") foldedSeats.add(ev.seat);
        if (street === "preflop" && (ev.kind === "call" || ev.kind === "bet" || ev.kind === "raise")) {
          vpipSeats.add(ev.seat);
          if (ev.kind === "raise" || ev.kind === "bet") pfrSeats.add(ev.seat);
        }

        pot += invest;
        const now = prev + invest;
        committed.set(ev.seat, now);
        if (now > level) level = now;
        break;
      }
      case "showdown": {
        for (const r of ev.reveals) revealsBySeat.set(r.seat, [r.cards[0], r.cards[1]]);
        break;
      }
      case "pot": {
        awardedBySeat.set(ev.seat, (awardedBySeat.get(ev.seat) ?? 0) + ev.amount);
        break;
      }
      case "end": {
        for (const n of ev.net) netBySeat.set(n.seat, n.net);
        break;
      }
      default:
        break;
    }
  }

  return {
    acts,
    byStreet,
    board,
    street,
    holeBySeat,
    revealsBySeat,
    netBySeat,
    awardedBySeat,
    seats,
    bb,
    handNumber,
    foldedSeats,
    vpipSeats,
    pfrSeats,
    sawFlop,
  };
}

/** Features of the betting line so far, from the acting bot's point of view. */
export interface LineFeatures {
  /** Seat of the last aggressor on the current street, or null. */
  streetAggressor: number | null;
  /** Seat of the preflop raiser, or null (limped pots). */
  preflopRaiser: number | null;
  /** True when the bot took the last aggressive action preflop. */
  isPreflopAggressor: boolean;
  /** Bets + raises on the current street. */
  aggressionThisStreet: number;
  /** Raises on the current street (a 3-bet pot has >= 2 preflop). */
  raisesThisStreet: number;
  /** Preflop raise count — 2 = 3-bet pot, 3 = 4-bet pot. */
  preflopRaises: number;
  /** The bot's own actions already taken this street. */
  ownActionsThisStreet: number;
  /** True when every opponent checked to the bot on this street. */
  checkedTo: boolean;
  /** Number of streets on which the bot has already bet or raised. */
  barrelIndex: number;
  /** Consecutive checks by a single opponent, keyed by seat. */
  consecutiveChecksBySeat: ReadonlyMap<number, number>;
}

/** Derive {@link LineFeatures} for `seat` from a scan. */
export function lineFeatures(scan: HandScan, seat: number): LineFeatures {
  const cur = scan.byStreet[scan.street] ?? [];
  let streetAggressor: number | null = null;
  let aggressionThisStreet = 0;
  let raisesThisStreet = 0;
  let ownActionsThisStreet = 0;
  for (const a of cur) {
    if (a.kind === "bet" || a.kind === "raise") {
      streetAggressor = a.seat;
      aggressionThisStreet++;
      if (a.kind === "raise") raisesThisStreet++;
    }
    if (a.seat === seat) ownActionsThisStreet++;
  }

  let preflopRaiser: number | null = null;
  let preflopRaises = 0;
  for (const a of scan.byStreet.preflop) {
    if (a.kind === "raise" || a.kind === "bet") {
      preflopRaiser = a.seat;
      preflopRaises++;
    }
  }

  let barrelIndex = 0;
  for (const s of ["flop", "turn", "river"] as const) {
    const list = scan.byStreet[s] ?? [];
    if (list.some((a) => a.seat === seat && (a.kind === "bet" || a.kind === "raise"))) barrelIndex++;
  }

  const checkedTo = cur.length > 0 && cur.every((a) => a.kind === "check");

  const consecutive = new Map<number, number>();
  for (const s of ["preflop", "flop", "turn", "river"] as const) {
    for (const a of scan.byStreet[s] ?? []) {
      if (a.seat === seat) continue;
      if (a.kind === "check") consecutive.set(a.seat, (consecutive.get(a.seat) ?? 0) + 1);
      else if (a.kind === "bet" || a.kind === "raise") consecutive.set(a.seat, 0);
    }
  }

  return {
    streetAggressor,
    preflopRaiser,
    isPreflopAggressor: preflopRaiser === seat,
    aggressionThisStreet,
    raisesThisStreet,
    preflopRaises,
    ownActionsThisStreet,
    checkedTo,
    barrelIndex,
    consecutiveChecksBySeat: consecutive,
  };
}
