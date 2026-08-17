/**
 * Shared grading vocabulary.
 *
 * Two rules govern everything here, both straight out of the PRD's
 * grading-miscalibration risk (top risk #2):
 *
 * 1. **Bands, not decimals.** A graded decision reports a BAND
 *    (`inline` / `minor` / `significant`). A numeric EV loss rides along only
 *    when something actually computed one, and it is quantized to the
 *    precision the method earns.
 * 2. **Confidence is never omitted.** Every grade carries a
 *    {@link Confidence}. `"unknown"` is a first-class, honest answer: a spot
 *    off every chart we hold is reported as a deviation with unknown
 *    confidence, not silently graded or silently dropped.
 *
 * A grade with no {@link DecisionGrade.band} is a spot we looked at and could
 * not assess. Consumers (rating, leak reports) must skip those rather than
 * treating them as fine.
 */

import type { ActionKind, Street } from "@poker/history";
import type { ConceptId } from "./concepts";

/** Grade band for a decision. */
export type GradeBand = "inline" | "minor" | "significant";

/**
 * How much to trust the number attached to a grade.
 * - `high` — exact enumeration against a range we were *given* (ground truth).
 * - `medium` — exact enumeration against an estimated range, or Monte Carlo
 *   against a given one.
 * - `low` — Monte Carlo against an estimated range, or a multiway spot.
 * - `unknown` — no EV was computed at all (off-chart deviations).
 */
export type Confidence = "high" | "medium" | "low" | "unknown";

/** How a grade's number (if any) was produced. */
export type EvBasis = "chart-weight" | "exact-enumeration" | "monte-carlo" | "none";

/** Where the villain range used for an EV comparison came from. */
export type RangeSource = "given" | "filtered" | "prior";

/** The chart node a preflop grade was measured against. */
export interface ChartProvenance {
  /** `ChartSet.version` — recorded so a re-grade can be told from a re-run. */
  chartSetVersion: string;
  chartId: string;
  /** Node descriptor, e.g. `"sb-jam"` or `"rfi"`. */
  node: string;
  depthBb: number;
  /** Canonical 169 label of the hero hand, e.g. `"AKs"`. */
  hand: string;
  /** Chart weight (0-100) of the action hero actually took. */
  weight: number;
}

/** Detail of the Monte Carlo / enumeration behind a postflop grade. */
export interface EvDetail {
  basis: EvBasis;
  /** Fixed trial count for Monte Carlo bases; absent for exact enumeration. */
  trials?: number;
  rangeSource: RangeSource;
  /** Live players (hero included) at the decision. */
  livePlayers: number;
  /** EV of the action hero took, in big blinds, relative to folding. */
  takenEvBb: number;
  /** EV of the best action considered, in big blinds, relative to folding. */
  bestEvBb: number;
  /** Label of the best action considered, e.g. `"bet 0.75p"`. */
  bestAction: string;
  /** Every action the comparison considered, best-first. */
  alternatives: readonly { action: string; evBb: number }[];
}

/** One graded hero decision. `decisionId` matches docs/hand-format.md. */
export interface DecisionGrade {
  /** `${street}:${seat}:${n}` — the annotation key from @poker/history. */
  decisionId: string;
  street: Street;
  seat: number;
  kind: ActionKind;
  /** Absent when the spot could not be assessed at all. */
  band?: GradeBand;
  confidence: Confidence;
  /** EV loss vs the best considered action, in big blinds. Never negative. */
  evLossBb?: number;
  basis: EvBasis;
  /** Primary concept tag (at most one, per the taxonomy). */
  concept?: ConceptId;
  chart?: ChartProvenance;
  ev?: EvDetail;
  /** Deterministic, human-readable one-liner. Never a clock or a random draw. */
  note: string;
}

/**
 * EV-loss band edges in big blinds. Deliberately generous: an estimate that
 * cannot separate 0.05bb from 0.0bb must not call a decision a mistake.
 */
export const GRADE_EV_BANDS = { minorBb: 0.1, significantBb: 0.6 } as const;

/** Band for an EV loss in big blinds. Negative losses clamp to `inline`. */
export function bandForEvLoss(evLossBb: number): GradeBand {
  if (!Number.isFinite(evLossBb) || evLossBb < GRADE_EV_BANDS.minorBb) return "inline";
  if (evLossBb < GRADE_EV_BANDS.significantBb) return "minor";
  return "significant";
}

/**
 * Chart-weight band edges (0-100 action weight of the line hero took).
 *
 * A chart that plays a hand this way 40%+ of the time is endorsing the line —
 * that is `inline`, mixed strategies included. Below 10% the chart is saying
 * essentially never.
 */
export const GRADE_WEIGHT_BANDS = { inlineAtLeast: 40, minorAtLeast: 10 } as const;

/** Band for the chart weight (0-100) of the action hero took. */
export function bandForChartWeight(weight: number): GradeBand {
  if (weight >= GRADE_WEIGHT_BANDS.inlineAtLeast) return "inline";
  if (weight >= GRADE_WEIGHT_BANDS.minorAtLeast) return "minor";
  return "significant";
}

/**
 * Quantize an EV number to the precision its method earns: exact enumeration
 * gets milli-bb, Monte Carlo gets centi-bb. Publishing an MC result to five
 * decimals is false precision, and false precision is how grading teaches the
 * wrong lesson.
 */
export function quantizeEvBb(value: number, basis: EvBasis): number {
  if (!Number.isFinite(value)) return 0;
  const scale = basis === "exact-enumeration" ? 1000 : 100;
  return Math.round(value * scale) / scale;
}

/** Weaken a confidence by `steps` levels (never below `unknown`). */
export function weakenConfidence(c: Confidence, steps: number): Confidence {
  const ladder: readonly Confidence[] = ["high", "medium", "low", "unknown"];
  const at = ladder.indexOf(c);
  const next = Math.min(ladder.length - 1, at + Math.max(0, steps));
  return ladder[next] ?? "unknown";
}
