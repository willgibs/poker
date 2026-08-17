/**
 * decisionId scheme — the stable key that grading/annotations attach to.
 *
 * `${street}:${seat}:${n}` where `n` is the 0-based index of that seat's
 * `act` events on that street. Structural, so what-if branches and re-graders
 * derive identical ids for identical positions in the action sequence.
 */

import type { HandEvent, Street } from "./types";

/** Build a decisionId from its parts. */
export function decisionId(street: Street, seat: number, n: number): string {
  return `${street}:${seat}:${n}`;
}

/** A resolved decision point within an event list. */
export interface DecisionRef {
  /** Index of the `act` event within the events array. */
  eventIndex: number;
  seat: number;
  street: Street;
  /** 0-based count of this seat's prior actions on this street. */
  n: number;
  /** The annotation key: `${street}:${seat}:${n}`. */
  id: string;
}

/**
 * Walk an event list and return a DecisionRef for every `act` event,
 * in order. Streets advance on `board` events; everything before the
 * first board is `preflop`.
 */
export function decisionRefs(events: readonly HandEvent[]): DecisionRef[] {
  const refs: DecisionRef[] = [];
  let street: Street = "preflop";
  const counts = new Map<string, number>();
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e === undefined) continue;
    if (e.t === "board") {
      street = e.street;
    } else if (e.t === "act") {
      const key = `${street}:${e.seat}`;
      const n = counts.get(key) ?? 0;
      counts.set(key, n + 1);
      refs.push({ eventIndex: i, seat: e.seat, street, n, id: decisionId(street, e.seat, n) });
    }
  }
  return refs;
}
