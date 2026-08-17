/**
 * @packageDocumentation
 * # @poker/bots — the nine-stage decision pipeline
 *
 * Twelve authored characters and one pure function:
 *
 * ```ts
 * decide(snapshot, botState, streams) →
 *   { action, amount?, thinkTimeMs, trace, nextBotState }
 * ```
 *
 * ```
 * 1 context      2 range state   3 strength     4 candidates + EV
 * 5 shaping      6 tilt/error    7 adaptation   8 think time    9 trace
 * ```
 *
 * Everything is deterministic: identical inputs and seeds always give an
 * identical decision, on every platform. Randomness arrives only through the
 * two injected `RngStream`s; think time is COMPUTED from decision closeness and
 * the persona's timing signature, never measured — the Presenter owns speed.
 *
 * The trace is a product surface, not debug output: it is the bot-mind reveal
 * the replayer shows at showdown, and `policyLikelihood` is exported so
 * analysis can reproduce a bot's read with the identical generative model.
 */

// --- persona schema --------------------------------------------------------
export type {
  BiasUnits,
  Bound,
  Frequencies,
  Intent,
  MistakeBias,
  MistakeClass,
  MistakeClassId,
  MistakeCondition,
  PersonaConfig,
  PersonaGates,
  PersonaParams,
  SizingSet,
  SizingStyle,
  TellBehavior,
  TellKind,
  TellSpec,
  TellTrigger,
  Tier,
  TierCapabilities,
  TierEnvelope,
  TiltProfile,
  TimingBand,
  TimingSignature,
  ValidationResult,
} from "./persona";
export {
  MISTAKE_IDS_IN_USE,
  SIZING_STYLE_DEFAULTS,
  TIER_ENVELOPES,
  TIERS,
  assertPersona,
  capabilitiesFor,
  envelopeFor,
  resolveFrequencies,
  sizingSetOf,
  validatePersona,
  validateTell,
  validateTiming,
} from "./persona";

// --- the cast --------------------------------------------------------------
export {
  BARRY,
  CAST,
  CAST_BY_ID,
  CHIP,
  DORIS,
  HANK,
  INGRID,
  LUNA,
  MAXINE,
  PRIYA,
  RIVALS_ARC,
  ROCCO,
  SILAS,
  THE_PROFESSOR,
  VERA,
  castOfTier,
  personaById,
} from "./cast/index";

// --- state -----------------------------------------------------------------
export type { BotState, BotStateSnapshot, OpponentStats } from "./state";
export {
  ADAPTATION_RAMP_HANDS,
  OPPONENT_EW_ALPHA,
  adaptationRamp,
  cloneBotState,
  initialBotState,
  initialOpponentStats,
  opponentOf,
  restoreBotState,
  snapshotBotState,
} from "./state";

// --- the pipeline ----------------------------------------------------------
export type { BotDecision, BotStreams, ChosenAction, DecisionSnapshot } from "./types";
export { decide, decideAction } from "./pipeline";
export { observeHandEnd } from "./observe";
export type { ObserveOptions } from "./observe";

// --- trace (the bot-mind-reveal payload) -----------------------------------
export type {
  AdaptationTrace,
  CandidateTrace,
  CandidatesTrace,
  ContextTrace,
  DecisionTrace,
  FiredTellTrace,
  OpponentRangeTrace,
  RangeStateTrace,
  ShapingTrace,
  StageName,
  StrengthTrace,
  TiltTrace,
  TimingTrace,
} from "./trace";
export { STAGE_NAMES } from "./trace";

// --- stage internals worth reusing ----------------------------------------
export type { DecisionContext } from "./context";
export { buildContext, offsetFromButton } from "./context";

export type { BoardTexture, TextureLabel } from "./texture";
export { classifyTexture, isScareCard, streetOfBoard } from "./texture";

export type { HoldingFeatures, MadeClass } from "./handclass";
export { MADE_CLASS_ORDER, holdingFeatures, holdingScore, madeRankOf } from "./handclass";

export type { PolicyObservation, PolicyParams, RangeStrengthSummary } from "./policy";
export {
  DEFAULT_POLICY_PARAMS,
  LIKELIHOOD_FLOOR,
  aggressionOf,
  comboStrengthPercentiles,
  continuanceFraction,
  continuationOf,
  policyLikelihood,
  summarizeAgainst,
} from "./policy";

export type { RangeState } from "./rangeState";
export { assumedParamsFor, buildRangeState } from "./rangeState";

export type { StrengthEstimate } from "./strength";
export { MAX_BLOCKER_ADJUSTMENT, VALUE_PERCENTILE, estimateStrength, valueBlockedFraction } from "./strength";

export type { Candidate, CandidateSet } from "./candidates";
export { MAX_FOLD_FREQ, NAIVE_FOLD_FREQ, buildCandidates, candidatesTrace } from "./candidates";

export type { ShapingInput, ShapingResult } from "./shaping";
export { TEMPERATURE_BASE, shapeAndSelect } from "./shaping";

export type { ErrorInjection, TiltAdjustedParams } from "./tilt";
export {
  OVERFOLDER_FOLD_TO_BET,
  STATION_CALLDOWN,
  detectBadBeat,
  injectDeliberateError,
  mistakeEligible,
  tiltAdjust,
} from "./tilt";

export type { AdaptationResult } from "./adaptation";
export {
  ADAPTATION_GAIN,
  MAX_FOLD_EQUITY_SHIFT,
  NEUTRAL_FOLD_TO_BET,
  computeAdaptation,
  updateOpponents,
} from "./adaptation";

export type { BehaviorTellResult, SizingTellResult, TellFacts, TimingTellResult } from "./tells";
export { applyBehaviorTells, applySizingTells, applyTimingTells, sizeAxisOf, tellFires } from "./tells";

export type { TimingInput, TimingResult } from "./timing";
export { bandForCloseness, computeThinkTime } from "./timing";

export type { NashRead } from "./pushfold";
export { nashRead } from "./pushfold";

export type { ActRecord, HandScan, LineFeatures } from "./eventscan";
export { lineFeatures, scanHand } from "./eventscan";
