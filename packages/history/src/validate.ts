/**
 * Structural validation of an event list — validateEvents.
 *
 * Plain functions, no schema library. Enforces the lifecycle grammar and
 * cross-event sanity documented in docs/hand-format.md §Validation:
 * starts with `start`, ends with `end`, nothing after `end`, seats
 * consistent, streets ordered, cards distinct, amounts are sane integers.
 * It does NOT re-verify betting legality — that is the engine's job.
 */

import type { HandEvent, HandStart } from "./types";

export interface ValidationResult {
  ok: boolean;
  /** Human-readable problems, each prefixed with the offending event index. */
  errors: string[];
}

const BOARD_ORDER = ["flop", "turn", "river"] as const;
const BOARD_CARD_COUNT: Record<(typeof BOARD_ORDER)[number], number> = { flop: 3, turn: 1, river: 1 };

function isNonNegInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0;
}

function isCardInt(v: unknown): v is number {
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 51;
}

/** Validate a full hand's event list. Empty `errors` means valid. */
export function validateEvents(events: readonly HandEvent[]): ValidationResult {
  const errors: string[] = [];
  const err = (i: number, msg: string): void => {
    errors.push(`event ${i}: ${msg}`);
  };

  if (events.length === 0) return { ok: false, errors: ["event list is empty"] };

  // --- envelope shape of the sequence -------------------------------------
  const startIndexes: number[] = [];
  const endIndexes: number[] = [];
  events.forEach((e, i) => {
    if (e.t === "start") startIndexes.push(i);
    if (e.t === "end") endIndexes.push(i);
  });
  if (startIndexes.length !== 1) errors.push(`expected exactly one start event, found ${startIndexes.length}`);
  if (startIndexes[0] !== undefined && startIndexes[0] !== 0) errors.push("start must be the first event");
  if (endIndexes.length !== 1) errors.push(`expected exactly one end event, found ${endIndexes.length}`);
  const endIndex = endIndexes[0];
  if (endIndex !== undefined && endIndex !== events.length - 1) {
    errors.push(`end must be the last event (found ${events.length - 1 - endIndex} event(s) after end)`);
  }

  // --- start event & seat roster ------------------------------------------
  const seats = new Set<number>();
  let start: HandStart | undefined;
  const firstStart = startIndexes[0];
  if (firstStart !== undefined) {
    const e = events[firstStart];
    if (e !== undefined && e.t === "start") start = e;
  }
  if (start !== undefined) {
    const i = firstStart ?? 0;
    if (!isNonNegInt(start.handNumber)) err(i, "start.handNumber must be a non-negative integer");
    if (start.seats.length < 2) err(i, "start.seats must contain at least 2 seats");
    for (const s of start.seats) {
      if (!isNonNegInt(s.seat)) err(i, `start.seats: seat ${s.seat} must be a non-negative integer`);
      if (!isNonNegInt(s.stack)) err(i, `start.seats: stack for seat ${s.seat} must be a non-negative integer (cents)`);
      if (seats.has(s.seat)) err(i, `start.seats: duplicate seat ${s.seat}`);
      seats.add(s.seat);
    }
    if (!seats.has(start.button)) err(i, `start.button ${start.button} is not a dealt-in seat`);
    for (const key of ["sb", "bb", "ante"] as const) {
      if (!isNonNegInt(start.blinds[key])) err(i, `start.blinds.${key} must be a non-negative integer (cents)`);
    }
  }
  const seatKnown = (seat: number): boolean => start === undefined || seats.has(seat);

  // --- per-event checks -----------------------------------------------------
  const dealt = new Set<number>(); // every card that has left the deck
  const holeBySeat = new Map<number, [number, number]>();
  let boardIdx = 0;

  const claimCard = (i: number, card: number, what: string): void => {
    if (!isCardInt(card)) {
      err(i, `${what}: ${card} is not a card int 0..51`);
      return;
    }
    if (dealt.has(card)) err(i, `${what}: duplicate card ${card} already dealt`);
    dealt.add(card);
  };

  events.forEach((e, i) => {
    switch (e.t) {
      case "start":
        break; // handled above
      case "post": {
        if (!seatKnown(e.seat)) err(i, `post: unknown seat ${e.seat}`);
        if (!isNonNegInt(e.amount) || e.amount === 0) err(i, "post.amount must be a positive integer (cents)");
        break;
      }
      case "hole": {
        if (!seatKnown(e.seat)) err(i, `hole: unknown seat ${e.seat}`);
        if (holeBySeat.has(e.seat)) err(i, `hole: seat ${e.seat} already has hole cards`);
        claimCard(i, e.cards[0], "hole.cards");
        claimCard(i, e.cards[1], "hole.cards");
        if (e.cards[0] === e.cards[1]) err(i, "hole.cards must be two distinct cards");
        holeBySeat.set(e.seat, [e.cards[0], e.cards[1]]);
        break;
      }
      case "act": {
        if (!seatKnown(e.seat)) err(i, `act: unknown seat ${e.seat}`);
        const hasAmount = e.amount !== undefined;
        const hasTo = e.toAmount !== undefined;
        switch (e.kind) {
          case "fold":
          case "check":
            if (hasAmount || hasTo) err(i, `act: ${e.kind} must not carry amount or toAmount`);
            break;
          case "call":
            if (!hasAmount || !isNonNegInt(e.amount) || e.amount === 0) err(i, "act: call requires positive integer amount (chips added)");
            if (hasTo) err(i, "act: call must not carry toAmount");
            break;
          case "bet":
            if (!hasAmount || !isNonNegInt(e.amount) || e.amount === 0) err(i, "act: bet requires positive integer amount");
            if (hasTo) err(i, "act: bet must not carry toAmount");
            break;
          case "raise":
            if (!hasTo || !isNonNegInt(e.toAmount) || e.toAmount === 0) err(i, "act: raise requires positive integer toAmount (total this street)");
            if (hasAmount) err(i, "act: raise must not carry amount (raises are expressed as toAmount)");
            break;
        }
        if (e.thinkTimeMs !== undefined && !isNonNegInt(e.thinkTimeMs)) err(i, "act.thinkTimeMs must be a non-negative integer");
        break;
      }
      case "board": {
        const expected = BOARD_ORDER[boardIdx];
        if (expected === undefined) {
          err(i, `board: unexpected extra board event (street ${e.street})`);
        } else if (e.street !== expected) {
          err(i, `board: expected street '${expected}' next, got '${e.street}'`);
        } else {
          boardIdx++;
        }
        const want = BOARD_CARD_COUNT[e.street];
        if (e.cards.length !== want) err(i, `board: ${e.street} must have ${want} card(s), got ${e.cards.length}`);
        for (const c of e.cards) claimCard(i, c, "board.cards");
        break;
      }
      case "showdown": {
        const seen = new Set<number>();
        for (const r of e.reveals) {
          if (!seatKnown(r.seat)) err(i, `showdown: unknown seat ${r.seat}`);
          if (seen.has(r.seat)) err(i, `showdown: seat ${r.seat} revealed twice`);
          seen.add(r.seat);
          const hole = holeBySeat.get(r.seat);
          if (hole !== undefined) {
            // Reveal must match the dealt hole cards (order-insensitive).
            const a = [...r.cards].sort((x, y) => x - y);
            const b = [...hole].sort((x, y) => x - y);
            if (a[0] !== b[0] || a[1] !== b[1]) err(i, `showdown: seat ${r.seat} reveal does not match dealt hole cards`);
          } else {
            claimCard(i, r.cards[0], "showdown.cards");
            claimCard(i, r.cards[1], "showdown.cards");
            if (r.cards[0] === r.cards[1]) err(i, `showdown: seat ${r.seat} reveal must be two distinct cards`);
          }
        }
        break;
      }
      case "pot": {
        if (!seatKnown(e.seat)) err(i, `pot: unknown seat ${e.seat}`);
        if (!isNonNegInt(e.potIndex)) err(i, "pot.potIndex must be a non-negative integer");
        if (!isNonNegInt(e.amount) || e.amount === 0) err(i, "pot.amount must be a positive integer (cents)");
        break;
      }
      case "end": {
        const seen = new Set<number>();
        let sum = 0;
        for (const n of e.net) {
          if (!seatKnown(n.seat)) err(i, `end: unknown seat ${n.seat}`);
          if (seen.has(n.seat)) err(i, `end: duplicate seat ${n.seat} in net`);
          seen.add(n.seat);
          if (typeof n.net !== "number" || !Number.isInteger(n.net)) err(i, `end: net for seat ${n.seat} must be an integer (cents)`);
          sum += n.net;
        }
        if (start !== undefined) {
          for (const s of start.seats) {
            if (!seen.has(s.seat)) err(i, `end: missing net entry for seat ${s.seat}`);
          }
        }
        if (sum !== 0) err(i, `end: nets must sum to 0 (chip conservation), got ${sum}`);
        break;
      }
    }
  });

  return { ok: errors.length === 0, errors };
}
