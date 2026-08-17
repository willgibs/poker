/**
 * @packageDocumentation
 * # @poker/analysis — deterministic analysis layer
 *
 * Everything that turns a played hand into something a player can learn from:
 * grading, leak detection, the earned HUD, the skill rating, and ICM. Zero
 * runtime dependencies, no clocks, no `Math.random` — Monte Carlo runs fixed
 * trial counts on streams derived from the hand seed, so a hand always grades
 * to the same number and a re-grade is a re-derivation, not a re-roll.
 *
 * ## Layout
 *
 * - `concepts.ts` — the 26-concept taxonomy as typed data: ids, tiers, the
 *   tracker stats that corroborate each concept, and the sample gates.
 * - `replay.ts` — hand records reconstructed into decision points; also the
 *   public projection the HUD is built from.
 * - `strength.ts` — board-relative hand ranking for the policy model.
 * - `policy.ts` — villain policy likelihoods (injected ground truth, or a
 *   tier-default fallback).
 * - `grade-preflop.ts` — chart-backed preflop grading with provenance.
 * - `grade-postflop.ts` — MC/exact EV grading vs estimated ranges.
 * - `leaks.ts` — stat aggregation and the core leak detectors.
 * - `hud.ts` — per-character observed stats, earned only.
 * - `rating.ts` — results-independent decision-quality rating.
 * - `icm.ts` — Malmuth-Harville equities and $EV helpers.
 *
 * ## The honesty contract
 *
 * Every graded decision carries a confidence label, and `"unknown"` is a real
 * answer. Grades with no band are spots this package declined to assess; every
 * consumer must skip them rather than read them as approval. PRD top risk #2
 * is grading miscalibration teaching the wrong lesson — bands, confidence
 * labels, inspectable range assumptions and a river ground-truth corpus are
 * the mitigations, and they are load-bearing.
 */

// -- concepts ---------------------------------------------------------------
export type {
  BandSource,
  Concept,
  ConceptId,
  ConceptStatLink,
  ConceptTier,
  HealthyBand,
  StatFamily,
  StatId,
  StatSpec,
  StatUnit,
} from "./concepts";
export {
  ALL_CONCEPTS,
  CONCEPTS,
  CONCEPT_IDS,
  CONCEPT_TIERS,
  MIN_SAMPLE_HANDS,
  STATS,
  STAT_IDS,
  conceptsByTier,
  conceptsForStat,
  isConceptId,
  isStatId,
  minSampleHands,
} from "./concepts";

// -- grading vocabulary -----------------------------------------------------
export type {
  ChartProvenance,
  Confidence,
  DecisionGrade,
  EvBasis,
  EvDetail,
  GradeBand,
  RangeSource,
} from "./types";
export {
  GRADE_EV_BANDS,
  GRADE_WEIGHT_BANDS,
  bandForChartWeight,
  bandForEvLoss,
  quantizeEvBb,
  weakenConfidence,
} from "./types";

// -- replay -----------------------------------------------------------------
export type { ActionView, HandView, SeatView } from "./replay";
export {
  ReplayError,
  actionsOn,
  buildHandView,
  effectiveStack,
  preflopAggressor,
  publicEvents,
  seatView,
} from "./replay";

// -- strength & policy ------------------------------------------------------
export type { HandCategoryValue } from "./strength";
export { HAND_CATEGORY, categoryOf, comboStrengths, createStrengthCache, handRank } from "./strength";
export type { PolicyLikelihood, PolicyProfile, PolicyTier, VillainActionContext } from "./policy";
export { DEFAULT_POLICY_TIER, POLICY_PROFILES, foldProbability, tierDefaultPolicy } from "./policy";

// -- evaluator bridge -------------------------------------------------------
export { defaultEvaluate7 } from "./evaluator";

// -- preflop grading --------------------------------------------------------
export type { ChartRole, PreflopGradeOptions, PreflopLine, PreflopNode, PreflopNodeKind } from "./grade-preflop";
export {
  DEFAULT_DEPTH_BUCKETS,
  DEFAULT_PUSH_FOLD_MAX_BB,
  DEFAULT_PUSH_FOLD_TRIALS,
  cashChartId,
  gradePreflop,
  nearestBucket,
  nearestNashDepth,
  preflopNodeOf,
} from "./grade-preflop";

// -- postflop grading -------------------------------------------------------
export type { PostflopGradeOptions } from "./grade-postflop";
export {
  DEFAULT_BET_FRACTIONS,
  DEFAULT_EPSILON_FLOOR,
  DEFAULT_RAISE_FRACTIONS,
  DEFAULT_TRIALS,
  PREFLOP_PRIOR_PCT,
  gradePostflop,
  preflopPriorPct,
} from "./grade-postflop";

// -- leaks ------------------------------------------------------------------
export type { LeakDetector, LeakDirection, LeakFinding, StatAggregate, StatCounter } from "./leaks";
export {
  LEAK_DETECTORS,
  MAX_EVIDENCE_HANDS,
  aggregateStats,
  detectLeaks,
  evaluateDetectors,
  statOpportunities,
  statValue,
} from "./leaks";

// -- earned HUD -------------------------------------------------------------
export type {
  CharacterObservations,
  FoldHudOptions,
  HudReadout,
  HudStat,
  HudStatId,
  HudState,
} from "./hud";
export {
  HUD_OBSERVATION_GATES,
  HUD_STAT_IDS,
  createHud,
  foldHandIntoHud,
  foldHandsIntoHud,
  hudFor,
} from "./hud";

// -- rating -----------------------------------------------------------------
export type { ConceptMastery, RatingPoint, RatingState, RatingTrend, TrendDirection } from "./rating";
export {
  BAND_QUALITY,
  CONFIDENCE_WEIGHT,
  HISTORY_CAP,
  QUALITY_SCALE_BB,
  RATING_GAIN,
  RATING_GAIN_HALFLIFE_HANDS,
  RATING_GAIN_MIN,
  RATING_MAX,
  RATING_MIN,
  RATING_START,
  TIER_BOUNDARIES,
  TREND_FLAT_BAND,
  conceptTier,
  decisionQuality,
  initialRating,
  qualityToRating,
  ratingGain,
  ratingTier,
  ratingTrend,
  updateRating,
  updateRatingAll,
  weakestConcepts,
} from "./rating";

// -- ICM --------------------------------------------------------------------
export type { CrossCheckVerdict, IcmAllInResult, IcmAllInSpot, PushFoldCrossCheck } from "./icm";
export {
  CROSS_CHECK_JAM_WEIGHT,
  MAX_ICM_PLAYERS,
  icmAllInEv,
  icmDiff,
  icmEquities,
  pushFoldCrossCheck,
} from "./icm";
