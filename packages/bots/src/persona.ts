/**
 * Persona schema — the typed form of the character bibles' `parameters` YAML,
 * plus the deterministic tell / timing / mistake specifications that turn a
 * parameter block into a recognisable human being at the table.
 *
 * Zod-free by policy (zero runtime dependencies): validation is a set of plain
 * functions returning `{ ok, errors }`, in the same shape `@poker/history`'s
 * `validateEvents` uses.
 *
 * ## The two bias unit systems
 *
 * The bibles declare `biasUnits` per character (`content/characters/_index.md`,
 * "Bias units"): tiers 1-2 use `envelope-normalized` (−1 = the tier's loosest
 * floor … +1 = its ceiling) and tiers 3-6 use `probability-points` (absolute
 * offsets from the tier baseline). Both map into the same place —
 * {@link resolveFrequencies} returns concrete VPIP/PFR fractions — so nothing
 * downstream of the schema ever needs to know which convention a persona was
 * authored in.
 *
 * ## Tier envelopes
 *
 * {@link TIER_ENVELOPES} is the capability + bounds table. Capability flags are
 * what a tier's *model* is allowed to do (range filtering, fold equity,
 * blockers, balance) — that is the real skill ladder; the numeric bounds keep
 * authored personas inside their tier's behavioural band. A persona that
 * violates its envelope is a content bug, and `packages/bots/src/cast` is
 * validated against this table in CI.
 */

import type { ActionKind, Street } from "@poker/history";

// ---------------------------------------------------------------------------
// Scalar vocabulary
// ---------------------------------------------------------------------------

/** Skill tier, 1 (whale) … 6 (crusher). Two cast members per tier. */
export type Tier = 1 | 2 | 3 | 4 | 5 | 6;

/** All tiers, ascending. */
export const TIERS: readonly Tier[] = [1, 2, 3, 4, 5, 6];

/** How a persona's `vpipBias`/`pfrBias` numbers should be read. */
export type BiasUnits = "envelope-normalized" | "probability-points";

/** Coarse bet-sizing personality; expands to a {@link SizingSet}. */
export type SizingStyle = "small" | "standard" | "large" | "polar";

/** Why a candidate action exists — drives tells, bluff gating and traces. */
export type Intent = "value" | "bluff" | "neutral";

/** A raw think-time band in milliseconds. Never speed-scaled here: the
 * Presenter owns speed (docs/architecture.md, ring 2). */
export interface TimingBand {
  minMs: number;
  maxMs: number;
}

// ---------------------------------------------------------------------------
// Tells
// ---------------------------------------------------------------------------

/**
 * What channel a tell leaks through. Only `sizing` and `timing` tells are
 * *executed* by the decision pipeline; `banter` and `behavior` tells are
 * transcribed from the bibles so the content layer (out of scope here) and the
 * earned-read surface have one schema to read from.
 */
export type TellKind = "sizing" | "timing" | "banter" | "behavior";

/**
 * Deterministic trigger. Every field is a conjunct: a tell fires when ALL
 * present fields match. Absent fields do not constrain.
 */
export interface TellTrigger {
  /** Streets the tell can fire on. */
  streets?: readonly Street[];
  /** Action kinds the tell applies to. */
  actions?: readonly ActionKind[];
  /** Required intent of the action under consideration. */
  intent?: Intent;
  /** Bot's own estimated strength percentile window, [0, 1]. */
  minStrength?: number;
  maxStrength?: number;
  /** Tilt window, [0, 1]. */
  minTilt?: number;
  maxTilt?: number;
  /** Whether the bot is facing chips. */
  facing?: "bet" | "no-bet";
  /** Relative position against the live field. */
  position?: "ip" | "oop";
  /**
   * Minimum size of the action under consideration, as a fraction of the pot
   * it faces — the one sizing axis, on every street.
   */
  minSizeFraction?: number;
  /** Only heads-up pots. */
  headsUp?: true;
  /** Only when the hero is the opponent in the pot. */
  vsHero?: true;
  /** Only once at least this many hands have been observed together. */
  minHandsObserved?: number;
  /** Made-hand classes that satisfy the trigger (see handclass.ts). */
  madeClasses?: readonly string[];
  /** Requires a flush draw / open-ended straight draw. */
  requiresDraw?: "flush" | "oesd" | "either";
  /** Minimum pot size in big blinds. */
  minPotBb?: number;
  /** Hands that must elapse between two firings of this tell. */
  cooldownHands?: number;
  /** Requires two suited hole cards (Luna's "suits are destiny"). */
  requiresSuited?: true;
  /** Requires this many hands since the bot last saw a flop (Luna's fuse). */
  minHandsSinceFlop?: number;
  /** Requires the modelled opponent to be a station. */
  vsStation?: true;
  /** Requires the modelled opponent to be an over-folder. */
  vsOverfolder?: true;
  /** Requires the opponent sample to still be thin (Ingrid's "no blind bluffs"). */
  maxOpponentHands?: number;
  /** Requires adaptation to be actively deviating by at least this much. */
  minAdaptationShift?: number;
  /** Requires an opponent to have checked this many streets in a row. */
  minOpponentConsecutiveChecks?: number;
  /** Requires one-card flush interest (Priya's re-peek). */
  requiresOneCardFlushInterest?: true;
}

/** What the tell does when it fires. Sizing and timing effects are applied by
 * the pipeline; the content flags are declarative only. */
export interface TellBehavior {
  /** Replace the think-time band outright (raw ms, pre-jitter). */
  thinkTimeMs?: TimingBand;
  /** Multiply the computed think time. */
  thinkTimeScale?: number;
  /** Force the chosen size into this pot-fraction band. */
  sizeBand?: [number, number];
  /** Map strength percentile onto this ascending ladder of pot fractions. */
  sizeLadder?: readonly number[];
  /** Multiply the chosen size fraction. */
  sizeScale?: number;
  /** Content-layer flag: suppress banter for the rest of the hand. */
  banterSuppressed?: true;
  /** Content-layer flag: scale banter emission chance. */
  banterChanceScale?: number;
  /** Remove the fold branch from the candidate pool entirely. */
  disableFold?: true;
  /** Extra EV bias on aggressive rows, in `evScale` units. */
  aggressionBias?: number;
  /** Multiply the bluff gate threshold (0.5 = "bluffs half as often here"). */
  bluffFrequencyScale?: number;
  /** Presentation-only cue for the table layer (a re-peek, a tidy stack). */
  animationCue?: string;
  /**
   * A STRUCTURAL read rather than a behavioural leak: a property of the
   * persona's strategy a student can discover and exploit with correct math
   * (the tier-6 "anti-tells"). Never evaluated by the pipeline — it leaks no
   * information through behaviour, which is the entire point.
   */
  structural?: true;
}

/** One deterministic trigger → behavior rule. */
export interface TellSpec {
  /** Stable id, unique within the persona (used for cooldown bookkeeping). */
  id: string;
  kind: TellKind;
  /** The character's headline read (bible tell #1). */
  signature?: boolean;
  trigger: TellTrigger;
  behavior: TellBehavior;
  /** One-line player-facing read, in the coach's voice. */
  read: string;
}

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

/**
 * Think-time distribution. The pipeline interpolates
 * `trivial → base → close` by decision closeness (the normalised EV gap
 * between the best two candidates), then applies per-street and per-action
 * overrides, tells, tilt and jitter. All values are raw milliseconds at 1x.
 */
export interface TimingSignature {
  /** Band for an ordinary decision (closeness ≈ 0.5). */
  base: TimingBand;
  /** Band for an obvious decision (closeness 0). */
  trivial: TimingBand;
  /** Band for a genuinely close decision (closeness 1). */
  close: TimingBand;
  /** Optional per-street override of `base`. */
  streets?: Partial<Record<Street, TimingBand>>;
  /** Optional band used for every fold. */
  fold?: TimingBand;
  /** Optional band used for every check. */
  check?: TimingBand;
  /** Optional band used whenever the bot puts chips in voluntarily. */
  aggression?: TimingBand;
  /** Multiplier at tilt = 1 (Chip 0.6 = 40% faster; Priya 1.5 = slower). */
  tiltScale: number;
  /** Relative jitter as a fraction of band width, [0, 1]. */
  jitter: number;
  /** Hard floor in ms; the returned think time never drops below it. */
  floorMs: number;
}

// ---------------------------------------------------------------------------
// Mistakes
// ---------------------------------------------------------------------------

/** The 12 authored mistake classes — one per cast member (PRD "authored
 * imperfection": every character errs in their OWN way, never uniform noise). */
export type MistakeClassId =
  | "pathological-calling"
  | "unprovoked-spew"
  | "priced-out-chasing"
  | "missed-value"
  | "fit-or-fold-overfold"
  | "disciplined-overfold"
  | "third-barrel-into-a-wall"
  | "encore-bluff"
  | "standard-line-tax"
  | "overfitting"
  | "equilibrium-tax"
  | "pressure-addiction";

/** The authored mistake classes, in cast order. */
export const MISTAKE_IDS_IN_USE: readonly MistakeClassId[] = [
  "pathological-calling",
  "unprovoked-spew",
  "priced-out-chasing",
  "missed-value",
  "fit-or-fold-overfold",
  "disciplined-overfold",
  "third-barrel-into-a-wall",
  "encore-bluff",
  "standard-line-tax",
  "overfitting",
  "equilibrium-tax",
  "pressure-addiction",
];

/** Which direction the characteristic error pushes the decision. */
export type MistakeBias = "call" | "fold" | "raise" | "bet" | "check";

/** When the characteristic error is even eligible to fire. */
export interface MistakeCondition {
  streets?: readonly Street[];
  facingBet?: boolean;
  /** Requires holding a draw. */
  withDraw?: boolean;
  /** Bot strength percentile window. */
  minStrength?: number;
  maxStrength?: number;
  /** Requires the modelled opponent to be a station (high call-down). */
  vsStation?: boolean;
  /** Requires the modelled opponent to be an over-folder. */
  vsOverfolder?: boolean;
  /** Requires an active tilt window. */
  requiresTilt?: number;
  /** Requires a thin opponent sample (Ingrid's overfitting). */
  maxOpponentHands?: number;
}

/** A persona's characteristic mistake class. */
export interface MistakeClass {
  id: MistakeClassId;
  /** Short label for the bot-mind reveal. */
  label: string;
  bias: MistakeBias;
  when: MistakeCondition;
  /** Ceiling on EV knowingly sacrificed, in big blinds. */
  maxEvSacrificeBb: number;
}

// ---------------------------------------------------------------------------
// Sizing + tilt profiles
// ---------------------------------------------------------------------------

/** The persona's concrete sizing vocabulary. */
export interface SizingSet {
  /** Postflop bet/raise sizes, as fractions of the pot. */
  potFractions: readonly number[];
  /** Preflop raise-to multipliers of the current bet level. */
  preflopMultipliers: readonly number[];
  /** Band a value bet is drawn from (fraction of pot), when authored. */
  valueBand?: [number, number];
  /** Band a bluff / give-up bet is drawn from, when authored. */
  bluffBand?: [number, number];
}

/** Default sizing vocabulary per {@link SizingStyle}. */
export const SIZING_STYLE_DEFAULTS: Readonly<Record<SizingStyle, SizingSet>> = {
  small: { potFractions: [0.25, 0.35, 0.5], preflopMultipliers: [2, 2.2, 2.5] },
  standard: { potFractions: [0.33, 0.5, 0.66, 0.75], preflopMultipliers: [2.2, 2.5, 3] },
  large: { potFractions: [0.66, 0.85, 1.1], preflopMultipliers: [2.5, 3, 4] },
  polar: { potFractions: [0.33, 1, 1.4], preflopMultipliers: [2.2, 3, 4.5] },
};

/** How tilt arrives and how it leaves. Mood arcs, not switches (PRD #2). */
export interface TiltProfile {
  /** Tilt added by a detected bad beat, before tiltSusceptibility scaling. */
  badBeatSpike: number;
  /** Tilt added by a big losing hand, before scaling. */
  bigLossSpike: number;
  /** Loss in big blinds that counts as a "big loss". */
  bigLossBb: number;
  /** Fraction of remaining tilt shed each hand, (0, 1]. */
  decayPerHand: number;
  /** A won pot of at least this many bb clears tilt entirely (0 = never). */
  resetOnWinBb: number;
  /** Multiplier on aggression at tilt = 1. */
  aggressionGain: number;
  /** Multiplier on callDownTendency at tilt = 1. */
  callDownGain: number;
  /** Multiplier on errorRate at tilt = 1. */
  errorGain: number;
}

// ---------------------------------------------------------------------------
// The persona
// ---------------------------------------------------------------------------

/** The bible `parameters:` block, one-to-one. */
export interface PersonaParams {
  tier: Tier;
  biasUnits: BiasUnits;
  vpipBias: number;
  pfrBias: number;
  aggression: number;
  tightness: number;
  bluffFrequency: number;
  sizingStyle: SizingStyle;
  errorRate: number;
  tiltSusceptibility: number;
  adaptationRate: number;
  callDownTendency: number;
}

/**
 * Hard structural gates on the candidate pool.
 *
 * Several bibles specify branches that are *unreachable*, not merely rare —
 * "a raise from Doris is the nuts, always", "Barry does not bluff, because
 * bluffing feels dishonest", "Maxine's mid band has weight zero". A frequency
 * knob cannot express that, and the reads those characters teach depend on the
 * absoluteness. Gates remove the rows before pricing, so they can never be
 * softmaxed back in.
 */
export interface PersonaGates {
  /** Minimum strength percentile for ANY raise. */
  raiseMinStrength?: number;
  /** Minimum strength percentile for any bet or raise. */
  aggressionMinStrength?: number;
  /** Largest size a non-value action may use, as a fraction of pot. */
  nonValueMaxSizeFraction?: number;
  /** A pot-fraction band that carries zero weight (Maxine's missing middle). */
  forbiddenSizeBand?: readonly [number, number];
}

/** A complete, playable character. */
export interface PersonaConfig extends PersonaParams {
  /** Stable id, e.g. "rocco" — the cast key and the trace/persona label. */
  id: string;
  /** Display name, e.g. "Rocco". */
  name: string;
  /** One-line roster sketch (`_index.md`). */
  sketch: string;
  tells: readonly TellSpec[];
  timing: TimingSignature;
  mistake: MistakeClass;
  tilt: TiltProfile;
  /** Overrides {@link SIZING_STYLE_DEFAULTS} for this persona. */
  sizing?: SizingSet;
  /** Hard structural gates on the candidate pool. */
  gates?: PersonaGates;
}

// ---------------------------------------------------------------------------
// Tier envelopes
// ---------------------------------------------------------------------------

/** What a tier's decision model is permitted to do. */
export interface TierCapabilities {
  /** Stage 2 runs Bayesian action filtering instead of a static prior. */
  usesRangeFiltering: boolean;
  /** Stage 4 prices bets against a modelled continuance / fold frequency. */
  usesFoldEquity: boolean;
  /** Stage 3 adjusts equity for the value combos the bot's cards remove. */
  usesBlockers: boolean;
  /** Stage 5 keeps bluff:value proportional to sizing instead of free-running. */
  balanceAware: boolean;
}

/** Inclusive `[min, max]` bound on a persona parameter. */
export type Bound = readonly [number, number];

/** Per-tier envelope: capabilities, parameter bounds, frequency ranges. */
export interface TierEnvelope {
  tier: Tier;
  label: string;
  capabilities: TierCapabilities;
  bounds: {
    aggression: Bound;
    tightness: Bound;
    bluffFrequency: Bound;
    errorRate: Bound;
    tiltSusceptibility: Bound;
    adaptationRate: Bound;
    callDownTendency: Bound;
    vpipBias: Bound;
    pfrBias: Bound;
  };
  /** VPIP range the tier spans; `envelope-normalized` biases interpolate it. */
  vpipRange: Bound;
  /** PFR range the tier spans. */
  pfrRange: Bound;
  /**
   * Fixed Monte Carlo trial count for stage 3. Deliberately SMALL — a bot
   * decision has a 50ms P50 budget (docs/architecture.md) and a whale's
   * fuzzy read of its own equity is characterisation, not a defect.
   */
  mcTrials: number;
}

function env(
  tier: Tier,
  label: string,
  capabilities: TierCapabilities,
  bounds: TierEnvelope["bounds"],
  vpipRange: Bound,
  pfrRange: Bound,
  mcTrials: number,
): TierEnvelope {
  return { tier, label, capabilities, bounds, vpipRange, pfrRange, mcTrials };
}

const NORMALIZED_BIAS: Bound = [-1, 1];
const POINTS_BIAS: Bound = [-0.1, 0.1];

/**
 * The tier envelope table. Bounds are authored to contain the launch cast with
 * headroom for custom bots; they are deliberately narrow enough that a persona
 * pasted into the wrong tier fails validation.
 */
export const TIER_ENVELOPES: Readonly<Record<Tier, TierEnvelope>> = {
  1: env(
    1,
    "Whale",
    { usesRangeFiltering: false, usesFoldEquity: false, usesBlockers: false, balanceAware: false },
    {
      aggression: [0.05, 0.75],
      tightness: [0, 0.2],
      bluffFrequency: [0, 0.65],
      errorRate: [0.4, 0.75],
      tiltSusceptibility: [0, 0.6],
      adaptationRate: [0, 0.1],
      callDownTendency: [0.5, 1],
      vpipBias: NORMALIZED_BIAS,
      pfrBias: NORMALIZED_BIAS,
    },
    [0.55, 0.92],
    [0.02, 0.28],
    40,
  ),
  2: env(
    2,
    "Loose-passive",
    { usesRangeFiltering: false, usesFoldEquity: false, usesBlockers: false, balanceAware: false },
    {
      aggression: [0.02, 0.45],
      tightness: [0.1, 0.4],
      bluffFrequency: [0, 0.3],
      errorRate: [0.28, 0.52],
      tiltSusceptibility: [0, 1],
      adaptationRate: [0, 0.22],
      callDownTendency: [0.55, 1],
      vpipBias: NORMALIZED_BIAS,
      pfrBias: NORMALIZED_BIAS,
    },
    [0.38, 0.62],
    [0.05, 0.22],
    60,
  ),
  3: env(
    3,
    "ABC",
    { usesRangeFiltering: true, usesFoldEquity: true, usesBlockers: false, balanceAware: false },
    {
      aggression: [0.25, 0.5],
      tightness: [0.5, 0.85],
      bluffFrequency: [0.02, 0.2],
      errorRate: [0.2, 0.4],
      tiltSusceptibility: [0.1, 0.55],
      adaptationRate: [0.05, 0.4],
      callDownTendency: [0.15, 0.55],
      vpipBias: POINTS_BIAS,
      pfrBias: POINTS_BIAS,
    },
    [0.2, 0.32],
    [0.13, 0.24],
    120,
  ),
  4: env(
    4,
    "Aggressive",
    { usesRangeFiltering: true, usesFoldEquity: true, usesBlockers: false, balanceAware: false },
    {
      aggression: [0.6, 0.95],
      tightness: [0.22, 0.55],
      bluffFrequency: [0.3, 0.7],
      errorRate: [0.15, 0.35],
      tiltSusceptibility: [0.2, 0.95],
      adaptationRate: [0.1, 0.55],
      callDownTendency: [0.25, 0.7],
      vpipBias: POINTS_BIAS,
      pfrBias: POINTS_BIAS,
    },
    [0.22, 0.4],
    [0.16, 0.34],
    120,
  ),
  5: env(
    5,
    "Reg",
    { usesRangeFiltering: true, usesFoldEquity: true, usesBlockers: true, balanceAware: false },
    {
      aggression: [0.5, 0.78],
      tightness: [0.48, 0.7],
      bluffFrequency: [0.22, 0.45],
      // Locked by the tier-5 bibles: "Tier-5 envelope: errorRate 0.04-0.10".
      errorRate: [0.04, 0.1],
      tiltSusceptibility: [0.02, 0.3],
      adaptationRate: [0.25, 1],
      callDownTendency: [0.35, 0.6],
      vpipBias: POINTS_BIAS,
      pfrBias: POINTS_BIAS,
    },
    [0.2, 0.3],
    [0.16, 0.26],
    200,
  ),
  6: env(
    6,
    "Crusher",
    { usesRangeFiltering: true, usesFoldEquity: true, usesBlockers: true, balanceAware: true },
    {
      aggression: [0.55, 0.8],
      tightness: [0.5, 0.68],
      bluffFrequency: [0.28, 0.42],
      // Locked by the tier-6 bibles: "Tier-6 envelope: errorRate <= 0.04".
      errorRate: [0, 0.04],
      tiltSusceptibility: [0, 0.12],
      adaptationRate: [0, 0.85],
      callDownTendency: [0.35, 0.6],
      vpipBias: POINTS_BIAS,
      pfrBias: POINTS_BIAS,
    },
    [0.22, 0.29],
    [0.18, 0.25],
    240,
  ),
};

/** Envelope for a tier. Throws on an unknown tier. */
export function envelopeFor(tier: Tier): TierEnvelope {
  const e = TIER_ENVELOPES[tier];
  if (e === undefined) throw new RangeError(`unknown tier: ${String(tier)}`);
  return e;
}

/** Capability flags for a tier. */
export function capabilitiesFor(tier: Tier): TierCapabilities {
  return envelopeFor(tier).capabilities;
}

/** Effective sizing vocabulary of a persona. */
export function sizingSetOf(persona: PersonaConfig): SizingSet {
  if (persona.sizing !== undefined) return persona.sizing;
  const s = SIZING_STYLE_DEFAULTS[persona.sizingStyle];
  if (s === undefined) throw new RangeError(`unknown sizingStyle: ${persona.sizingStyle}`);
  return s;
}

// ---------------------------------------------------------------------------
// Bias resolution
// ---------------------------------------------------------------------------

/** Concrete preflop frequencies implied by a persona's biases. */
export interface Frequencies {
  /** Voluntarily-put-money-in-pot fraction, [0, 1]. */
  vpip: number;
  /** Preflop-raise fraction, [0, 1]; never above `vpip`. */
  pfr: number;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/**
 * Map a persona's `vpipBias`/`pfrBias` onto concrete frequencies, honouring
 * its declared `biasUnits`:
 *
 * - `envelope-normalized` (tiers 1-2): −1 → the tier floor, +1 → the tier
 *   ceiling, 0 → the midpoint.
 * - `probability-points` (tiers 3-6): an absolute offset from the tier
 *   baseline (the midpoint of the tier's range), clamped into the range.
 *
 * PFR is additionally clamped to at most VPIP — you cannot raise more often
 * than you enter.
 */
export function resolveFrequencies(persona: PersonaParams): Frequencies {
  const e = envelopeFor(persona.tier);
  const [vLo, vHi] = e.vpipRange;
  const [pLo, pHi] = e.pfrRange;
  let vpip: number;
  let pfr: number;
  if (persona.biasUnits === "envelope-normalized") {
    vpip = lerp(vLo, vHi, clamp((persona.vpipBias + 1) / 2, 0, 1));
    pfr = lerp(pLo, pHi, clamp((persona.pfrBias + 1) / 2, 0, 1));
  } else {
    vpip = clamp((vLo + vHi) / 2 + persona.vpipBias, vLo, vHi);
    pfr = clamp((pLo + pHi) / 2 + persona.pfrBias, pLo, pHi);
  }
  return { vpip, pfr: Math.min(pfr, vpip) };
}

// ---------------------------------------------------------------------------
// Validation (zod-free)
// ---------------------------------------------------------------------------

/** Result of a validation pass: every violation, not just the first. */
export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

const SIZING_STYLES: readonly SizingStyle[] = ["small", "standard", "large", "polar"];
const BIAS_UNITS: readonly BiasUnits[] = ["envelope-normalized", "probability-points"];
const TELL_KINDS: readonly TellKind[] = ["sizing", "timing", "banter", "behavior"];
const MISTAKE_BIASES: readonly MistakeBias[] = ["call", "fold", "raise", "bet", "check"];

function checkFraction(x: unknown, name: string, errors: string[]): void {
  if (typeof x !== "number" || !Number.isFinite(x) || x < 0 || x > 1) {
    errors.push(`${name} must be a finite number in [0, 1], got ${String(x)}`);
  }
}

function checkBound(x: number, bound: Bound, name: string, errors: string[]): void {
  const [lo, hi] = bound;
  if (!(x >= lo && x <= hi)) {
    errors.push(`${name} ${x} is outside its tier envelope [${lo}, ${hi}]`);
  }
}

function checkBand(band: TimingBand | undefined, name: string, errors: string[]): void {
  if (band === undefined) return;
  if (!Number.isFinite(band.minMs) || band.minMs < 0) {
    errors.push(`${name}.minMs must be a non-negative finite number, got ${band.minMs}`);
  }
  if (!Number.isFinite(band.maxMs) || band.maxMs < band.minMs) {
    errors.push(`${name}.maxMs must be >= minMs, got ${band.maxMs} < ${band.minMs}`);
  }
}

/** Validate the timing signature in isolation. */
export function validateTiming(t: TimingSignature, prefix = "timing"): ValidationResult {
  const errors: string[] = [];
  checkBand(t.base, `${prefix}.base`, errors);
  checkBand(t.trivial, `${prefix}.trivial`, errors);
  checkBand(t.close, `${prefix}.close`, errors);
  checkBand(t.fold, `${prefix}.fold`, errors);
  checkBand(t.check, `${prefix}.check`, errors);
  checkBand(t.aggression, `${prefix}.aggression`, errors);
  if (t.streets !== undefined) {
    for (const [street, band] of Object.entries(t.streets)) {
      checkBand(band, `${prefix}.streets.${street}`, errors);
    }
  }
  if (!Number.isFinite(t.tiltScale) || t.tiltScale <= 0) {
    errors.push(`${prefix}.tiltScale must be a positive finite number, got ${t.tiltScale}`);
  }
  checkFraction(t.jitter, `${prefix}.jitter`, errors);
  if (!Number.isInteger(t.floorMs) || t.floorMs < 0) {
    errors.push(`${prefix}.floorMs must be a non-negative integer, got ${t.floorMs}`);
  }
  if (t.trivial.minMs > t.close.maxMs) {
    errors.push(`${prefix}: trivial band sits entirely above the close band`);
  }
  return { ok: errors.length === 0, errors };
}

/** Validate one tell spec in isolation. */
export function validateTell(tell: TellSpec, prefix = "tell"): ValidationResult {
  const errors: string[] = [];
  const p = `${prefix}[${tell.id}]`;
  if (typeof tell.id !== "string" || tell.id.length === 0) errors.push(`${p}.id must be a non-empty string`);
  if (!TELL_KINDS.includes(tell.kind)) errors.push(`${p}.kind is not a known tell kind: ${tell.kind}`);
  if (typeof tell.read !== "string" || tell.read.length === 0) errors.push(`${p}.read must be a non-empty string`);
  const tr = tell.trigger;
  if (tr === undefined || typeof tr !== "object") {
    errors.push(`${p}.trigger must be an object`);
  } else {
    if (tr.minStrength !== undefined) checkFraction(tr.minStrength, `${p}.trigger.minStrength`, errors);
    if (tr.maxStrength !== undefined) checkFraction(tr.maxStrength, `${p}.trigger.maxStrength`, errors);
    if (tr.minTilt !== undefined) checkFraction(tr.minTilt, `${p}.trigger.minTilt`, errors);
    if (tr.maxTilt !== undefined) checkFraction(tr.maxTilt, `${p}.trigger.maxTilt`, errors);
    if (
      tr.minStrength !== undefined &&
      tr.maxStrength !== undefined &&
      tr.minStrength > tr.maxStrength
    ) {
      errors.push(`${p}.trigger strength window is empty`);
    }
  }
  const b = tell.behavior;
  if (b === undefined || typeof b !== "object") {
    errors.push(`${p}.behavior must be an object`);
  } else {
    checkBand(b.thinkTimeMs, `${p}.behavior.thinkTimeMs`, errors);
    if (b.thinkTimeScale !== undefined && (!Number.isFinite(b.thinkTimeScale) || b.thinkTimeScale <= 0)) {
      errors.push(`${p}.behavior.thinkTimeScale must be positive`);
    }
    if (b.sizeBand !== undefined) {
      const [lo, hi] = b.sizeBand;
      if (!(lo > 0) || !(hi >= lo)) errors.push(`${p}.behavior.sizeBand must be an ascending positive band`);
    }
    if (b.sizeLadder !== undefined) {
      if (b.sizeLadder.length === 0) errors.push(`${p}.behavior.sizeLadder must be non-empty`);
      for (let i = 1; i < b.sizeLadder.length; i++) {
        const prev = b.sizeLadder[i - 1] ?? 0;
        const cur = b.sizeLadder[i] ?? 0;
        if (cur < prev) errors.push(`${p}.behavior.sizeLadder must ascend`);
      }
    }
    const applies =
      b.thinkTimeMs !== undefined ||
      b.thinkTimeScale !== undefined ||
      b.sizeBand !== undefined ||
      b.sizeLadder !== undefined ||
      b.sizeScale !== undefined ||
      b.banterSuppressed !== undefined ||
      b.banterChanceScale !== undefined ||
      b.disableFold !== undefined ||
      b.aggressionBias !== undefined ||
      b.bluffFrequencyScale !== undefined ||
      b.animationCue !== undefined ||
      b.structural !== undefined;
    if (!applies) errors.push(`${p}.behavior does nothing`);
    if (tell.kind === "timing" && b.thinkTimeMs === undefined && b.thinkTimeScale === undefined) {
      errors.push(`${p}: a timing tell must modulate think time`);
    }
    if (
      tell.kind === "sizing" &&
      b.sizeBand === undefined &&
      b.sizeLadder === undefined &&
      b.sizeScale === undefined
    ) {
      errors.push(`${p}: a sizing tell must modulate sizing`);
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Validate a persona against its tier envelope and the schema's own
 * invariants. Returns every violation found — content bugs come in clusters.
 */
export function validatePersona(persona: PersonaConfig): ValidationResult {
  const errors: string[] = [];
  const id = typeof persona.id === "string" && persona.id.length > 0 ? persona.id : "<unnamed>";

  if (typeof persona.id !== "string" || persona.id.length === 0) errors.push("id must be a non-empty string");
  if (typeof persona.name !== "string" || persona.name.length === 0) errors.push(`${id}: name must be a non-empty string`);
  if (typeof persona.sketch !== "string" || persona.sketch.length === 0) errors.push(`${id}: sketch must be a non-empty string`);

  if (!TIERS.includes(persona.tier)) {
    errors.push(`${id}: tier must be 1-6, got ${String(persona.tier)}`);
    return { ok: false, errors };
  }
  if (!BIAS_UNITS.includes(persona.biasUnits)) {
    errors.push(`${id}: biasUnits must be one of ${BIAS_UNITS.join(" | ")}, got ${persona.biasUnits}`);
  }
  if (!SIZING_STYLES.includes(persona.sizingStyle)) {
    errors.push(`${id}: sizingStyle must be one of ${SIZING_STYLES.join(" | ")}, got ${persona.sizingStyle}`);
  }

  const e = envelopeFor(persona.tier);
  checkFraction(persona.aggression, `${id}.aggression`, errors);
  checkFraction(persona.tightness, `${id}.tightness`, errors);
  checkFraction(persona.bluffFrequency, `${id}.bluffFrequency`, errors);
  checkFraction(persona.errorRate, `${id}.errorRate`, errors);
  checkFraction(persona.tiltSusceptibility, `${id}.tiltSusceptibility`, errors);
  checkFraction(persona.adaptationRate, `${id}.adaptationRate`, errors);
  checkFraction(persona.callDownTendency, `${id}.callDownTendency`, errors);
  if (!Number.isFinite(persona.vpipBias)) errors.push(`${id}.vpipBias must be finite`);
  if (!Number.isFinite(persona.pfrBias)) errors.push(`${id}.pfrBias must be finite`);

  checkBound(persona.aggression, e.bounds.aggression, `${id}.aggression`, errors);
  checkBound(persona.tightness, e.bounds.tightness, `${id}.tightness`, errors);
  checkBound(persona.bluffFrequency, e.bounds.bluffFrequency, `${id}.bluffFrequency`, errors);
  checkBound(persona.errorRate, e.bounds.errorRate, `${id}.errorRate`, errors);
  checkBound(persona.tiltSusceptibility, e.bounds.tiltSusceptibility, `${id}.tiltSusceptibility`, errors);
  checkBound(persona.adaptationRate, e.bounds.adaptationRate, `${id}.adaptationRate`, errors);
  checkBound(persona.callDownTendency, e.bounds.callDownTendency, `${id}.callDownTendency`, errors);
  checkBound(persona.vpipBias, e.bounds.vpipBias, `${id}.vpipBias`, errors);
  checkBound(persona.pfrBias, e.bounds.pfrBias, `${id}.pfrBias`, errors);

  // The bibles' declared units must match the tier convention in _index.md.
  const expectedUnits: BiasUnits = persona.tier <= 2 ? "envelope-normalized" : "probability-points";
  if (persona.biasUnits !== expectedUnits) {
    errors.push(`${id}: tier ${persona.tier} declares biasUnits "${persona.biasUnits}", roster doctrine says "${expectedUnits}"`);
  }

  if (!Array.isArray(persona.tells) || persona.tells.length === 0) {
    errors.push(`${id}: tells must be a non-empty array`);
  } else {
    const seen = new Set<string>();
    let signatures = 0;
    for (const tell of persona.tells) {
      if (seen.has(tell.id)) errors.push(`${id}: duplicate tell id ${tell.id}`);
      seen.add(tell.id);
      if (tell.signature === true) signatures++;
      errors.push(...validateTell(tell, `${id}.tells`).errors);
    }
    if (signatures > 1) errors.push(`${id}: at most one signature tell, got ${signatures}`);
  }

  errors.push(...validateTiming(persona.timing, `${id}.timing`).errors);

  const m = persona.mistake;
  if (m === undefined) {
    errors.push(`${id}: mistake class is required (authored imperfection is doctrine)`);
  } else {
    if (typeof m.label !== "string" || m.label.length === 0) errors.push(`${id}.mistake.label must be non-empty`);
    if (!MISTAKE_IDS_IN_USE.includes(m.id)) errors.push(`${id}.mistake.id is unknown: ${String(m.id)}`);
    if (!MISTAKE_BIASES.includes(m.bias)) errors.push(`${id}.mistake.bias is unknown: ${m.bias}`);
    if (!Number.isFinite(m.maxEvSacrificeBb) || m.maxEvSacrificeBb < 0) {
      errors.push(`${id}.mistake.maxEvSacrificeBb must be a non-negative finite number`);
    }
  }

  const t = persona.tilt;
  if (t === undefined) {
    errors.push(`${id}: tilt profile is required`);
  } else {
    checkFraction(t.badBeatSpike, `${id}.tilt.badBeatSpike`, errors);
    checkFraction(t.bigLossSpike, `${id}.tilt.bigLossSpike`, errors);
    if (!Number.isFinite(t.bigLossBb) || t.bigLossBb <= 0) errors.push(`${id}.tilt.bigLossBb must be positive`);
    if (!(t.decayPerHand > 0 && t.decayPerHand <= 1)) errors.push(`${id}.tilt.decayPerHand must be in (0, 1]`);
    if (!Number.isFinite(t.resetOnWinBb) || t.resetOnWinBb < 0) errors.push(`${id}.tilt.resetOnWinBb must be >= 0`);
    for (const [k, v] of [
      ["aggressionGain", t.aggressionGain],
      ["callDownGain", t.callDownGain],
      ["errorGain", t.errorGain],
    ] as const) {
      if (!Number.isFinite(v) || v <= 0) errors.push(`${id}.tilt.${k} must be positive`);
    }
  }

  if (persona.sizing !== undefined) {
    const s = persona.sizing;
    if (s.potFractions.length === 0) errors.push(`${id}.sizing.potFractions must be non-empty`);
    if (s.preflopMultipliers.length === 0) errors.push(`${id}.sizing.preflopMultipliers must be non-empty`);
    for (const f of s.potFractions) {
      if (!Number.isFinite(f) || f <= 0) errors.push(`${id}.sizing.potFractions must be positive, got ${f}`);
    }
    for (const f of s.preflopMultipliers) {
      if (!Number.isFinite(f) || f <= 1) errors.push(`${id}.sizing.preflopMultipliers must exceed 1, got ${f}`);
    }
    if (s.valueBand !== undefined && s.bluffBand !== undefined) {
      const [, bluffHi] = s.bluffBand;
      const [valueLo] = s.valueBand;
      if (bluffHi > valueLo) {
        errors.push(`${id}.sizing: value and bluff bands overlap — the sizing tell would be unreadable`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/** {@link validatePersona}, throwing on failure. */
export function assertPersona(persona: PersonaConfig): void {
  const { ok, errors } = validatePersona(persona);
  if (!ok) throw new RangeError(`invalid persona ${persona.id}:\n  ${errors.join("\n  ")}`);
}
