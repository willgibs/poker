/**
 * Rake — a post-award adjustment, deliberately kept OUT of the event log.
 *
 * A v1 hand log requires `end` nets to sum to exactly zero; a raked pot does
 * not. Rather than redefine frozen fields or ship logs that fail
 * `validateEvents`, the engine stays rake-free and the drop is recorded as an
 * annotation under the reserved key {@link RAKE_ANNOTATION_KEY}, applied to the
 * session's stack ledger afterwards. The README states the representation in
 * full; this module is its arithmetic, in integer cents, with no floats
 * anywhere near a chip.
 */

import type { HandRecord } from "@poker/history";
import type { RakeConfig, RakeLedger } from "./types";

/**
 * Annotation key for the rake ledger. Decision keys are always
 * `${street}:${seat}:${n}`, so the `sim/` namespace can never collide.
 */
export const RAKE_ANNOTATION_KEY = "sim/rake";

/** The facts a rake calculation needs, all derived from a settled hand. */
export interface RakeInput {
  /** Every dealt-in seat's total commitment this hand, cents. */
  committedBySeat: ReadonlyMap<number, number>;
  /** Chips awarded per seat across all pots, cents. */
  awardedBySeat: ReadonlyMap<number, number>;
  /** True when the hand dealt at least a flop. */
  sawBoard: boolean;
}

function assertCents(n: number, what: string): void {
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new RangeError(`${what} must be a non-negative integer (cents), got ${String(n)}`);
  }
}

/** Validate a rake configuration. Throws `RangeError` describing the problem. */
export function validateRakeConfig(rake: RakeConfig): void {
  if (!Number.isFinite(rake.pct) || rake.pct < 0 || rake.pct > 1) {
    throw new RangeError(`rake.pct must be a fraction in [0, 1], got ${String(rake.pct)}`);
  }
  assertCents(rake.capCents, "rake.capCents");
}

function emptyLedger(rake: RakeConfig | undefined, input: RakeInput, reason: string): RakeLedger {
  let pot = 0;
  for (const c of input.committedBySeat.values()) pot += c;
  return {
    v: 1,
    pct: rake?.pct ?? 0,
    capCents: rake?.capCents ?? 0,
    noFlopNoDrop: rake?.noFlopNoDrop ?? true,
    potCents: pot,
    uncalledCents: 0,
    baseCents: 0,
    totalCents: 0,
    bySeat: {},
    applied: false,
    reason,
  };
}

/**
 * The portion of the largest commitment nobody matched — a bet that was
 * returned rather than contested. Casinos return it before dropping, so it is
 * excluded from the rake base.
 */
export function uncalledPortion(committed: Iterable<number>): number {
  let max = 0;
  let second = 0;
  for (const c of committed) {
    if (c > max) {
      second = max;
      max = c;
    } else if (c > second) {
      second = c;
    }
  }
  return max - second;
}

/**
 * Compute the hand's rake ledger.
 *
 * Winners pay pro-rata on what they collected; the rounding remainder goes to
 * the largest award first, ties broken by the lowest seat, so the split is a
 * pure function of the hand and never a float.
 */
export function computeRake(rake: RakeConfig | undefined, input: RakeInput): RakeLedger {
  if (rake === undefined) return emptyLedger(rake, input, "no rake configured");
  validateRakeConfig(rake);
  const noFlopNoDrop = rake.noFlopNoDrop ?? true;
  if (noFlopNoDrop && !input.sawBoard) return emptyLedger(rake, input, "no-flop-no-drop");

  let potCents = 0;
  for (const c of input.committedBySeat.values()) {
    assertCents(c, "committed");
    potCents += c;
  }
  const uncalledCents = uncalledPortion(input.committedBySeat.values());
  const baseCents = Math.max(0, potCents - uncalledCents);

  let totalAwarded = 0;
  const winners: Array<{ seat: number; awarded: number }> = [];
  for (const [seat, awarded] of input.awardedBySeat) {
    assertCents(awarded, `award for seat ${seat}`);
    if (awarded <= 0) continue;
    totalAwarded += awarded;
    winners.push({ seat, awarded });
  }
  winners.sort((a, b) => (b.awarded - a.awarded) || (a.seat - b.seat));

  const uncapped = Math.floor(rake.pct * baseCents);
  const totalCents = Math.max(0, Math.min(rake.capCents, uncapped, baseCents, totalAwarded));
  if (totalCents === 0 || winners.length === 0) {
    return {
      v: 1,
      pct: rake.pct,
      capCents: rake.capCents,
      noFlopNoDrop,
      potCents,
      uncalledCents,
      baseCents,
      totalCents: 0,
      bySeat: {},
      applied: true,
    };
  }

  const bySeat: Record<string, number> = {};
  let assigned = 0;
  for (const w of winners) {
    const share = Math.floor((totalCents * w.awarded) / totalAwarded);
    bySeat[String(w.seat)] = share;
    assigned += share;
  }
  // Remainder cents: largest award first, ties by lowest seat (winners is
  // already in that order), never more than a seat actually won.
  let remainder = totalCents - assigned;
  for (const w of winners) {
    if (remainder <= 0) break;
    const key = String(w.seat);
    const current = bySeat[key] ?? 0;
    if (current >= w.awarded) continue;
    bySeat[key] = current + 1;
    remainder -= 1;
  }

  return {
    v: 1,
    pct: rake.pct,
    capCents: rake.capCents,
    noFlopNoDrop,
    potCents,
    uncalledCents,
    baseCents,
    totalCents: totalCents - remainder,
    bySeat,
    applied: true,
  };
}

/** Read a record's rake ledger back, or `null` when the hand carried none. */
export function rakeOf(record: HandRecord): RakeLedger | null {
  const raw = record.annotations?.[RAKE_ANNOTATION_KEY];
  if (raw === null || typeof raw !== "object") return null;
  const l = raw as Partial<RakeLedger>;
  if (l.v !== 1 || typeof l.totalCents !== "number") return null;
  return raw as RakeLedger;
}
