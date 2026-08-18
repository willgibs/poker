/**
 * Ground-truth villain policy — the bots' own generative model, handed to the
 * grader.
 *
 * `@poker/analysis` estimates a villain's range by Bayesian filtering, which
 * needs `P(observed action | villain holds this combo)`. That likelihood IS a
 * policy, and the honest source of it is the character who actually acted. The
 * analysis package ships a deliberately simple tier-default fallback and caps
 * confidence when it is used; this module removes the need for it in simulated
 * play by wiring `@poker/bots`' `policyLikelihood` curves — `aggressionOf` and
 * `continuationOf`, the exact functions the bot decided with — into the shape
 * the grader consumes.
 *
 * The two packages disagree only in calling convention: bots hand `filter` a
 * `(comboIndex) => number` closure built over a 1326-entry strength table,
 * while analysis calls `(ctx, comboIndex)` with the combo's strength already
 * resolved on `ctx.strength`. Composing the same curves per call keeps this
 * allocation-free in a loop that runs 1326 times per villain action;
 * `policy.test.ts` pins the two against each other so "identical model" stays a
 * checked claim rather than a comment.
 */

import type { PolicyLikelihood, VillainActionContext } from "@poker/analysis";
import {
  DEFAULT_POLICY_PARAMS,
  aggressionOf,
  continuationOf,
  type PersonaConfig,
  type PolicyParams,
} from "@poker/bots";
import type { ActionKind } from "@poker/history";

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/** A persona's declared policy parameters — the ground truth for its seat. */
export function policyParamsOf(persona: PersonaConfig): PolicyParams {
  return {
    aggression: persona.aggression,
    bluffFrequency: persona.bluffFrequency,
    callDownTendency: persona.callDownTendency,
    tightness: persona.tightness,
  };
}

/** Component-wise mean; the neutral parameters when the list is empty. */
export function meanPolicyParams(list: readonly PolicyParams[]): PolicyParams {
  if (list.length === 0) return { ...DEFAULT_POLICY_PARAMS };
  let aggression = 0;
  let bluffFrequency = 0;
  let callDownTendency = 0;
  let tightness = 0;
  for (const p of list) {
    aggression += p.aggression;
    bluffFrequency += p.bluffFrequency;
    callDownTendency += p.callDownTendency;
    tightness += p.tightness;
  }
  const n = list.length;
  return {
    aggression: aggression / n,
    bluffFrequency: bluffFrequency / n,
    callDownTendency: callDownTendency / n,
    tightness: tightness / n,
  };
}

/**
 * `P(action | combo at strength s)` under `params` — the body of
 * `@poker/bots`' `policyLikelihood`, evaluated for a single combo.
 */
export function likelihoodOf(
  action: ActionKind,
  sizeFraction: number,
  strength: number,
  params: PolicyParams,
): number {
  const agg = aggressionOf(strength, params, Math.max(sizeFraction, 0.5));
  const cont = continuationOf(strength, params, Math.max(sizeFraction, 0.05));
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
      return clamp01(aggressionOf(strength, params, Math.max(sizeFraction, 1)) * 0.9);
  }
  return 1;
}

/**
 * Build the grader's policy from the seated cast.
 *
 * Seats with no persona (the hero) fall back to the table's mean villain
 * parameters — the grader asks "how would a villain react to hero's bet?" using
 * hero's own seat on the context, and answering with the field's average
 * character is both deterministic and the closest honest answer available.
 */
export function groundTruthPolicy(
  personaBySeat: ReadonlyMap<number, PersonaConfig>,
): PolicyLikelihood {
  const paramsBySeat = new Map<number, PolicyParams>();
  for (const [seat, persona] of personaBySeat) paramsBySeat.set(seat, policyParamsOf(persona));
  const fallback = meanPolicyParams([...paramsBySeat.values()]);
  return (ctx: VillainActionContext): number =>
    likelihoodOf(
      ctx.kind,
      ctx.sizeFraction,
      Math.max(0, ctx.strength),
      paramsBySeat.get(ctx.seat) ?? fallback,
    );
}
