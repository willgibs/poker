/**
 * Skill rating — decision quality, results excluded by construction.
 *
 * PRD Q27: "Internal skill rating from decision quality (EV accuracy, not
 * results)". The strongest way to keep a promise like that is to make it
 * impossible to break: {@link updateRating} takes {@link DecisionGrade}s and
 * NOTHING else. No net, no pot, no stack — there is no parameter through which
 * a result could influence the number. A rigged corpus of maximal coolers with
 * perfect play rates identically to the same play running pure (there is a test
 * for exactly that).
 *
 * This also makes the rating purchase-proof, which the economy work depends on:
 * nothing you can buy produces a graded decision.
 *
 * ## The update
 *
 * Each graded decision becomes a quality `q ∈ [0, 1]`. Where an EV loss exists
 * the quality decays exponentially in it (`exp(−loss / scale)`), so a 0.05bb
 * slip is nearly free and a 2bb blunder is nearly zero. Where only a band
 * exists, the band maps to a fixed quality. Each decision is weighted by its
 * confidence, so a `low`-confidence Monte-Carlo read moves the rating far less
 * than an exact river measurement, and `unknown` barely moves it at all.
 *
 * The hand's weighted mean quality maps to a target rating, and the state
 * eases toward it with a gain that decays as the sample grows — fast to place
 * a new player, slow to swing an established one. That is a deliberate design
 * choice over Elo: there is no opponent here, only a distance from the best
 * available line.
 */

import type { ConceptId } from "./concepts";
import { type Confidence, type DecisionGrade, type GradeBand } from "./types";
import { CONCEPTS, type ConceptTier } from "./concepts";

/** Rating scale bounds. */
export const RATING_MIN = 0;
export const RATING_MAX = 3000;
/** Where an unplaced player starts. */
export const RATING_START = 1000;

/** EV loss (bb) at which quality falls to 1/e. */
export const QUALITY_SCALE_BB = 0.5;

/** Quality for a band when no EV number is available. */
export const BAND_QUALITY: Readonly<Record<GradeBand, number>> = {
  inline: 1,
  minor: 0.55,
  significant: 0.15,
};

/** How much each confidence level is allowed to move the rating. */
export const CONFIDENCE_WEIGHT: Readonly<Record<Confidence, number>> = {
  high: 1,
  medium: 0.7,
  low: 0.4,
  unknown: 0.15,
};

/** Initial gain, and the sample size at which it has halved. */
export const RATING_GAIN = 0.08;
export const RATING_GAIN_HALFLIFE_HANDS = 400;
/** Floor under the gain, so an established rating still tracks real change. */
export const RATING_GAIN_MIN = 0.012;

/** Trend history cap; the oldest points are dropped past it. */
export const HISTORY_CAP = 512;

/** Rating tier boundaries — these select the coach's vocabulary register. */
export const TIER_BOUNDARIES: Readonly<Record<"intermediate" | "advanced", number>> = {
  intermediate: 1200,
  advanced: 1900,
};

/** One point on the rating trend line. */
export interface RatingPoint {
  /** Hands folded in at this point. */
  hands: number;
  rating: number;
}

/** Per-concept mastery accumulator. */
export interface ConceptMastery {
  concept: ConceptId;
  /** Weighted mean decision quality in this concept, `[0, 1]`. */
  quality: number;
  /** Sum of confidence weights behind it. */
  weight: number;
  /** Graded decisions tagged with this concept. */
  decisions: number;
}

/** The rating state. JSON-safe, so it persists as-is. */
export interface RatingState {
  v: 1;
  rating: number;
  /** Hands with at least one gradable decision. */
  hands: number;
  /** Graded decisions folded in (only those carrying a band). */
  decisions: number;
  /** Sum of confidence weights folded in. */
  weight: number;
  history: RatingPoint[];
  concepts: Partial<Record<ConceptId, ConceptMastery>>;
}

/** A fresh rating state. */
export function initialRating(start: number = RATING_START): RatingState {
  const rating = clampRating(start);
  return {
    v: 1,
    rating,
    hands: 0,
    decisions: 0,
    weight: 0,
    history: [{ hands: 0, rating }],
    concepts: {},
  };
}

function clampRating(x: number): number {
  if (!Number.isFinite(x)) return RATING_START;
  return Math.min(RATING_MAX, Math.max(RATING_MIN, x));
}

/**
 * Decision quality in `[0, 1]`. Undefined for a grade with no band — a spot we
 * declined to assess must not count for or against the player.
 */
export function decisionQuality(grade: DecisionGrade): number | undefined {
  if (grade.band === undefined) return undefined;
  const loss = grade.evLossBb;
  if (loss !== undefined && Number.isFinite(loss)) {
    return Math.exp(-Math.max(0, loss) / QUALITY_SCALE_BB);
  }
  return BAND_QUALITY[grade.band];
}

/** Rating a sustained quality level converges to. */
export function qualityToRating(quality: number): number {
  return clampRating(RATING_MIN + quality * (RATING_MAX - RATING_MIN));
}

/** Gain applied after `hands` hands. */
export function ratingGain(hands: number): number {
  return Math.max(RATING_GAIN_MIN, RATING_GAIN / (1 + hands / RATING_GAIN_HALFLIFE_HANDS));
}

/**
 * Fold one hand's grades into the rating.
 *
 * Pure: returns a new state. Grades with no band are skipped entirely. A hand
 * whose grades are all unassessable leaves the rating untouched, including its
 * hand count — an ungraded hand is not evidence of anything.
 */
export function updateRating(
  state: RatingState,
  grades: readonly DecisionGrade[],
): RatingState {
  let weightSum = 0;
  let qualitySum = 0;
  let counted = 0;
  const concepts: Partial<Record<ConceptId, ConceptMastery>> = { ...state.concepts };

  for (const g of grades) {
    const q = decisionQuality(g);
    if (q === undefined) continue;
    const w = CONFIDENCE_WEIGHT[g.confidence];
    weightSum += w;
    qualitySum += w * q;
    counted += 1;

    if (g.concept !== undefined) {
      const prev = concepts[g.concept] ?? {
        concept: g.concept,
        quality: 0,
        weight: 0,
        decisions: 0,
      };
      const nextWeight = prev.weight + w;
      concepts[g.concept] = {
        concept: g.concept,
        quality: nextWeight <= 0 ? 0 : (prev.quality * prev.weight + q * w) / nextWeight,
        weight: nextWeight,
        decisions: prev.decisions + 1,
      };
    }
  }

  if (counted === 0 || weightSum <= 0) return state;

  const handQuality = qualitySum / weightSum;
  const target = qualityToRating(handQuality);
  // Mean confidence of the hand scales the step: a hand graded entirely on
  // low-confidence estimates should nudge, not shove.
  const meanConfidence = Math.min(1, weightSum / counted);
  const gain = ratingGain(state.hands) * meanConfidence;
  const rating = clampRating(state.rating + gain * (target - state.rating));

  const hands = state.hands + 1;
  const history = [...state.history, { hands, rating }];
  if (history.length > HISTORY_CAP) history.splice(0, history.length - HISTORY_CAP);

  return {
    v: 1,
    rating,
    hands,
    decisions: state.decisions + counted,
    weight: state.weight + weightSum,
    history,
    concepts,
  };
}

/** Fold many hands' grades in order. */
export function updateRatingAll(
  state: RatingState,
  handGrades: readonly (readonly DecisionGrade[])[],
): RatingState {
  let acc = state;
  for (const grades of handGrades) acc = updateRating(acc, grades);
  return acc;
}

/** Direction of a rating trend. */
export type TrendDirection = "rising" | "flat" | "falling";

/** Trend over a window of hands. */
export interface RatingTrend {
  /** Hands the window spans (may be shorter than requested early on). */
  spanHands: number;
  from: number;
  to: number;
  delta: number;
  direction: TrendDirection;
  points: readonly RatingPoint[];
}

/** Rating change is called flat inside this band. */
export const TREND_FLAT_BAND = 5;

/**
 * Trend over the last `windowHands` hands. Falls back to the whole history
 * when the window reaches past its start.
 */
export function ratingTrend(state: RatingState, windowHands = 50): RatingTrend {
  const history = state.history;
  const last = history[history.length - 1] ?? { hands: state.hands, rating: state.rating };
  const cutoff = last.hands - Math.max(1, windowHands);
  let startIndex = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const p = history[i];
    if (p === undefined) continue;
    if (p.hands <= cutoff) {
      startIndex = i;
      break;
    }
  }
  const first = history[startIndex] ?? last;
  const delta = last.rating - first.rating;
  return {
    spanHands: last.hands - first.hands,
    from: first.rating,
    to: last.rating,
    delta,
    direction: delta > TREND_FLAT_BAND ? "rising" : delta < -TREND_FLAT_BAND ? "falling" : "flat",
    points: history.slice(startIndex),
  };
}

/**
 * Coach vocabulary register for a rating — the taxonomy's coach-tier rule:
 * the rating selects the register, never the tag.
 */
export function ratingTier(rating: number): ConceptTier {
  if (rating >= TIER_BOUNDARIES.advanced) return "advanced";
  if (rating >= TIER_BOUNDARIES.intermediate) return "intermediate";
  return "foundations";
}

/**
 * Concepts to work on next: the weakest mastery scores with enough evidence
 * behind them, weakest first. Feeds the PRD's "work on next" suggestions.
 */
export function weakestConcepts(
  state: RatingState,
  opts: { minDecisions?: number; limit?: number } = {},
): ConceptMastery[] {
  const minDecisions = opts.minDecisions ?? 10;
  const limit = opts.limit ?? 3;
  return Object.values(state.concepts)
    .filter((m): m is ConceptMastery => m !== undefined && m.decisions >= minDecisions)
    .sort((a, b) => a.quality - b.quality || a.concept.localeCompare(b.concept))
    .slice(0, limit);
}

/** Tier of a concept — re-exported for report surfaces. */
export function conceptTier(concept: ConceptId): ConceptTier {
  return CONCEPTS[concept].tier;
}
