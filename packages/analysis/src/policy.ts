/**
 * Villain policy model — the generative half of range estimation.
 *
 * `@poker/ranges`'s `filter` is Bayes over 1326 hypotheses: it needs
 * `P(observed action | villain holds this combo)`. That likelihood is
 * the OPPONENT'S POLICY, and the honest source of it is the bot that actually
 * acted. The simulator injects its bots' ground-truth persona policies; this
 * module supplies the fallback used when nobody did — a deliberately simple,
 * monotone, tier-parameterised model.
 *
 * The fallback is a *model*, not solver output, and every grade computed
 * through it is labelled with reduced confidence for exactly that reason (see
 * `types.ts`). Its only structural claims are the ones that are actually true
 * of both bots and humans:
 *
 * - stronger hands bet and raise more often than weaker ones;
 * - weaker hands fold more often than stronger ones;
 * - the very bottom of a range bets sometimes anyway (bluffs exist);
 * - bigger bets face tighter continuing ranges.
 *
 * Likelihoods are relative — `filter` renormalizes — so only their shape
 * matters, and every one is strictly positive so no combo is ever zeroed by a
 * model that might simply be wrong.
 */

import type { ActionKind, Card, Street } from "@poker/history";

/** What the villain did, plus the state it happened in. */
export interface VillainActionContext {
  seat: number;
  street: Street;
  kind: ActionKind;
  /** Pot before the action, cents. */
  potBefore: number;
  /** Price the villain faced, cents (0 when checking was legal). */
  toCall: number;
  /** Chips the villain put in, cents. */
  invested: number;
  board: readonly Card[];
  /** Live players including the actor. */
  livePlayers: number;
  /** Bet/raise size as a fraction of `potBefore`; 0 for fold/check/call. */
  sizeFraction: number;
  /** Prior aggressive actions on this street. 0 = first aggression. */
  aggressionIndex: number;
  /**
   * Strength percentile of the combo on this board, `[0, 1]` (see
   * `strength.ts`). Supplied by the caller so the table is computed once per
   * board rather than once per combo per action.
   */
  strength: number;
}

/**
 * `P(ctx.kind | villain holds comboIndex)` under some policy. Any finite value
 * >= 0; scale is irrelevant. The combo index is the canonical `@poker/core`
 * combo order.
 */
export type PolicyLikelihood = (ctx: VillainActionContext, comboIndex: number) => number;

/** Coarse skill/style tiers for the fallback policy. */
export type PolicyTier = "recreational" | "regular" | "strong";

/** Shape parameters of the fallback policy. All dimensionless. */
export interface PolicyProfile {
  /** Floor under every likelihood — nothing is ever impossible. */
  floor: number;
  /** Exponent on strength for value aggression. Higher = more polarised. */
  valueExponent: number;
  /** Exponent on weakness for folding. Higher = folds only the true bottom. */
  foldExponent: number;
  /** Extra aggression given to the bottom `bluffBand` of the range. */
  bluffMass: number;
  /** Fraction of the range (from the bottom) that bluffs. */
  bluffBand: number;
  /** How hard a big bet tightens the continuing range. */
  sizePressure: number;
}

/** Fallback policy profiles by tier. Hand-tuned; not solver output. */
export const POLICY_PROFILES: Readonly<Record<PolicyTier, PolicyProfile>> = {
  recreational: {
    floor: 0.08,
    valueExponent: 1.6,
    foldExponent: 1.2,
    bluffMass: 0.05,
    bluffBand: 0.1,
    sizePressure: 0.4,
  },
  regular: {
    floor: 0.05,
    valueExponent: 2.2,
    foldExponent: 1.8,
    bluffMass: 0.18,
    bluffBand: 0.18,
    sizePressure: 0.8,
  },
  strong: {
    floor: 0.04,
    valueExponent: 2.6,
    foldExponent: 2.2,
    bluffMass: 0.3,
    bluffBand: 0.25,
    sizePressure: 1.1,
  },
};

/** The default tier when the caller names none. */
export const DEFAULT_POLICY_TIER: PolicyTier = "regular";

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * Relative likelihood of an aggressive action (bet/raise) with strength `s`:
 * monotone in strength, plus a bluff bump at the bottom of the range. Bigger
 * sizings need more strength (or more bluff).
 */
function aggressionLikelihood(p: PolicyProfile, s: number, sizeFraction: number): number {
  const size = Math.max(0, sizeFraction);
  const exponent = p.valueExponent * (1 + p.sizePressure * Math.min(size, 2));
  const value = Math.pow(s, exponent);
  const depth = s < p.bluffBand ? (p.bluffBand - s) / p.bluffBand : 0;
  return p.floor + (1 - p.floor) * value + p.bluffMass * depth;
}

/** Relative likelihood of folding with strength `s` facing `sizeFraction`. */
function foldLikelihood(p: PolicyProfile, s: number, sizeFraction: number): number {
  const size = Math.max(0, sizeFraction);
  const exponent = p.foldExponent / (1 + p.sizePressure * Math.min(size, 2));
  return p.floor + (1 - p.floor) * Math.pow(1 - s, exponent);
}

/**
 * Relative likelihood of calling with strength `s`: peaks in the middle of the
 * range — the classic bluff-catcher hump. The nuts prefer to raise, air prefers
 * to fold, and what is left calls.
 */
function callLikelihood(p: PolicyProfile, s: number, sizeFraction: number): number {
  const size = Math.max(0, sizeFraction);
  const centre = clamp01(0.5 + 0.2 * Math.min(size, 1.5));
  const spread = 0.42;
  const z = (s - centre) / spread;
  return p.floor + (1 - p.floor) * Math.exp(-0.5 * z * z);
}

/** Relative likelihood of checking with strength `s`: weak-to-medium hands. */
function checkLikelihood(p: PolicyProfile, s: number): number {
  return p.floor + (1 - p.floor) * Math.pow(1 - s, 1.2);
}

/**
 * The tier-default fallback policy. Deterministic and allocation-free.
 *
 * Use it only when no ground-truth policy is available; grades produced with
 * it are capped at `medium` confidence by the postflop grader.
 */
export function tierDefaultPolicy(tier: PolicyTier = DEFAULT_POLICY_TIER): PolicyLikelihood {
  const p = POLICY_PROFILES[tier];
  return (ctx) => {
    const s = clamp01(ctx.strength);
    switch (ctx.kind) {
      case "fold":
        return foldLikelihood(p, s, ctx.toCall > 0 && ctx.potBefore > 0 ? ctx.toCall / ctx.potBefore : 0);
      case "check":
        return checkLikelihood(p, s);
      case "call":
        return callLikelihood(p, s, ctx.toCall > 0 && ctx.potBefore > 0 ? ctx.toCall / ctx.potBefore : 0);
      case "bet":
      case "raise":
        return aggressionLikelihood(p, s, ctx.sizeFraction);
      default:
        return p.floor;
    }
  };
}

/**
 * Continue-vs-fold split used when pricing hero's own bets: given a bet of
 * `sizeFraction` pots, how often does a holding of strength `s` fold?
 *
 * Same shape as the observed-action model, expressed as a probability so the
 * grader can weight a range by it. Returned value is in `[0, 1]`.
 */
export function foldProbability(
  tier: PolicyTier,
  strength: number,
  sizeFraction: number,
): number {
  const p = POLICY_PROFILES[tier];
  const s = clamp01(strength);
  const fold = foldLikelihood(p, s, sizeFraction);
  const cont = callLikelihood(p, s, sizeFraction) + aggressionLikelihood(p, s, sizeFraction) * 0.35;
  const denom = fold + cont;
  return denom <= 0 ? 0 : clamp01(fold / denom);
}
