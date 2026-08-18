/**
 * The bot policy as a GENERATIVE MODEL — and the one place that model lives.
 *
 * `@poker/ranges`' `filter` is Bayes over 1326 hypotheses: it needs
 * `P(observed action | this combo)`. That likelihood is exactly a policy. So
 * rather than write one policy for acting and a second, differently-wrong one
 * for reading, the pipeline uses THIS module for both directions:
 *
 * - forward (acting):  {@link continuationOf} / {@link aggressionOf} price what
 *   a modelled opponent does with each combo → fold equity, continuance;
 * - inverse (reading): {@link policyLikelihood} hands the same curves to
 *   `filter` as the likelihood function → the opponent's posterior range.
 *
 * `policyLikelihood` is exported from the package root on purpose: analysis
 * (leak reports, the bot-mind reveal, what-if branches) must be able to
 * reproduce a bot's read using the identical model, not an approximation of it.
 *
 * The curves are logistic in a combo's STRENGTH PERCENTILE on the current
 * board — 0 = worst combo in the range, 1 = the nuts — so the same code works
 * preflop (percentile from the preflop ranking) and postflop (percentile from
 * the local made-hand score).
 */

import { ALL_COMBOS, type Card } from "@poker/core";
import type { ActionKind, Street } from "@poker/history";
import {
  CLASS_OF_COMBO,
  DEFAULT_PREFLOP_RANKING,
  RANGE_SIZE,
  rankingMidpoints,
  type WeightedRange,
} from "@poker/ranges";
import { holdingScore } from "./handclass";

/** Behavioural knobs of the modelled actor. */
export interface PolicyParams {
  /** How often the actor turns marginal holdings into aggression, [0, 1]. */
  aggression: number;
  /** How often the actor bluffs the bottom of its range, [0, 1]. */
  bluffFrequency: number;
  /** How wide the actor continues against pressure, [0, 1]. */
  callDownTendency: number;
  /** How much the actor discounts weak holdings preflop, [0, 1]. */
  tightness: number;
}

/** Neutral, "average human" policy parameters. */
export const DEFAULT_POLICY_PARAMS: PolicyParams = {
  aggression: 0.5,
  bluffFrequency: 0.25,
  callDownTendency: 0.5,
  tightness: 0.5,
};

/** Epsilon floor handed to `@poker/ranges`' Bayesian filter. */
export const LIKELIHOOD_FLOOR = 0.12;

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** Logistic curve centred on `mid` with slope `k`. */
function logistic(x: number, mid: number, k: number): number {
  return 1 / (1 + Math.exp(-k * (x - mid)));
}

/**
 * Per-combo strength percentiles on a board, [0, 1], where 1 = strongest.
 *
 * Preflop (`board.length === 0`) this is the class percentile under
 * `DEFAULT_PREFLOP_RANKING` — raw all-in equity vs a random hand, exactly the
 * "how good is this hand" axis a whale actually uses. Postflop it is the rank
 * of the combo's local made-hand score among all 1326 combos.
 *
 * Combos containing a board card are given percentile 0 and should be masked
 * out of any range before use.
 *
 * Cost: 1326 cheap classifications, once per decision — not per Monte Carlo
 * trial. That is the whole reason `handclass.ts` exists.
 */
export function comboStrengthPercentiles(board: readonly Card[]): Float32Array {
  const out = new Float32Array(RANGE_SIZE);
  if (board.length === 0) {
    const mids = rankingMidpoints(DEFAULT_PREFLOP_RANKING);
    for (let i = 0; i < RANGE_SIZE; i++) {
      const q = mids[CLASS_OF_COMBO[i] as number] as number; // 0 = strongest
      out[i] = 1 - q;
    }
    return out;
  }
  const dead = new Set<Card>(board);
  const scores = new Float64Array(RANGE_SIZE);
  const live: number[] = [];
  for (let i = 0; i < RANGE_SIZE; i++) {
    const combo = ALL_COMBOS[i] as readonly [Card, Card];
    if (dead.has(combo[0]) || dead.has(combo[1])) {
      scores[i] = -1;
      continue;
    }
    scores[i] = holdingScore(combo, board);
    live.push(i);
  }
  live.sort((a, b) => (scores[a] as number) - (scores[b] as number));
  const n = live.length;
  for (let k = 0; k < n; k++) {
    const idx = live[k] as number;
    out[idx] = n <= 1 ? 0.5 : k / (n - 1);
  }
  return out;
}

/**
 * How often the actor takes an aggressive line with a combo at strength `s`.
 *
 * Two additive sources, which is what makes a range polar rather than linear:
 * a value component that switches on above a threshold, and a bluff component
 * concentrated at the very bottom. Bigger bets raise the value threshold (you
 * need more to fire bigger) and shrink the bluff component slightly.
 */
export function aggressionOf(s: number, p: PolicyParams, sizeFraction: number): number {
  const size = sizeTerm(sizeFraction);
  const valueMid = 0.62 + 0.14 * size - 0.25 * p.aggression;
  const value = logistic(s, valueMid, 9);
  const bluffDepth = clamp01((0.32 - s) / 0.32);
  const bluff = p.bluffFrequency * bluffDepth * bluffDepth * (1 - 0.2 * size);
  return clamp01(value * (0.55 + 0.65 * p.aggression) + bluff);
}

/**
 * Price sensitivity term for a bet of `sizeFraction` pot.
 *
 * LOG-scaled, and that matters: a linear (or clamped) term makes a 50x-pot
 * shove look barely scarier than a pot bet, which is how a bot talks itself
 * into jamming 200bb to win 3. `log(1 + f)` keeps ordinary sizings close
 * together while letting genuinely absurd ones move the threshold a long way.
 */
function sizeTerm(sizeFraction: number): number {
  return Math.log(1 + Math.max(0.02, sizeFraction));
}

/**
 * How often the actor continues (calls or raises) against a bet of
 * `sizeFraction` pot holding a combo at strength `s`.
 *
 * The threshold rises with bet size — pot odds — and falls with call-down
 * tendency, which is precisely what makes Barry (0.97) a station and Priya
 * (0.22) an over-folder using one shared curve.
 *
 * The size coefficient is calibrated against real continuance: a neutral actor
 * continues against roughly 55% of a third-pot bet, 46% of a half-pot bet, 34%
 * of a pot bet and 20% of a 3x-the-big-blind open. Understating it is not a
 * small error — it tells every bot the table calls an open a third of the
 * time, which prices opening as a losing play and leaves the whole cast
 * limping.
 */
export function continuationOf(s: number, p: PolicyParams, sizeFraction: number): number {
  const mid = 0.42 + 0.45 * sizeTerm(sizeFraction) - 0.34 * p.callDownTendency + 0.12 * p.tightness;
  return clamp01(logistic(s, mid, 8));
}

/**
 * How often the actor answers a bet of `sizeFraction` pot with a RAISE,
 * holding a combo at strength `s`.
 *
 * Deliberately NOT {@link aggressionOf}: that curve prices "would you bet this
 * into a checked pot", and raising a bet is a far rarer act than betting an
 * unbet pot. Reusing it makes a bot believe someone re-raises it roughly a
 * quarter of the time, which — compounded over five live seats — reads as "I
 * am 3-bet three times out of four" and no persona ever opens a pot again.
 *
 * Calibrated so a full, unfiltered range raises about 10% of the time against
 * a half-pot bet and about 5% against a 2x-pot (open-raise-sized) one: bigger
 * bets get raised less, aggressive actors raise more, and the very bottom of
 * the range keeps a small bluff-raise share.
 */
export function raiseBackOf(s: number, p: PolicyParams, sizeFraction: number): number {
  const mid = 0.92 + 0.1 * (sizeTerm(sizeFraction) - 0.5) - 0.16 * (p.aggression - 0.5);
  const value = logistic(s, mid, 14);
  const bluffDepth = clamp01((0.18 - s) / 0.18);
  return clamp01(value + p.bluffFrequency * bluffDepth * bluffDepth * 0.4);
}

/** What was observed, and who is assumed to have produced it. */
export interface PolicyObservation {
  action: ActionKind;
  street: Street;
  /** Size of the action as a fraction of the pot it faced (0 for fold/check). */
  sizeFraction: number;
  /** Per-combo strength percentiles for the board the action was taken on. */
  strength: Float32Array;
  params: PolicyParams;
}

/**
 * `P(observed action | combo)` under the modelled actor's policy — the
 * likelihood function `@poker/ranges`' {@link filter} inverts.
 *
 * Never returns 0: the caller's epsilon floor exists because bots err, and
 * this model would otherwise permanently zero combos it merely misjudged.
 */
export function policyLikelihood(obs: PolicyObservation): (comboIndex: number) => number {
  const { action, sizeFraction, strength, params } = obs;
  return (i: number): number => {
    const s = strength[i] ?? 0;
    const agg = aggressionOf(s, params, Math.max(sizeFraction, 0.5));
    const cont = continuationOf(s, params, Math.max(sizeFraction, 0.05));
    switch (action) {
      case "fold":
        return clamp01(1 - cont);
      case "check":
        return clamp01(1 - agg);
      case "call":
        return clamp01(cont * (1 - agg) + 0.05);
      case "bet":
        return clamp01(agg);
      case "raise":
        // A raise is the aggressive branch with a higher bar than a bet.
        return clamp01(aggressionOf(s, params, Math.max(sizeFraction, 1)) * 0.9);
      default:
        return 1;
    }
  };
}

/**
 * Weighted fraction of `range` that continues against a bet of `sizeFraction`
 * pot — the fold-equity input for stage 4. Returns 0 for an empty range.
 */
export function continuanceFraction(
  range: WeightedRange,
  strength: Float32Array,
  params: PolicyParams,
  sizeFraction: number,
): number {
  let mass = 0;
  let cont = 0;
  for (let i = 0; i < RANGE_SIZE; i++) {
    const w = range[i] as number;
    if (w <= 0) continue;
    mass += w;
    cont += w * continuationOf(strength[i] ?? 0, params, sizeFraction);
  }
  return mass <= 0 ? 0 : cont / mass;
}

/**
 * The two ways a modelled range answers a bet of `sizeFraction` pot: the share
 * that continues at all, and the share that answers with a RAISE.
 *
 * Both come out of one pass over the 1326 combos — stage 4 prices every
 * candidate size, so a second loop per size is real cost for no new
 * information.
 *
 * The raise branch is {@link raiseBackOf} — the same generative model the
 * reader uses, so the frequency a bot FEARS a raise with is the frequency it
 * READS one with.
 */
export interface RangeResponse {
  /** Weighted share of the range that calls or raises, [0, 1]. */
  continues: number;
  /** Weighted share of the range that raises, [0, 1]; never above `continues`. */
  raises: number;
}

export function responseFractions(
  range: WeightedRange,
  strength: Float32Array,
  params: PolicyParams,
  sizeFraction: number,
): RangeResponse {
  let mass = 0;
  let cont = 0;
  let raise = 0;
  for (let i = 0; i < RANGE_SIZE; i++) {
    const w = range[i] as number;
    if (w <= 0) continue;
    const s = strength[i] ?? 0;
    mass += w;
    cont += w * continuationOf(s, params, sizeFraction);
    raise += w * raiseBackOf(s, params, sizeFraction);
  }
  if (mass <= 0) return { continues: 0, raises: 0 };
  const continues = cont / mass;
  return { continues, raises: Math.min(continues, raise / mass) };
}

/**
 * Weighted mean strength percentile of `range`, and the mean over just the
 * portion that continues against `sizeFraction`. The ratio of "hero's
 * percentile vs the whole range" to "vs the continuing range" is how stage 4
 * derives `equityWhenCalled` without paying for a second Monte Carlo run.
 */
export interface RangeStrengthSummary {
  /** Weighted share of the range hero's holding beats outright, [0, 1]. */
  beatsAll: number;
  /** Same, restricted to the continuing portion. */
  beatsContinuing: number;
  /** Weighted mean percentile of the range. */
  meanPercentile: number;
}

export function summarizeAgainst(
  range: WeightedRange,
  strength: Float32Array,
  heroPercentile: number,
  params: PolicyParams,
  sizeFraction: number,
): RangeStrengthSummary {
  let mass = 0;
  let beats = 0;
  let contMass = 0;
  let contBeats = 0;
  let sum = 0;
  for (let i = 0; i < RANGE_SIZE; i++) {
    const w = range[i] as number;
    if (w <= 0) continue;
    const s = strength[i] ?? 0;
    const c = continuationOf(s, params, sizeFraction);
    mass += w;
    sum += w * s;
    if (heroPercentile > s) beats += w;
    contMass += w * c;
    if (heroPercentile > s) contBeats += w * c;
  }
  return {
    beatsAll: mass <= 0 ? 0.5 : beats / mass,
    beatsContinuing: contMass <= 0 ? 0 : contBeats / contMass,
    meanPercentile: mass <= 0 ? 0.5 : sum / mass,
  };
}
