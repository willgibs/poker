/**
 * Stage 5 — personality shaping.
 *
 * EV alone produces one player, repeated twelve times. Shaping is where the
 * cast diverges: aggression adds a bias to every aggressive row, call-down
 * tendency to the call row, tightness to the fold row, and a temperature
 * softmax turns the shaped table into a distribution rather than an argmax —
 * so a character who is 70% right is right 70% of the time, not always.
 *
 * The bluff gate is separate and deliberately coarse: one seeded roll per
 * decision decides whether the persona is bluffing here AT ALL. That is what
 * makes `bluffFrequency` legible in the trace ("the gate was shut") instead of
 * disappearing into softmax weights nobody can read.
 *
 * Temperature scales with `errorRate`, which is the single knob that separates
 * a whale's coin-flip from The Professor's near-argmax.
 */

import { capabilitiesFor, type PersonaConfig } from "./persona";
import type { Candidate } from "./candidates";
import type { DecisionContext } from "./context";
import type { ShapingTrace } from "./trace";
import { nashRead } from "./pushfold";
import type { TiltAdjustedParams } from "./tilt";

/** Softmax temperature base; multiplied by `(0.35 + errorRate)`. */
export const TEMPERATURE_BASE = 0.5;

/** EV bias scale factors, in units of `biasScale`. */
export const AGGRESSION_BIAS_SCALE = 1;
export const CALLDOWN_BIAS_SCALE = 1.2;
export const FOLD_BIAS_SCALE = 1.4;
/** How hard a Nash chart weight nudges the jam/call row. */
export const NASH_BIAS_SCALE = 1.2;

/**
 * Two different scales, and keeping them apart matters.
 *
 * `biasScale` is "how much EV is this character willing to give up to act in
 * character" — it grows with the pot (a station overcalls a big river bet by
 * more absolute chips than a small one) but is capped, so personality can
 * never swamp arithmetic in a huge pot.
 *
 * `noiseScale` is the softmax's unit of indifference — how big an EV gap has
 * to be before the decision stops being a coin flip. It is anchored much
 * closer to the big blind: without that, a 10bb mistake in a 70bb pot reads as
 * "close", and every table turns into a preflop raising war.
 */
export function biasScaleFor(bb: number, pot: number): number {
  const unit = Math.max(bb, 1);
  return Math.min(Math.max(pot * 0.12, unit), unit * 6);
}

export function noiseScaleFor(bb: number, pot: number): number {
  const unit = Math.max(bb, 1);
  return Math.min(Math.max(pot * 0.05, unit * 0.5), unit * 4);
}

export interface ShapingInput {
  ctx: DecisionContext;
  persona: PersonaConfig;
  params: TiltAdjustedParams;
  candidates: Candidate[];
  /** Uniform in [0, 1) used to gate bluffs. */
  bluffRoll: number;
  /** Uniform in [0, 1) used to select from the softmax. */
  selectionRoll: number;
  /** Pool-level modulations contributed by `behavior` tells. */
  behavior?: {
    disableFold: boolean;
    aggressionBias: number;
    bluffFrequencyScale: number;
  };
}

export interface ShapingResult {
  chosen: Candidate;
  /** Normalised closeness of the top two shaped candidates, [0, 1]. */
  closeness: number;
  trace: ShapingTrace;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * A balance nudge for tier 6: at a bet size of `f` pot the villain is being
 * offered `f / (1 + 2f)` pot odds, which is the equilibrium bluff proportion
 * for that sizing. Bluff rows are pushed toward that proportion rather than
 * toward the persona's free-running preference — this is the whole content of
 * "balanceAware" and it is why the Professor's overbets are readable as a
 * RANGE statement instead of as a tell.
 */
function balanceNudge(c: Candidate, evScale: number, bluffFrequency: number): number {
  if (c.kind !== "bet" && c.kind !== "raise") return 0;
  if (c.intent !== "bluff") return 0;
  const f = Math.max(0.05, c.sizeFraction);
  const target = f / (1 + 2 * f);
  return (target - bluffFrequency) * evScale * 0.5;
}

/** Run stage 5 (also re-run by stage 6 with tilt-adjusted params). */
export function shapeAndSelect(input: ShapingInput): ShapingResult {
  const { ctx, persona, params, candidates, bluffRoll, selectionRoll } = input;
  const behavior = input.behavior ?? { disableFold: false, aggressionBias: 0, bluffFrequencyScale: 1 };
  const caps = capabilitiesFor(persona.tier);
  const evScale = biasScaleFor(ctx.bb, ctx.pot);
  const noiseScale = noiseScaleFor(ctx.bb, ctx.pot);

  const aggressionBias =
    (params.aggression - 0.5) * AGGRESSION_BIAS_SCALE * evScale + behavior.aggressionBias * evScale;
  const callDownBias = (params.callDownTendency - 0.5) * CALLDOWN_BIAS_SCALE * evScale;
  const foldBias = (params.tightness - 0.5) * FOLD_BIAS_SCALE * evScale;

  // --- bluff gate ----------------------------------------------------------
  const threshold = clamp01(params.bluffFrequency * behavior.bluffFrequencyScale);
  const gateOpen = bluffRoll < threshold;
  let dropped = 0;
  for (const c of candidates) {
    c.gatedOut = false;
    if (!gateOpen && c.intent === "bluff" && (c.kind === "bet" || c.kind === "raise")) {
      c.gatedOut = true;
      dropped++;
    }
    // A tell may close the fold branch outright — but never the last branch.
    if (behavior.disableFold && c.kind === "fold" && candidates.length > 1) c.gatedOut = true;
  }
  const pool = candidates.filter((c) => !c.gatedOut);
  const live = pool.length > 0 ? pool : candidates;
  if (pool.length === 0) for (const c of candidates) c.gatedOut = false;

  // --- Nash consultation (tier 6 only) -------------------------------------
  const nash = caps.balanceAware ? nashRead(ctx) : null;

  // --- shaping -------------------------------------------------------------
  for (const c of candidates) {
    let shaped = c.ev;
    if (c.kind === "bet" || c.kind === "raise") shaped += aggressionBias;
    if (c.kind === "call") shaped += callDownBias;
    if (c.kind === "fold") shaped += foldBias;
    if (caps.balanceAware) shaped += balanceNudge(c, evScale, params.bluffFrequency);
    if (nash !== null) {
      const applies =
        (nash.role === "jam" && (c.kind === "bet" || c.kind === "raise") && c.invest >= ctx.effectiveStack * 0.75) ||
        (nash.role === "call" && c.kind === "call");
      if (applies) shaped += (nash.weight - 0.5) * 2 * NASH_BIAS_SCALE * evScale;
    }
    c.shapedEv = shaped;
  }

  // --- temperature softmax -------------------------------------------------
  const temperature = TEMPERATURE_BASE * (0.35 + params.errorRate);
  const denom = Math.max(1e-6, temperature * noiseScale);
  let max = Number.NEGATIVE_INFINITY;
  for (const c of live) if (c.shapedEv > max) max = c.shapedEv;
  let sum = 0;
  const weights: number[] = [];
  for (const c of live) {
    const w = Math.exp((c.shapedEv - max) / denom);
    weights.push(w);
    sum += w;
  }
  for (const c of candidates) c.probability = 0;
  if (sum > 0) {
    for (let i = 0; i < live.length; i++) {
      const c = live[i];
      if (c === undefined) continue;
      c.probability = (weights[i] ?? 0) / sum;
    }
  }

  // --- selection -----------------------------------------------------------
  let chosen = live[0] as Candidate;
  if (sum > 0) {
    let acc = 0;
    for (const c of live) {
      acc += c.probability;
      if (selectionRoll < acc) {
        chosen = c;
        break;
      }
    }
  }

  // --- closeness -----------------------------------------------------------
  const sorted = [...live].sort((a, b) => b.shapedEv - a.shapedEv);
  const best = sorted[0];
  const second = sorted[1];
  const closeness =
    best === undefined || second === undefined
      ? 0
      : clamp01(1 - Math.abs(best.shapedEv - second.shapedEv) / Math.max(evScale * 1.5, 1));

  const trace: ShapingTrace = {
    temperature,
    evScale,
    aggressionBias,
    callDownBias,
    foldBias,
    bluffGate: { roll: bluffRoll, threshold, open: gateOpen, dropped },
    selection: { roll: selectionRoll, kind: chosen.kind },
  };
  if (chosen.amount !== undefined) trace.selection.amount = chosen.amount;
  if (nash !== null) trace.nashChart = { chartId: nash.chartId, depthBb: nash.depthBb, weight: nash.weight };

  return { chosen, closeness, trace };
}
