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
 *
 * Two things live here that are not personality at all, and both exist because
 * the measured cast said so (`packages/bots/CALIBRATION.md`):
 *
 * - the **preflop frequency anchor**, which is the only place the bibles'
 *   authored VPIP and PFR reach the decision;
 * - the **character budget**, which decides how much EV a tier may spend on
 *   being itself. Without it the tier ladder does not order.
 */

import type { PositionLabel } from "@poker/core";
import { capabilitiesFor, envelopeFor, resolveFrequencies, type PersonaConfig, type Tier } from "./persona";
import type { Candidate } from "./candidates";
import type { DecisionContext } from "./context";
import type { ShapingTrace } from "./trace";
import { nashRead } from "./pushfold";
import type { TiltAdjustedParams } from "./tilt";

/** Softmax temperature base; multiplied by `(TEMPERATURE_FLOOR + errorRate)`. */
export const TEMPERATURE_BASE = 0.5;

/**
 * Irreducible indifference: how much a persona mixes when its `errorRate` is
 * zero.
 *
 * It has to be small. At 0.35 the floor dominated the whole tier-5/6 range —
 * Vera's authored 0.02 error rate produced 95% of the Professor's mixing and
 * 40% of Barry's, so the crushers resolved a half-big-blind EV gap as close to
 * a coin flip and the top of the tier ladder measured flat. Randomisation at
 * the top belongs in the bluff gate and the seeded mixed-strategy rolls, not
 * in a floor on the softmax.
 */
export const TEMPERATURE_FLOOR = 0.12;

/**
 * Aggression is spent where it can work.
 *
 * A flat aggression bias buys the same amount of extra betting into a station
 * as into a nit, and that is why the aggressive tier measures BELOW the ABC
 * tier heads-up: the fold-happy characters distort in a direction that costs
 * almost nothing (folding is exactly zero EV), while the pressure characters
 * pay full price for barrels nobody was ever going to fold to. Weighting the
 * bias by the row's own modelled fold frequency makes "he keeps firing until
 * somebody proves they have it" mean what it says — Rocco leans on the spots
 * that fold, not on the spots that call.
 *
 * The weight is normalised around a fold frequency of one half, so a persona's
 * authored `aggression` still means the same thing on average; it just lands
 * where it belongs. Firing into a wall anyway remains available, and remains
 * exactly where it should be: Rocco's authored characteristic mistake.
 */
export const AGGRESSION_FOLD_EQUITY_WEIGHT = 1.3;

export function aggressionWeightFor(foldFreq: number): number {
  return 1 - AGGRESSION_FOLD_EQUITY_WEIGHT / 2 + AGGRESSION_FOLD_EQUITY_WEIGHT * clamp01(foldFreq);
}

/** EV bias scale factors, in units of `biasScale`. */
export const AGGRESSION_BIAS_SCALE = 1;
export const CALLDOWN_BIAS_SCALE = 1.2;
export const FOLD_BIAS_SCALE = 1.4;
/** How hard a Nash chart weight nudges the jam/call row. */
export const NASH_BIAS_SCALE = 1.2;

/**
 * How hard tier 6's balance nudge pulls a bluff row toward its equilibrium
 * proportion for the sizing. A nudge, not a rule: the Professor's overbets
 * should read as a RANGE statement, and doubling this was measured to buy the
 * tier nothing.
 */
export const BALANCE_NUDGE_SCALE = 0.5;

/**
 * What an OPEN bluff gate is worth, in `biasScale` units.
 *
 * The gate on its own is only a veto: it deletes bluff rows when it is shut
 * and does nothing when it is open. A one-street EV model never rates a bluff
 * above a check — the fold equity it books is smaller than the chips it risks
 * unless the villain folds implausibly often — so a veto-only gate produces a
 * cast that bets when strong and checks otherwise. Measured, tiers 5 and 6
 * bluffed on 2% of their aggressive actions with `bluffFrequency` set to 0.30
 * and 0.36. That is not a personality; it is a bot a player beats forever by
 * folding to every bet.
 *
 * So an open gate is a DECISION, not a permission: the persona has chosen to
 * run a bluff in this spot, and the row is priced accordingly. Deliberately
 * NOT scaled by the tier's character budget — bluffing at a defensible
 * frequency is strategy, not a leak, and the crushers are the characters who
 * most need it. What varies by character is how often the gate opens at all.
 */
export const BLUFF_OPEN_BIAS_SCALE = 1.6;

// ---------------------------------------------------------------------------
// Preflop frequency anchoring
// ---------------------------------------------------------------------------

/**
 * The bibles author VPIP and PFR directly — `vpipBias`/`pfrBias` resolve to
 * concrete frequencies through {@link resolveFrequencies} — and until stage 5
 * consults them, nothing in the pipeline does. That gap is not cosmetic: a
 * one-street EV model prices a 1bb call into a 1.5bb pot as a rounding error,
 * so every persona happily enters ~70% of hands and the tier ladder collapses
 * into one loose table wearing twelve hats.
 *
 * The anchor closes the loop. Preflop percentile is uniform in combo mass (see
 * `policy.comboStrengthPercentiles`), so "enter above percentile `1 - vpip`"
 * realises a VPIP of exactly `vpip` if it were a hard rule. It is not a hard
 * rule: it is an EV bias proportional to the distance from that threshold, so
 * price, position, stack depth and personality still move the line — the
 * frequency is anchored, the individual decision is not scripted.
 *
 * Re-raise frequencies are anchored by the same construction, geometrically:
 * a persona's 3-bet target is `pfr x RERAISE_FREQUENCY_RATIO`, its 4-bet
 * target that ratio again. Without it a 20% PFR reads as a 20% 4-bet frequency
 * and six players find a stack-off every hand.
 */
export const ENTRY_BIAS_SCALE = 6;
export const RAISE_BIAS_SCALE = 6;
export const RERAISE_FREQUENCY_RATIO = 0.34;

/**
 * What limping into an unopened pot costs a persona that models ranges.
 *
 * Open-limping is the one preflop decision where "raise or fold" is not a
 * stylistic preference but the strategy: entering without the initiative
 * forfeits fold equity, caps the pot, and invites the field in behind. Every
 * tier-3-and-up bible says so in its own words, and the measured cast said the
 * opposite — VPIP on target, PFR six to eight points under it, the difference
 * sitting in flat calls a reg would never make.
 *
 * Tier-gated on `usesRangeFiltering`, because the tier-1 and tier-2 bibles are
 * explicit that limping IS their character ("he open-limps far more than he
 * raises" — Barry).
 */
export const LIMP_PENALTY_SCALE = 1.2;

/**
 * How much EV a persona may spend to act in character, by tier.
 *
 * This is the tier ladder made real. The capability flags say what a tier's
 * model is ALLOWED to compute; this says how far the character is allowed to
 * walk away from what it computed. Without it the ladder does not order:
 * Rocco's aggression of 0.85 and Vera's of 0.72 buy the same distortion at the
 * same price, so the aggressive tier wins the small pots, pays for its
 * character in the big ones, and finishes below the tier it is supposed to
 * beat — which is exactly what the heads-up matrix measured before this
 * existed.
 *
 * So character costs what the tier can afford. A whale distorts at full
 * strength and it reads as a whale; a crusher's personality shows in WHICH
 * marginal spots they take, not in what they will pay for one. Nothing is ever
 * zero — the Professor and Vera are still visibly different players.
 */
export const CHARACTER_BIAS_BY_TIER: Readonly<Record<Tier, number>> = {
  1: 1,
  2: 0.85,
  3: 0.72,
  4: 0.46,
  5: 0.34,
  6: 0.22,
};

/**
 * Within a tier, `errorRate` modulates the budget by +/-20% of itself, read as
 * a position inside that tier's own `errorRate` envelope. Tilt raises the
 * effective error rate, so a tilted character spends MORE on being itself —
 * which is what tilt is.
 */
export const CHARACTER_BIAS_ERROR_SPREAD = 0.4;

/** How much of its authored personality distortion a persona can afford. */
export function characterBiasScale(tier: Tier, errorRate: number): number {
  const base = CHARACTER_BIAS_BY_TIER[tier];
  const [lo, hi] = envelopeFor(tier).bounds.errorRate;
  const within = hi > lo ? clamp01((errorRate - lo) / (hi - lo)) : 0.5;
  return base * (1 - CHARACTER_BIAS_ERROR_SPREAD / 2 + CHARACTER_BIAS_ERROR_SPREAD * within);
}

/**
 * Per-position multiplier on the VPIP/PFR target. The mean across the six
 * 6-max seats is exactly 1, so a persona's authored frequency is what it
 * actually posts over a full orbit — position redistributes it, never inflates
 * it.
 *
 * Only tiers with a range model get this: the tier-1 bibles are explicit that
 * their characters have none ("No positional adjustment" — Barry; "No
 * positional model" — Luna), and a whale who tightens under the gun is not a
 * whale.
 */
export const POSITIONAL_WIDENING: Readonly<Record<PositionLabel, number>> = {
  BTN: 1.4,
  CO: 1.2,
  HJ: 1,
  LJ: 0.95,
  UTG: 0.7,
  UTG1: 0.68,
  UTG2: 0.66,
  SB: 0.85,
  BB: 0.85,
};

/**
 * Heads-up is a different game, and every competent player answers it in
 * roughly the same place: both seats are late, both post a blind every hand,
 * and folding to a raise forever is not an option.
 *
 * So heads-up targets BLEND toward a heads-up baseline rather than scaling the
 * authored six-max frequency. Scaling looks tidier and is wrong — it preserves
 * the six-max spread, so a tier-5 reg authored at 23% VPIP arrives heads-up
 * fifteen points tighter than a tier-4 aggressor authored at 38%, and the
 * heads-up tier ladder then measures the frequency gap instead of the skill
 * gap. Blending keeps the ORDER (looser characters stay looser) while putting
 * every character in a heads-up-playable range.
 */
export const HEADS_UP_VPIP_BASELINE = 0.55;
export const HEADS_UP_PFR_BASELINE = 0.45;
export const HEADS_UP_BLEND = 0.6;

/** The two preflop frequency edges, in percentile units. */
export interface PreflopAnchor {
  /** Percentile minus the entry threshold; positive means "this is a hand I play". */
  entryEdge: number;
  /** Percentile minus the raise threshold, tightened once per prior raise. */
  raiseEdge: number;
  /** Entry is only anchored on the decision that actually enters the pot. */
  anchorsEntry: boolean;
  /** True when a flat call here would be an open-limp by a range-aware tier. */
  penalisesLimp: boolean;
}

/**
 * Resolve the preflop anchor for this decision, or `null` postflop.
 *
 * `anchorsEntry` is false once the persona has already acted preflop: VPIP is
 * decided by the first decision, and re-applying the entry gate to a limper
 * facing a raise would fold out exactly the station the bible describes.
 */
export function preflopAnchor(
  ctx: DecisionContext,
  persona: PersonaConfig,
  percentile: number,
): PreflopAnchor | null {
  if (!ctx.isPreflop) return null;
  const { vpip, pfr } = resolveFrequencies(persona);
  const modelsPosition = capabilitiesFor(persona.tier).usesRangeFiltering;
  const positional = modelsPosition ? (POSITIONAL_WIDENING[ctx.position] ?? 1) : 1;
  const headsUp = modelsPosition && ctx.tableSize === 2;
  const vpipBase = headsUp ? vpip + (HEADS_UP_VPIP_BASELINE - vpip) * HEADS_UP_BLEND : vpip;
  const pfrBase = headsUp
    ? Math.min(vpipBase, pfr + (HEADS_UP_PFR_BASELINE - pfr) * HEADS_UP_BLEND)
    : pfr;
  const raises = ctx.line.preflopRaises;
  const vpipTarget = clamp01(vpipBase * positional);
  // In an unopened pot a range-aware persona is raise-or-fold, so its opening
  // threshold IS its entry threshold: the authored VPIP-PFR gap is supposed to
  // come from the hands it cold-calls against a raise, not from limps it would
  // never make. Everyone else keeps the authored PFR and limps the difference,
  // which is the tier-1/2 characters' whole preflop identity.
  const openTarget = modelsPosition ? vpipTarget : clamp01(pfrBase * positional);
  // Re-raise targets take neither the positional nor the heads-up widening:
  // those open MORE pots, they do not 3-bet or 4-bet proportionally wider.
  // Compounding them turns a 33% PFR into a 27% three-bet frequency, and at
  // 200bb that is a stack-off ladder rather than a strategy.
  const pfrTarget = clamp01(
    raises === 0 ? openTarget : pfrBase * Math.pow(RERAISE_FREQUENCY_RATIO, raises),
  );
  return {
    entryEdge: percentile - (1 - vpipTarget),
    raiseEdge: percentile - (1 - pfrTarget),
    anchorsEntry: ctx.line.ownActionsThisStreet === 0,
    penalisesLimp: modelsPosition && raises === 0,
  };
}

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
  /** The bot's own holding percentile from stage 3 — the anchor's input. */
  strengthPercentile: number;
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
  return (target - bluffFrequency) * evScale * BALANCE_NUDGE_SCALE;
}

/** Run stage 5 (also re-run by stage 6 with tilt-adjusted params). */
export function shapeAndSelect(input: ShapingInput): ShapingResult {
  const { ctx, persona, params, candidates, bluffRoll, selectionRoll } = input;
  const behavior = input.behavior ?? { disableFold: false, aggressionBias: 0, bluffFrequencyScale: 1 };
  const caps = capabilitiesFor(persona.tier);
  const evScale = biasScaleFor(ctx.bb, ctx.pot);
  const noiseScale = noiseScaleFor(ctx.bb, ctx.pot);

  const character = characterBiasScale(persona.tier, params.errorRate) * evScale;
  const aggressionBias =
    (params.aggression - 0.5) * AGGRESSION_BIAS_SCALE * character + behavior.aggressionBias * evScale;
  const callDownBias = (params.callDownTendency - 0.5) * CALLDOWN_BIAS_SCALE * character;
  const foldBias = (params.tightness - 0.5) * FOLD_BIAS_SCALE * character;
  const anchor = preflopAnchor(ctx, persona, input.strengthPercentile);
  const entryBias =
    anchor === null || !anchor.anchorsEntry ? 0 : anchor.entryEdge * ENTRY_BIAS_SCALE * evScale;
  const raiseBias = anchor === null ? 0 : anchor.raiseEdge * RAISE_BIAS_SCALE * evScale;
  const limpPenalty = anchor !== null && anchor.penalisesLimp ? LIMP_PENALTY_SCALE * evScale : 0;

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
  const bluffBias = gateOpen ? BLUFF_OPEN_BIAS_SCALE * evScale : 0;
  const pool = candidates.filter((c) => !c.gatedOut);
  const live = pool.length > 0 ? pool : candidates;
  if (pool.length === 0) for (const c of candidates) c.gatedOut = false;

  // --- Nash consultation (tier 6 only) -------------------------------------
  const nash = caps.balanceAware ? nashRead(ctx) : null;

  // --- shaping -------------------------------------------------------------
  for (const c of candidates) {
    let shaped = c.ev;
    const aggressive = c.kind === "bet" || c.kind === "raise";
    if (aggressive) shaped += aggressionBias * aggressionWeightFor(c.foldFreq);
    if (aggressive && c.intent === "bluff") shaped += bluffBias * aggressionWeightFor(c.foldFreq);
    if (c.kind === "call") shaped += callDownBias;
    if (c.kind === "fold") shaped += foldBias;
    // Entering the pot is calling or putting in a raise; checking the big
    // blind is not, and never counts against VPIP.
    if (aggressive || c.kind === "call") shaped += entryBias;
    // The raise anchor decides HOW a persona enters, so above the PFR
    // threshold it is a contrast: it pulls toward the raise AND away from the
    // flat call, because a hand a reg opens is not a hand a reg limps. Below
    // the threshold it only damps the raise — whether to enter at all is the
    // entry anchor's decision, and a discount on raising must never read as a
    // bonus for calling with trash.
    if (aggressive) shaped += raiseBias;
    if (c.kind === "call" && raiseBias > 0) shaped -= raiseBias;
    if (c.kind === "call") shaped -= limpPenalty;
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
  const temperature = TEMPERATURE_BASE * (TEMPERATURE_FLOOR + params.errorRate);
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
  if (anchor !== null) {
    trace.preflopAnchor = {
      entryEdge: anchor.entryEdge,
      raiseEdge: anchor.raiseEdge,
      entryBias,
      raiseBias,
    };
  }
  if (nash !== null) trace.nashChart = { chartId: nash.chartId, depthBb: nash.depthBb, weight: nash.weight };

  return { chosen, closeness, trace };
}
