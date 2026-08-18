/**
 * Stage 2 — range state via Bayesian filtering.
 *
 * For each live opponent the bot holds a `Float32Array(1326)` posterior. It
 * starts as a position-free prior sized by what the bot believes that seat's
 * VPIP is (adaptation memory feeds straight in here), then every action the
 * seat has taken this hand multiplies it by `P(action | combo)` from
 * `policy.ts` and renormalizes — `@poker/ranges`' {@link filter}, textbook
 * Bayes over 1326 hypotheses.
 *
 * Tiers 1-2 do not run this at all: a whale is not tracking your range, and
 * pretending otherwise would make the whole tier ladder a lie. Their "range"
 * is every combo the cards allow, which is exactly how Barry thinks.
 */

import type { Card } from "@poker/core";
import {
  DEFAULT_PREFLOP_RANKING,
  RANGE_SIZE,
  clone,
  filter,
  fullRange,
  maskBlocked,
  topPercentByRanking,
  total,
  type WeightedRange,
} from "@poker/ranges";
import type { Street } from "@poker/history";
import {
  DEFAULT_POLICY_PARAMS,
  LIKELIHOOD_FLOOR,
  comboStrengthPercentiles,
  policyLikelihood,
  type PolicyParams,
} from "./policy";
import type { DecisionContext } from "./context";
import { adaptationRamp, opponentOf, type BotState } from "./state";
import { capabilitiesFor, type PersonaConfig } from "./persona";
import type { OpponentRangeTrace, RangeStateTrace } from "./trace";

/** Board card count implied by a street. */
function boardLenOf(street: Street): number {
  return street === "preflop" ? 0 : street === "flop" ? 3 : street === "turn" ? 4 : 5;
}

/** Strength-percentile arrays, memoised per board prefix within one decision. */
export class StrengthCache {
  private readonly cache = new Map<number, Float32Array>();

  constructor(private readonly board: readonly Card[]) {}

  /** Percentiles as of `street` (using only the board cards visible then). */
  forStreet(street: Street): Float32Array {
    const len = Math.min(boardLenOf(street), this.board.length);
    const hit = this.cache.get(len);
    if (hit !== undefined) return hit;
    const arr = comboStrengthPercentiles(this.board.slice(0, len));
    this.cache.set(len, arr);
    return arr;
  }
}

/**
 * `adaptationRate` at which a persona trusts its observations completely.
 * Above this the model is fully the opponent; below it the population prior
 * keeps its share.
 */
export const FULL_TRUST_ADAPTATION_RATE = 0.5;

/**
 * Trust a persona has in its own observations even at `adaptationRate` zero.
 *
 * Not exploiting you is not the same as not noticing you. The Professor's 0.05
 * is authored as "he plays the equilibrium, not you" — he declines to HUNT
 * leaks; he does not decline to see that the table is loose. Gating his
 * opponent model to nothing on the strength of that number cost him the whole
 * tier-6 rung heads-up, because a crusher with no model of the field is not a
 * crusher.
 */
export const BASELINE_MODEL_TRUST = 0.35;

/**
 * Policy parameters the bot attributes to an opponent seat.
 *
 * The blend is ramped by BOTH the sample (hands shared) and the persona's own
 * `adaptationRate`. Ramping on the sample alone — which is what this did
 * before — gives Barry (`adaptationRate` 0.05) and Ingrid (0.95) the identical
 * opponent model after sixty hands, which is wrong twice over: it hands a
 * whale a read his bible explicitly denies him, and it makes the cast's
 * headline adaptive character no better informed than anyone else. The bibles
 * spend a whole parameter on this; it should reach the model it names.
 */
export function assumedParamsFor(
  state: BotState,
  seat: number,
  adaptationRate: number,
): PolicyParams {
  const stats = opponentOf(state, seat);
  const exploit = Math.min(1, Math.max(0, adaptationRate / FULL_TRUST_ADAPTATION_RATE));
  const trust = BASELINE_MODEL_TRUST + (1 - BASELINE_MODEL_TRUST) * exploit;
  const ramp = adaptationRamp(stats) * trust;
  const blend = (observed: number, prior: number): number => prior + ramp * (observed - prior);
  return {
    aggression: blend(stats.aggression, DEFAULT_POLICY_PARAMS.aggression),
    bluffFrequency: blend(Math.min(1, stats.aggression * 0.6), DEFAULT_POLICY_PARAMS.bluffFrequency),
    callDownTendency: blend(stats.callDown, DEFAULT_POLICY_PARAMS.callDownTendency),
    tightness: blend(1 - stats.vpip, DEFAULT_POLICY_PARAMS.tightness),
  };
}

export interface RangeState {
  /** True when Bayesian filtering ran (tier 3+). */
  filtered: boolean;
  /** Posterior per live opponent seat. */
  byOpponent: ReadonlyMap<number, WeightedRange>;
  /** The range stage 3 prices equity against. */
  primary: WeightedRange;
  primarySeat: number | null;
  /** Policy parameters attributed to the primary opponent. */
  primaryParams: PolicyParams;
  /** Policy parameters attributed to EVERY live opponent, by seat. */
  paramsByOpponent: ReadonlyMap<number, PolicyParams>;
  strength: StrengthCache;
  trace: RangeStateTrace;
}

/**
 * Pick the opponent whose range matters most: the current street's aggressor
 * when they are still live, otherwise the most committed live opponent.
 */
function primaryOpponentOf(ctx: DecisionContext): number | null {
  const live = new Set(ctx.opponents);
  const aggressor = ctx.line.streetAggressor;
  if (aggressor !== null && live.has(aggressor)) return aggressor;
  let best: number | null = null;
  let bestCommit = -1;
  for (const s of ctx.opponents) {
    let committed = 0;
    for (const a of ctx.scan.acts) if (a.seat === s) committed += a.invest;
    if (committed > bestCommit) {
      bestCommit = committed;
      best = s;
    }
  }
  return best ?? (ctx.opponents[0] ?? null);
}

/** Build stage 2's range state. */
export function buildRangeState(
  ctx: DecisionContext,
  persona: PersonaConfig,
  botState: BotState,
): RangeState {
  const caps = capabilitiesFor(persona.tier);
  const strength = new StrengthCache(ctx.board);
  const dead: Card[] = [ctx.hole[0], ctx.hole[1], ...ctx.board];
  const byOpponent = new Map<number, WeightedRange>();
  const paramsByOpponent = new Map<number, PolicyParams>();
  const opponentTraces: OpponentRangeTrace[] = [];
  const primarySeat = primaryOpponentOf(ctx);

  let priorPercentTrace = 1;

  // A seat that has not voluntarily put a chip in has not SELECTED a hand yet.
  // Its VPIP is the range it plays, not the range it was dealt, and applying
  // the shaped prior before it acts models a table where everybody always
  // holds a premium: fold equity vanishes, the bot's own equity collapses, and
  // nobody ever opens a pot.
  const voluntary = new Set<number>();
  for (const a of ctx.scan.acts) {
    if (a.kind === "call" || a.kind === "bet" || a.kind === "raise") voluntary.add(a.seat);
  }

  for (const seat of ctx.opponents) {
    const stats = opponentOf(botState, seat);
    let range: WeightedRange;
    const observed: string[] = [];
    let updates = 0;

    if (!caps.usesRangeFiltering) {
      // Whales and stations read cards, not ranges.
      range = maskBlocked(fullRange(), dead);
    } else {
      const priorPct = voluntary.has(seat) ? Math.min(0.95, Math.max(0.06, stats.vpip)) : 1;
      priorPercentTrace = priorPct;
      range =
        priorPct >= 1
          ? maskBlocked(fullRange(), dead)
          : maskBlocked(topPercentByRanking(priorPct, DEFAULT_PREFLOP_RANKING), dead);
      const params = assumedParamsFor(botState, seat, persona.adaptationRate);
      for (const act of ctx.scan.acts) {
        if (act.seat !== seat) continue;
        if (act.kind === "fold") continue; // a folded seat has no live range
        if (total(range) <= 0) break;
        const likelihood = policyLikelihood({
          action: act.kind,
          street: act.street,
          sizeFraction: act.sizeFraction,
          strength: strength.forStreet(act.street),
          params,
        });
        range = filter(range, likelihood, LIKELIHOOD_FLOOR);
        updates++;
        observed.push(`${act.street}:${act.kind}@${act.sizeFraction.toFixed(2)}`);
      }
      // Renormalising every step leaves total() = 1; rescale so the trace and
      // downstream weighted means read as combo mass, not probability mass.
      const mass = total(range);
      if (mass > 0) {
        const scale = 1 / mass;
        for (let i = 0; i < RANGE_SIZE; i++) range[i] = (range[i] as number) * scale;
      }
    }

    byOpponent.set(seat, range);
    paramsByOpponent.set(
      seat,
      caps.usesRangeFiltering
        ? assumedParamsFor(botState, seat, persona.adaptationRate)
        : DEFAULT_POLICY_PARAMS,
    );

    const strengthNow = strength.forStreet(ctx.street);
    let sum = 0;
    let mass = 0;
    for (let i = 0; i < RANGE_SIZE; i++) {
      const w = range[i] as number;
      if (w <= 0) continue;
      mass += w;
      sum += w * (strengthNow[i] ?? 0);
    }
    opponentTraces.push({
      seat,
      combos: mass,
      meanStrength: mass > 0 ? sum / mass : 0,
      updates,
      observedActions: observed,
    });
  }

  const fallback = maskBlocked(fullRange(), dead);
  const primary = primarySeat === null ? fallback : (byOpponent.get(primarySeat) ?? fallback);

  return {
    filtered: caps.usesRangeFiltering,
    byOpponent,
    primary: clone(primary),
    primarySeat,
    paramsByOpponent,
    primaryParams:
      primarySeat === null
        ? DEFAULT_POLICY_PARAMS
        : assumedParamsFor(botState, primarySeat, persona.adaptationRate),
    strength,
    trace: {
      filtered: caps.usesRangeFiltering,
      epsilonFloor: LIKELIHOOD_FLOOR,
      priorPercent: caps.usesRangeFiltering ? priorPercentTrace : 1,
      opponents: opponentTraces,
    },
  };
}
