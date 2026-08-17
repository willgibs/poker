/**
 * Side-pot construction from total-committed layers.
 *
 * Layer boundaries are the distinct `committedTotal` values of the NON-FOLDED
 * seats, ascending. The pot for layer (prev, L] collects, from every seat
 * (folded included — folded chips stay in whatever pot they were bet into),
 * `min(committed, L) - prev`; the top layer additionally absorbs all folded
 * chips above the highest non-folded commitment (there is no higher contest
 * to attach them to). Eligibility for the layer at L = non-folded seats with
 * `committed >= L`, so eligibility strictly shrinks up the layers and the
 * main pot is always first. A top layer whose only eligible seat is its own
 * over-bettor is the "uncalled bet", returned via a normal award.
 */

import { EngineError } from "./errors";
import type { TableState } from "./types";

export interface PotEntry {
  seat: number;
  /** Total chips this seat put in this hand (cents), antes included. */
  committed: number;
  folded: boolean;
}

export interface Pot {
  amount: number;
  /** Seat numbers eligible to win this pot, in input order. */
  eligible: number[];
}

/** Build main + side pots. Index 0 = main pot. Σ amounts = Σ committed. */
export function buildPots(entries: readonly PotEntry[]): Pot[] {
  for (const e of entries) {
    if (!Number.isSafeInteger(e.committed) || e.committed < 0) {
      throw new EngineError("bad_config", `invalid committed amount ${e.committed} for seat ${e.seat}`);
    }
  }
  const active = entries.filter((e) => !e.folded && e.committed > 0);
  if (active.length === 0) {
    const total = entries.reduce((a, e) => a + e.committed, 0);
    if (total > 0) {
      throw new EngineError("invariant", "committed chips with no eligible contender");
    }
    return [];
  }

  const levels = [...new Set(active.map((e) => e.committed))].sort((a, b) => a - b);
  const top = must(levels[levels.length - 1]);
  const pots: Pot[] = [];
  let prev = 0;
  for (const level of levels) {
    let amount = 0;
    for (const e of entries) {
      amount += Math.max(0, Math.min(e.committed, level) - prev);
      if (level === top) amount += Math.max(0, e.committed - top);
    }
    pots.push({
      amount,
      eligible: active.filter((e) => e.committed >= level).map((e) => e.seat),
    });
    prev = level;
  }
  return pots;
}

function must<T>(v: T | undefined): T {
  if (v === undefined) throw new EngineError("invariant", "internal invariant violated");
  return v;
}

/**
 * Pots are derived state — a pure function of the seats' total commitments —
 * so `TableState` stores none; this computes the current layering at any
 * point in the hand (what the table would award if it ended now).
 */
export function potsOf(state: TableState): Pot[] {
  return buildPots(
    state.seats.map((s) => ({ seat: s.seat, committed: s.committedTotal, folded: s.folded })),
  );
}
