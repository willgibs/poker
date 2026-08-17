/**
 * The decision trace — the bot-mind-reveal payload.
 *
 * Every stage of the pipeline records its inputs and outputs here, including
 * the full candidate EV table. This is not debug output: the PRD ships it as a
 * player-facing feature ("reveal minds": holding, EV table, tilt state,
 * deliberate-error flag) and the replayer's what-if explorer reads it. Treat
 * the shape as a consumed contract, and keep it JSON-safe.
 */

import type { Card } from "@poker/core";
import type { ActionKind, Street } from "@poker/history";
import type { Intent, Tier } from "./persona";
import type { BoardTexture } from "./texture";
import type { LineFeatures } from "./eventscan";
import type { MadeClass } from "./handclass";

/** The nine stages, in execution order. Stage 9 is this trace's own emission. */
export const STAGE_NAMES = [
  "context",
  "range-state",
  "strength",
  "candidates",
  "shaping",
  "tilt-error",
  "adaptation",
  "think-time",
  "trace",
] as const;

export type StageName = (typeof STAGE_NAMES)[number];

/** Stage 1 — the decision's physical facts. */
export interface ContextTrace {
  street: Street;
  seat: number;
  position: string;
  inPosition: boolean;
  pot: number;
  toCall: number;
  stack: number;
  effectiveStack: number;
  spr: number;
  potOddsRequired: number;
  opponents: readonly number[];
  board: readonly Card[];
  hole: readonly [Card, Card];
  texture: BoardTexture;
  scareCard: boolean;
  line: LineFeatures;
  legal: readonly ActionKind[];
}

/** Stage 2 — the Bayesian range estimate per live opponent. */
export interface OpponentRangeTrace {
  seat: number;
  /** Effective combo count of the posterior (0-1326). */
  combos: number;
  /** Weighted mean strength percentile of the posterior. */
  meanStrength: number;
  /** Number of `filter` updates applied this hand. */
  updates: number;
  /** The actions the updates conditioned on, in order. */
  observedActions: readonly string[];
}

export interface RangeStateTrace {
  /** False for tiers 1-2, which read raw strength and no ranges at all. */
  filtered: boolean;
  epsilonFloor: number;
  priorPercent: number;
  opponents: readonly OpponentRangeTrace[];
}

/** Stage 3 — tier-dependent strength estimate. */
export interface StrengthTrace {
  method: "raw-vs-random" | "mc-vs-range" | "mc-vs-range-blockers";
  trials: number;
  /** Raw MC equity against the modelled range. */
  equityRaw: number;
  /** Equity after blocker adjustment (equals `equityRaw` below tier 5). */
  equity: number;
  /** Blocker adjustment applied, in equity points. */
  blockerAdjustment: number;
  /** Fraction of the villain's value combos the bot's cards remove. */
  valueBlocked: number;
  /** Percentile of the bot's holding within its own arriving range. */
  strengthPercentile: number;
  made: MadeClass;
  flushDraw: boolean;
  oesd: boolean;
  gutshot: boolean;
  outs: number;
}

/** One row of the candidate EV table. */
export interface CandidateTrace {
  kind: ActionKind;
  /** Engine action amount (bet size, or raise-to total). */
  amount?: number;
  /** Chips this action adds beyond the current street commitment. */
  invest: number;
  /** Size as a fraction of the pot (postflop) or of the bet level (preflop). */
  sizeFraction: number;
  intent: Intent;
  /** Assumed fold frequency of the field against this action. */
  foldFreq: number;
  /** Equity used when called. */
  equityWhenCalled: number;
  /** One-street EV in cents, relative to folding = 0. */
  ev: number;
  /** EV after personality shaping. */
  shapedEv: number;
  /** Softmax probability after shaping and gating. */
  probability: number;
  /** True when the bluff gate removed this candidate from the pool. */
  gatedOut?: boolean;
}

export interface CandidatesTrace {
  rows: readonly CandidateTrace[];
  /** Index into `rows` of the highest raw-EV candidate. */
  bestIndex: number;
  /** Normalised closeness between the best two shaped candidates, [0, 1]. */
  closeness: number;
}

/** Stage 5 — personality shaping. */
export interface ShapingTrace {
  temperature: number;
  evScale: number;
  aggressionBias: number;
  callDownBias: number;
  foldBias: number;
  bluffGate: { roll: number; threshold: number; open: boolean; dropped: number };
  /** Chart-derived push/fold nudge, when a Nash chart applied. */
  nashChart?: { chartId: string; depthBb: number; weight: number };
  selection: { roll: number; kind: ActionKind; amount?: number };
}

/** Stage 6 — tilt state and the deliberate error. */
export interface TiltTrace {
  tilt: number;
  susceptibility: number;
  effectiveAggression: number;
  effectiveCallDown: number;
  effectiveErrorRate: number;
  /** Whether stage 6's re-selection changed the stage-5 choice. */
  changedChoice: boolean;
  deliberateError: boolean;
  /** The persona's characteristic mistake class id, when the error fired. */
  errorClass?: string;
  errorLabel?: string;
  /** EV given up, in cents, when the error fired. */
  evSacrificed: number;
  errorRoll: number;
}

/** Stage 7 — adaptation memory. */
export interface AdaptationTrace {
  /** Adaptation strength actually applied, [0, 1]. */
  ramp: number;
  handsObserved: number;
  /** Signed shift applied to modelled fold equity, capped. */
  foldEquityShift: number;
  /** Observed fold-to-bet of the primary opponent, when modelled. */
  observedFoldToBet: number;
  /** Observed call-down of the primary opponent, when modelled. */
  observedCallDown: number;
  primaryOpponent: number | null;
  capped: boolean;
}

/** Stage 8 — think time. */
export interface TimingTrace {
  closeness: number;
  /** Band before tells, tilt and jitter. */
  baseBand: { minMs: number; maxMs: number };
  /** Band after tells. */
  band: { minMs: number; maxMs: number };
  jitterRoll: number;
  tiltScale: number;
  floorMs: number;
  thinkTimeMs: number;
}

/** A tell that fired, and what it did. */
export interface FiredTellTrace {
  id: string;
  kind: string;
  signature: boolean;
  read: string;
  /** Human-readable summary of the modulation applied. */
  effect: string;
}

/** The complete nine-stage trace. */
export interface DecisionTrace {
  v: 1;
  personaId: string;
  personaName: string;
  tier: Tier;
  /** Every stage that ran, in order — always all nine. */
  stagesCompleted: readonly StageName[];
  context: ContextTrace;
  rangeState: RangeStateTrace;
  strength: StrengthTrace;
  candidates: CandidatesTrace;
  shaping: ShapingTrace;
  tiltError: TiltTrace;
  adaptation: AdaptationTrace;
  timing: TimingTrace;
  tells: readonly FiredTellTrace[];
  chosen: {
    kind: ActionKind;
    amount?: number;
    sizeFraction: number;
    intent: Intent;
    ev: number;
  };
}
