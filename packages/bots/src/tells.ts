/**
 * Tell evaluation — deterministic trigger → behavior.
 *
 * Doctrine (`content/characters/_index.md`): tells are REAL and CONSISTENT per
 * character; exactly one endgame character may run a scripted false tell. So
 * nothing here is probabilistic. A trigger is a conjunction of conditions on
 * facts the pipeline already computed, and the behavior is a systematic
 * modulation of the size or the clock — never a coin flip, never a jitter that
 * happens to look like a pattern.
 *
 * Sizing tells run AFTER selection, so they can only change how much goes in,
 * never whether the action was legal. Amounts are re-clamped to the engine's
 * menu, which is why a tell can never produce an illegal action.
 */

import type { Candidate } from "./candidates";
import type { DecisionContext } from "./context";
import type { HoldingFeatures } from "./handclass";
import type { PersonaConfig, TellSpec } from "./persona";
import type { BotState, OpponentStats } from "./state";
import { OVERFOLDER_FOLD_TO_BET, STATION_CALLDOWN } from "./tilt";
import type { FiredTellTrace } from "./trace";

/** Everything a trigger may test. */
export interface TellFacts {
  ctx: DecisionContext;
  candidate: Candidate;
  strengthPercentile: number;
  tilt: number;
  features: HoldingFeatures;
  heroSeat?: number;
  handsObserved: number;
  handNumber: number;
  /** Hands since the bot last saw a flop (Luna's boredom fuse). */
  handsSinceFlop: number;
  /** The bot holds two cards of the same suit. */
  suited: boolean;
  /** Board shows a flush possibility and the bot holds exactly one of that suit. */
  oneCardFlushInterest: boolean;
  /** Longest run of consecutive checks by any single opponent this hand. */
  opponentConsecutiveChecks: number;
  /** Absolute magnitude of the adaptation shift currently being applied. */
  adaptationShift: number;
  /** The modelled primary opponent, when there is one. */
  opponent: OpponentStats | null;
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/**
 * The axis every sizing band and `minSizeFraction` trigger is expressed on:
 * the action's size as a fraction of the pot it faced. One axis on every
 * street, so a band authored as "80-130% pot" means the same thing preflop as
 * it does on the river.
 */
export function sizeAxisOf(_ctx: DecisionContext, candidate: Candidate): number {
  return candidate.sizeFraction;
}

/** Does this tell fire, given the facts and the cooldown ledger? */
export function tellFires(tell: TellSpec, facts: TellFacts, botState: BotState): boolean {
  const t = tell.trigger;
  const { ctx, candidate, features } = facts;

  if (t.streets !== undefined && !t.streets.includes(ctx.street)) return false;
  if (t.actions !== undefined && !t.actions.includes(candidate.kind)) return false;
  if (t.intent !== undefined && candidate.intent !== t.intent) return false;
  if (t.minStrength !== undefined && facts.strengthPercentile < t.minStrength) return false;
  if (t.maxStrength !== undefined && facts.strengthPercentile > t.maxStrength) return false;
  if (t.minTilt !== undefined && facts.tilt < t.minTilt) return false;
  if (t.maxTilt !== undefined && facts.tilt > t.maxTilt) return false;
  if (t.facing !== undefined && (t.facing === "bet") !== ctx.facingBet) return false;
  if (t.position !== undefined && (t.position === "ip") !== ctx.inPosition) return false;
  if (t.minSizeFraction !== undefined && sizeAxisOf(ctx, candidate) < t.minSizeFraction) return false;
  if (t.headsUp === true && !ctx.headsUp) return false;
  if (t.vsHero === true) {
    if (facts.heroSeat === undefined) return false;
    if (!ctx.opponents.includes(facts.heroSeat)) return false;
  }
  if (t.minHandsObserved !== undefined && facts.handsObserved < t.minHandsObserved) return false;
  if (t.minPotBb !== undefined && ctx.potBb < t.minPotBb) return false;
  if (t.madeClasses !== undefined && !t.madeClasses.includes(features.made)) return false;
  if (t.requiresDraw !== undefined) {
    const ok =
      t.requiresDraw === "flush"
        ? features.flushDraw
        : t.requiresDraw === "oesd"
          ? features.oesd
          : features.flushDraw || features.oesd;
    if (!ok) return false;
  }
  if (t.requiresSuited === true && !facts.suited) return false;
  if (t.requiresOneCardFlushInterest === true && !facts.oneCardFlushInterest) return false;
  if (t.minHandsSinceFlop !== undefined && facts.handsSinceFlop < t.minHandsSinceFlop) return false;
  if (t.minOpponentConsecutiveChecks !== undefined && facts.opponentConsecutiveChecks < t.minOpponentConsecutiveChecks) {
    return false;
  }
  if (t.minAdaptationShift !== undefined && facts.adaptationShift < t.minAdaptationShift) return false;
  if (t.vsStation === true && (facts.opponent === null || facts.opponent.callDown < STATION_CALLDOWN)) return false;
  if (t.vsOverfolder === true && (facts.opponent === null || facts.opponent.foldToBet < OVERFOLDER_FOLD_TO_BET)) {
    return false;
  }
  if (t.maxOpponentHands !== undefined && facts.opponent !== null && facts.opponent.hands > t.maxOpponentHands) {
    return false;
  }
  if (t.cooldownHands !== undefined) {
    const last = botState.tellLastFired[tell.id];
    if (last !== undefined && facts.handNumber - last < t.cooldownHands) return false;
  }
  return true;
}

/** Pool-level effects contributed by `behavior` tells. */
export interface BehaviorTellResult {
  /** Luna's "suits are destiny": the fold branch is unreachable. */
  disableFold: boolean;
  /** Extra EV bias on aggressive rows, in `evScale` units (Maxine's stab). */
  aggressionBias: number;
  /** Multiplier on the bluff gate threshold (Ingrid's "no blind bluffs"). */
  bluffFrequencyScale: number;
  fired: FiredTellTrace[];
  firedIds: string[];
}

/**
 * Evaluate the persona's `behavior` tells. These act on the candidate POOL, so
 * their triggers must not depend on a particular candidate (no `actions`,
 * `intent` or `minSizeFraction`); `structural` entries are documentation of a
 * strategy property and are never evaluated at all.
 */
export function applyBehaviorTells(
  persona: PersonaConfig,
  facts: TellFacts,
  botState: BotState,
): BehaviorTellResult {
  const out: BehaviorTellResult = {
    disableFold: false,
    aggressionBias: 0,
    bluffFrequencyScale: 1,
    fired: [],
    firedIds: [],
  };
  for (const tell of persona.tells) {
    if (tell.kind !== "behavior") continue;
    if (tell.behavior.structural === true) continue;
    if (!tellFires(tell, facts, botState)) continue;
    const b = tell.behavior;
    const effects: string[] = [];
    if (b.disableFold === true) {
      out.disableFold = true;
      effects.push("fold branch disabled");
    }
    if (b.aggressionBias !== undefined) {
      out.aggressionBias += b.aggressionBias;
      effects.push(`aggression bias +${b.aggressionBias}`);
    }
    if (b.bluffFrequencyScale !== undefined) {
      out.bluffFrequencyScale *= b.bluffFrequencyScale;
      effects.push(`bluff gate ×${b.bluffFrequencyScale}`);
    }
    if (b.animationCue !== undefined) effects.push(`cue: ${b.animationCue}`);
    out.fired.push({
      id: tell.id,
      kind: tell.kind,
      signature: tell.signature === true,
      read: tell.read,
      effect: effects.join("; "),
    });
    out.firedIds.push(tell.id);
  }
  return out;
}

/** Result of applying every sizing tell to the chosen candidate. */
export interface SizingTellResult {
  /** Engine amount after modulation (unchanged when no sizing tell fired). */
  amount: number | undefined;
  sizeFraction: number;
  sizeMultiple: number;
  fired: FiredTellTrace[];
  /** Tell ids that fired, for the cooldown ledger. */
  firedIds: string[];
}

/**
 * Convert a desired size on the persona's axis into a legal engine amount.
 * Postflop the axis is a fraction of the pot; preflop it is a multiple of the
 * current bet level.
 */
function amountForAxis(ctx: DecisionContext, candidate: Candidate, axis: number): number | undefined {
  if (candidate.kind === "bet") {
    const bet = ctx.legal.bet;
    if (bet === undefined) return candidate.amount;
    return clamp(Math.round(ctx.pot * axis), bet.min, bet.max);
  }
  if (candidate.kind === "raise") {
    const raise = ctx.legal.raise;
    if (raise === undefined) return candidate.amount;
    const to = ctx.currentBet + Math.round((ctx.pot + ctx.toCall) * axis);
    return clamp(to, raise.minTo, raise.maxTo);
  }
  return candidate.amount;
}

/** Apply every matching sizing tell, in declaration order. */
export function applySizingTells(
  persona: PersonaConfig,
  facts: TellFacts,
  botState: BotState,
): SizingTellResult {
  const { ctx, candidate } = facts;
  const fired: FiredTellTrace[] = [];
  const firedIds: string[] = [];
  let axis = sizeAxisOf(ctx, candidate);
  const isAggressive = candidate.kind === "bet" || candidate.kind === "raise";

  if (isAggressive) {
    for (const tell of persona.tells) {
      if (tell.kind !== "sizing") continue;
      if (!tellFires(tell, facts, botState)) continue;
      const b = tell.behavior;
      let effect = "";
      if (b.sizeLadder !== undefined && b.sizeLadder.length > 0) {
        const idx = clamp(Math.floor(facts.strengthPercentile * b.sizeLadder.length), 0, b.sizeLadder.length - 1);
        axis = b.sizeLadder[idx] ?? axis;
        effect = `ladder rung ${idx + 1}/${b.sizeLadder.length} → ${axis.toFixed(2)}`;
      } else if (b.sizeBand !== undefined) {
        const [lo, hi] = b.sizeBand;
        axis = lo + (hi - lo) * clamp(facts.strengthPercentile, 0, 1);
        effect = `size forced into [${lo}, ${hi}] → ${axis.toFixed(2)}`;
      }
      if (b.sizeScale !== undefined) {
        axis *= b.sizeScale;
        effect = `${effect === "" ? "" : effect + "; "}scaled ×${b.sizeScale}`;
      }
      fired.push({ id: tell.id, kind: tell.kind, signature: tell.signature === true, read: tell.read, effect });
      firedIds.push(tell.id);
    }
  }

  if (fired.length === 0) {
    const result: SizingTellResult = {
      amount: candidate.amount,
      sizeFraction: candidate.sizeFraction,
      sizeMultiple: candidate.sizeMultiple,
      fired,
      firedIds,
    };
    return result;
  }

  const amount = amountForAxis(ctx, candidate, axis);
  const invest =
    candidate.kind === "raise" && amount !== undefined
      ? amount - ctx.self.committedStreet
      : (amount ?? candidate.invest);
  return {
    amount,
    sizeFraction: ctx.pot > 0 ? invest / ctx.pot : candidate.sizeFraction,
    sizeMultiple: ctx.currentBet > 0 && amount !== undefined ? amount / ctx.currentBet : candidate.sizeMultiple,
    fired,
    firedIds,
  };
}

/** Result of applying every timing tell. */
export interface TimingTellResult {
  band: { minMs: number; maxMs: number } | null;
  scale: number;
  fired: FiredTellTrace[];
  firedIds: string[];
}

/** Apply every matching timing tell, in declaration order. */
export function applyTimingTells(
  persona: PersonaConfig,
  facts: TellFacts,
  botState: BotState,
): TimingTellResult {
  let band: { minMs: number; maxMs: number } | null = null;
  let scale = 1;
  const fired: FiredTellTrace[] = [];
  const firedIds: string[] = [];
  for (const tell of persona.tells) {
    if (tell.kind !== "timing") continue;
    if (!tellFires(tell, facts, botState)) continue;
    const b = tell.behavior;
    let effect = "";
    if (b.thinkTimeMs !== undefined) {
      band = { minMs: b.thinkTimeMs.minMs, maxMs: b.thinkTimeMs.maxMs };
      effect = `band → ${band.minMs}-${band.maxMs}ms`;
    }
    if (b.thinkTimeScale !== undefined) {
      scale *= b.thinkTimeScale;
      effect = `${effect === "" ? "" : effect + "; "}×${b.thinkTimeScale}`;
    }
    fired.push({ id: tell.id, kind: tell.kind, signature: tell.signature === true, read: tell.read, effect });
    firedIds.push(tell.id);
  }
  return { band, scale, fired, firedIds };
}
