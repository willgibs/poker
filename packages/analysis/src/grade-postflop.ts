/**
 * Postflop grading: Monte-Carlo EV against an estimated villain range.
 *
 * PRD Q23 sets the frame precisely — "postflop Monte-Carlo EV vs estimated
 * ranges (honest-estimate framing; no embedded solver)". This module does
 * exactly that, and refuses to pretend otherwise:
 *
 * 1. Reconstruct every hero decision point from the event log.
 * 2. Estimate each villain's range: a positional/action prior from
 *    `@poker/ranges`, then a Bayesian `filter` step per observed action, using
 *    a policy-likelihood function. The simulator injects its bots' own
 *    ground-truth policies; without one a tier-default fallback is used, and
 *    the confidence label drops accordingly.
 * 3. Price the action hero took against a small menu of alternatives, and
 *    report the BAND of the difference.
 *
 * ## Exactness ladder (PRD top risk #2: grading miscalibration)
 *
 * On the RIVER, heads-up, the board is complete: equity is an exact
 * enumeration over the villain's combos, no sampling at all. That makes river
 * spots a ground-truth corpus the grader is regression-tested against
 * (`grade-postflop.test.ts`). Earlier streets sample with FIXED trial counts
 * (never time-boxed) from a stream derived from the hand seed and the
 * decisionId — so a hand always grades to the same number, and a what-if
 * branch reaching the same position re-derives the same stream.
 *
 * Confidence is a function of the two things that can be wrong — the equity
 * method and the range — never of how the grade "feels":
 *
 * | range \ EV method     | exact enumeration | Monte Carlo |
 * |-----------------------|-------------------|-------------|
 * | given (ground truth)  | high              | medium      |
 * | filtered / prior      | medium            | low         |
 *
 * and a multiway pot drops one level further, because a one-street heads-up EV
 * model fits worse the more players are in.
 *
 * ## The EV model, stated plainly
 *
 * One street of betting, no future streets, no raises behind:
 *
 * ```text
 * EV(fold)    = 0                                      (the reference point)
 * EV(check)   = equity · pot                           (checked down)
 * EV(call)    = equity · (pot + toCall) − toCall
 * EV(bet b)   = f · pot + (1 − f) · (eqCalled · (pot + 2b) − b)
 * EV(raise r) = f · pot + (1 − f) · (eqCalled · (pot + add + villCall) − add)
 * ```
 *
 * `f` is the villain range's fold mass at that size and `eqCalled` is hero's
 * equity against what continues. It is a deliberately simple model — the PRD's
 * audience is intermediate players and the product ships no solver — which is
 * exactly why its output is banded and labelled instead of printed to four
 * decimals.
 */

import type { Card } from "@poker/core";
import {
  type Evaluate7,
  callEV,
  equityVsRange,
  equityVsRangeMC,
  multiwayEquityMC,
} from "@poker/equity";
import type { HandRecord } from "@poker/history";
import {
  type WeightedRange,
  DEFAULT_PREFLOP_RANKING,
  RANGE_SIZE,
  clone,
  filter,
  maskBlocked,
  topPercentByRanking,
  total,
} from "@poker/ranges";
import { streamFor } from "@poker/rng";
import type { ConceptId } from "./concepts";
import { defaultEvaluate7 } from "./evaluator";
import {
  type PolicyLikelihood,
  type PolicyTier,
  type VillainActionContext,
  DEFAULT_POLICY_TIER,
  foldProbability,
  tierDefaultPolicy,
} from "./policy";
import { type ActionView, type HandView, buildHandView, seatView } from "./replay";
import { createStrengthCache } from "./strength";
import {
  type Confidence,
  type DecisionGrade,
  type EvBasis,
  type RangeSource,
  bandForEvLoss,
  quantizeEvBb,
  weakenConfidence,
} from "./types";

/** Fixed Monte Carlo trials per equity estimate. Never time-boxed. */
export const DEFAULT_TRIALS = 3000;

/** Likelihood floor for Bayesian filtering — see `@poker/ranges`'s `filter`. */
export const DEFAULT_EPSILON_FLOOR = 0.02;

/** Bet sizes (fraction of pot) the grader prices against. */
export const DEFAULT_BET_FRACTIONS: readonly number[] = [0.33, 0.75];

/** Raise sizes (fraction of the pot after the call) the grader prices against. */
export const DEFAULT_RAISE_FRACTIONS: readonly number[] = [0.75];

export interface PostflopGradeOptions {
  heroSeat: number;
  evaluate7?: Evaluate7;
  /**
   * Ground-truth policy from the simulator: `P(observed action | combo)` for a
   * villain. Absent, a tier-default fallback is used and confidence drops.
   */
  policy?: PolicyLikelihood;
  /** Tier for the fallback policy and for hero's fold-equity estimates. */
  tier?: PolicyTier;
  /**
   * Known villain ranges by seat. Used as-is — never filtered — because a
   * range we were *given* is evidence, not a guess. This is what makes an
   * exact river grade a ground-truth measurement.
   */
  villainRanges?: ReadonlyMap<number, Float32Array>;
  /** Override the preflop prior for a villain seat. */
  priorFor?: (seat: number, view: HandView) => Float32Array;
  trials?: number;
  epsilonFloor?: number;
  betFractions?: readonly number[];
  raiseFractions?: readonly number[];
}

/**
 * Preflop prior width (fraction of the 1326 combos) by the villain's preflop
 * line. Hand-tuned pool baselines, not solver output: they exist so a graded
 * spot starts from something defensible rather than from the whole deck, and
 * every grade computed off them is labelled `prior`/`filtered`, never `given`.
 */
export const PREFLOP_PRIOR_PCT = {
  open: 0.22,
  threeBet: 0.09,
  fourBetPlus: 0.045,
  coldCall: 0.28,
  blindDefend: 0.42,
  limp: 0.35,
  checkedOption: 0.55,
} as const;

/** Classify a villain's preflop line and return the prior width to use. */
export function preflopPriorPct(view: HandView, seat: number): number {
  const mine = view.actions.filter((a) => a.street === "preflop" && a.seat === seat);
  const last = mine[mine.length - 1];
  if (last === undefined) return PREFLOP_PRIOR_PCT.checkedOption;
  const raisesBefore = view.actions.filter(
    (a) => a.street === "preflop" && a.kind === "raise" && a.eventIndex < last.eventIndex,
  ).length;
  if (last.kind === "raise") {
    if (raisesBefore === 0) return PREFLOP_PRIOR_PCT.open;
    if (raisesBefore === 1) return PREFLOP_PRIOR_PCT.threeBet;
    return PREFLOP_PRIOR_PCT.fourBetPlus;
  }
  if (last.kind === "call") {
    if (raisesBefore === 0) return PREFLOP_PRIOR_PCT.limp;
    const pos = seatView(view, seat)?.position;
    return pos === "BB" || pos === "SB" ? PREFLOP_PRIOR_PCT.blindDefend : PREFLOP_PRIOR_PCT.coldCall;
  }
  return PREFLOP_PRIOR_PCT.checkedOption;
}

/** Primary concept tag for a postflop decision (at most one, per taxonomy). */
function conceptFor(action: ActionView, multiway: boolean): ConceptId {
  if (multiway) return "multiway-adjustments";
  switch (action.kind) {
    case "fold":
      return "folding-discipline";
    case "call":
      return action.street === "river" ? "bluff-catching" : "pot-odds";
    case "check":
      return action.street === "river" ? "thin-value" : "pot-control";
    case "bet":
      if (action.street === "flop") {
        return action.aggressionIndex === 0 ? "cbet-basics" : "value-betting";
      }
      return action.street === "turn" ? "double-barreling" : "value-betting";
    default:
      return action.street === "river" ? "polarization" : "semibluffing";
  }
}

/**
 * Grade every postflop decision hero made in `record`.
 *
 * One {@link DecisionGrade} per hero postflop action, keyed by the `decisionId`
 * scheme in docs/hand-format.md. Decisions the model cannot price (hero's cards
 * absent, no live villain, a collapsed range estimate) come back with no band
 * and `unknown` confidence rather than a fabricated number.
 */
export function gradePostflop(record: HandRecord, opts: PostflopGradeOptions): DecisionGrade[] {
  const view = buildHandView(record);
  const heroSeat = opts.heroSeat;
  const heroCards = seatView(view, heroSeat)?.holeCards ?? null;
  const evaluate7 = opts.evaluate7 ?? defaultEvaluate7;
  const tier = opts.tier ?? DEFAULT_POLICY_TIER;
  const policy = opts.policy ?? tierDefaultPolicy(tier);
  const policyGiven = opts.policy !== undefined;
  const trials = opts.trials ?? DEFAULT_TRIALS;
  const epsilonFloor = opts.epsilonFloor ?? DEFAULT_EPSILON_FLOOR;
  const strengths = createStrengthCache();
  const out: DecisionGrade[] = [];

  const ranges = new Map<number, WeightedRange>();
  const given = new Set<number>();
  for (const s of view.seats) {
    if (s.seat === heroSeat) continue;
    const supplied = opts.villainRanges?.get(s.seat);
    if (supplied !== undefined) {
      ranges.set(s.seat, clone(supplied));
      given.add(s.seat);
    } else if (opts.priorFor !== undefined) {
      ranges.set(s.seat, clone(opts.priorFor(s.seat, view)));
    } else {
      ranges.set(
        s.seat,
        topPercentByRanking(preflopPriorPct(view, s.seat), DEFAULT_PREFLOP_RANKING),
      );
    }
  }

  const heroDead: Card[] = heroCards === null ? [] : [heroCards[0], heroCards[1]];

  for (const action of view.actions) {
    if (action.street === "preflop") continue;

    const dead = [...heroDead, ...action.board];
    for (const r of ranges.values()) maskBlocked(r, dead, r);

    if (action.seat === heroSeat) {
      out.push(
        gradeOne(view, action, {
          heroCards,
          ranges,
          given,
          evaluate7,
          tier,
          policy,
          policyGiven,
          trials,
          betFractions: opts.betFractions ?? DEFAULT_BET_FRACTIONS,
          raiseFractions: opts.raiseFractions ?? DEFAULT_RAISE_FRACTIONS,
          strengths,
        }),
      );
    } else {
      const r = ranges.get(action.seat);
      if (r !== undefined && !given.has(action.seat)) {
        const table = strengths(action.board, heroDead);
        filter(
          r,
          (combo) => policy(contextOf(action, Math.max(0, table[combo] ?? 0)), combo),
          epsilonFloor,
          r,
        );
      }
    }
    if (action.kind === "fold") ranges.delete(action.seat);
  }
  return out;
}

function contextOf(action: ActionView, strength: number): VillainActionContext {
  return {
    seat: action.seat,
    street: action.street,
    kind: action.kind,
    potBefore: action.potBefore,
    toCall: action.toCall,
    invested: action.invested,
    board: action.board,
    livePlayers: action.livePlayers,
    sizeFraction: action.sizeFraction,
    aggressionIndex: action.aggressionIndex,
    strength,
  };
}

interface Alternative {
  label: string;
  kind: "fold" | "check" | "call" | "bet" | "raise";
  /** Chips hero adds to the pot, cents. */
  amount: number;
  /** Hero's total street commitment after the action, cents (raises only). */
  toAmount?: number;
}

interface GradeContext {
  heroCards: readonly [Card, Card] | null;
  ranges: Map<number, WeightedRange>;
  given: Set<number>;
  evaluate7: Evaluate7;
  tier: PolicyTier;
  policy: PolicyLikelihood;
  policyGiven: boolean;
  trials: number;
  betFractions: readonly number[];
  raiseFractions: readonly number[];
  strengths: (board: readonly Card[], dead?: readonly Card[]) => Float64Array;
}

function ungraded(action: ActionView, note: string): DecisionGrade {
  return {
    decisionId: action.decisionId,
    street: action.street,
    seat: action.seat,
    kind: action.kind,
    confidence: "unknown",
    basis: "none",
    note,
  };
}

function gradeOne(view: HandView, action: ActionView, ctx: GradeContext): DecisionGrade {
  const hero = ctx.heroCards;
  if (hero === null) return ungraded(action, "hero hole cards are absent from this record");
  const bb = view.bb;
  if (bb <= 0) return ungraded(action, "hand has no big blind — cannot express EV in bb");

  const villainSeats = [...ctx.ranges.keys()].filter((s) => stillLive(view, s, action));
  if (villainSeats.length === 0) return ungraded(action, "no live villain to price this against");
  const villainRanges = villainSeats.map((s) => ctx.ranges.get(s) as WeightedRange);
  if (villainRanges.some((r) => total(r) <= 0)) {
    return ungraded(action, "villain range estimate collapsed to nothing — declining to grade");
  }

  const multiway = villainSeats.length > 1;
  const exact = action.board.length === 5 && !multiway;
  const basis: EvBasis = exact ? "exact-enumeration" : "monte-carlo";
  const rangeSource: RangeSource = villainSeats.every((s) => ctx.given.has(s))
    ? "given"
    : ctx.policyGiven
      ? "filtered"
      : "prior";

  const table = ctx.strengths(action.board, [hero[0], hero[1]]);

  const equityOf = (ranges: readonly WeightedRange[], label: string): number => {
    if (ranges.length === 1) {
      const r = ranges[0] as WeightedRange;
      if (exact) return equityVsRange(hero, r, action.board, ctx.evaluate7).equity;
      const stream = streamFor(view.seed, `analysis/postflop/${action.decisionId}/${label}`);
      return equityVsRangeMC(hero, r, action.board, ctx.evaluate7, stream, ctx.trials).equity;
    }
    const stream = streamFor(view.seed, `analysis/postflop/${action.decisionId}/${label}`);
    return multiwayEquityMC(hero, [...ranges], action.board, ctx.evaluate7, stream, ctx.trials)
      .equity;
  };

  const equityNow = equityOf(villainRanges, "now");
  const foldProb = foldProbabilityFn(action, ctx, table);

  const pressure = (
    sizeFraction: number,
  ): { foldFreq: number; continued: WeightedRange[]; ok: boolean } => {
    let foldFreq = 1;
    const continued: WeightedRange[] = [];
    for (const r of villainRanges) {
      const next = new Float32Array(RANGE_SIZE);
      let mass = 0;
      let foldMass = 0;
      for (let i = 0; i < RANGE_SIZE; i++) {
        const w = r[i] ?? 0;
        if (w <= 0) continue;
        const pf = foldProb(i, sizeFraction);
        mass += w;
        foldMass += w * pf;
        next[i] = w * (1 - pf);
      }
      if (mass <= 0) return { foldFreq: 1, continued: [], ok: false };
      foldFreq *= foldMass / mass;
      continued.push(next);
    }
    return { foldFreq, continued, ok: continued.every((r) => total(r) > 0) };
  };

  const taken = takenLabel(action, view);
  const priced: { action: string; evBb: number }[] = [];
  let takenEv = 0;
  let takenFound = false;

  for (const alt of buildAlternatives(view, action, ctx)) {
    const evBb = priceAlternative(view, action, alt, { equityNow, equityOf, pressure }) / bb;
    priced.push({ action: alt.label, evBb: quantizeEvBb(evBb, basis) });
    if (alt.label === taken) {
      takenEv = evBb;
      takenFound = true;
    }
  }
  if (!takenFound) return ungraded(action, "could not price the action hero actually took");

  priced.sort((a, b) => b.evBb - a.evBb);
  const best = priced[0];
  if (best === undefined) return ungraded(action, "no alternatives to compare against");

  const evLossBb = quantizeEvBb(Math.max(0, best.evBb - takenEv), basis);

  let confidence: Confidence = exact
    ? rangeSource === "given"
      ? "high"
      : "medium"
    : rangeSource === "given"
      ? "medium"
      : "low";
  if (multiway) confidence = weakenConfidence(confidence, 1);

  const evDetail = {
    basis,
    rangeSource,
    livePlayers: action.livePlayers,
    takenEvBb: quantizeEvBb(takenEv, basis),
    bestEvBb: best.evBb,
    bestAction: best.action,
    alternatives: priced,
    ...(exact ? {} : { trials: ctx.trials }),
  };

  return {
    decisionId: action.decisionId,
    street: action.street,
    seat: action.seat,
    kind: action.kind,
    band: bandForEvLoss(evLossBb),
    confidence,
    evLossBb,
    basis,
    concept: conceptFor(action, multiway),
    ev: evDetail,
    note:
      evLossBb <= 0
        ? `${taken} is the best of the lines priced here (${describeBasis(basis, ctx.trials, rangeSource)})`
        : `${best.action} prices ${evLossBb.toFixed(exact ? 3 : 2)}bb better than ${taken} (${describeBasis(basis, ctx.trials, rangeSource)})`,
  };
}

/**
 * How often a villain combo folds to a bet of `sizeFraction` pots.
 *
 * With a ground-truth policy injected, the split comes from that policy's own
 * likelihoods — the bot tells us how it would react. Without one, the
 * tier-default model answers, and every grade built on it is already labelled
 * `low`/`medium` confidence.
 */
function foldProbabilityFn(
  action: ActionView,
  ctx: GradeContext,
  table: Float64Array,
): (comboIndex: number, sizeFraction: number) => number {
  if (!ctx.policyGiven) {
    return (i, size) => foldProbability(ctx.tier, Math.max(0, table[i] ?? 0), size);
  }
  return (i, size) => {
    const strength = Math.max(0, table[i] ?? 0);
    const facing = Math.round(size * action.potBefore);
    const base = {
      seat: action.seat,
      street: action.street,
      potBefore: action.potBefore,
      toCall: facing,
      invested: 0,
      board: action.board,
      livePlayers: action.livePlayers,
      sizeFraction: 0,
      aggressionIndex: action.aggressionIndex + 1,
      strength,
    };
    const fold = Math.max(0, ctx.policy({ ...base, kind: "fold" }, i));
    const call = Math.max(0, ctx.policy({ ...base, kind: "call", invested: facing }, i));
    const raise = Math.max(
      0,
      ctx.policy({ ...base, kind: "raise", invested: facing * 3, sizeFraction: size * 3 }, i),
    );
    const denom = fold + call + raise;
    return denom <= 0 ? 0 : fold / denom;
  };
}

function describeBasis(basis: EvBasis, trials: number, source: RangeSource): string {
  const range =
    source === "given"
      ? "a known villain range"
      : source === "filtered"
        ? "a range filtered from the villain's own policy"
        : "a range estimated from a pool prior";
  return basis === "exact-enumeration"
    ? `exact river enumeration vs ${range}`
    : `${trials} fixed Monte Carlo trials vs ${range}`;
}

function stillLive(view: HandView, seat: number, before: ActionView): boolean {
  for (const a of view.actions) {
    if (a.eventIndex >= before.eventIndex) break;
    if (a.seat === seat && a.kind === "fold") return false;
  }
  return true;
}

/** Deterministic label for the action hero actually took. */
function takenLabel(action: ActionView, view: HandView): string {
  switch (action.kind) {
    case "fold":
      return "fold";
    case "check":
      return "check";
    case "call":
      return "call";
    case "bet":
      return `bet ${fracLabel(action.invested, action.potBefore)}`;
    default:
      return `raise to ${((action.committedStreetBefore + action.invested) / view.bb).toFixed(1)}bb`;
  }
}

function fracLabel(amount: number, pot: number): string {
  return pot > 0 ? `${(amount / pot).toFixed(2)}p` : `${amount}c`;
}

function buildAlternatives(view: HandView, action: ActionView, ctx: GradeContext): Alternative[] {
  const out: Alternative[] = [];
  const seen = new Set<string>();
  const push = (a: Alternative): void => {
    if (seen.has(a.label)) return;
    seen.add(a.label);
    out.push(a);
  };

  // The line hero actually took, priced at its real size.
  switch (action.kind) {
    case "fold":
      push({ label: "fold", kind: "fold", amount: 0 });
      break;
    case "check":
      push({ label: "check", kind: "check", amount: 0 });
      break;
    case "call":
      push({ label: "call", kind: "call", amount: action.invested });
      break;
    case "bet":
      push({ label: takenLabel(action, view), kind: "bet", amount: action.invested });
      break;
    default:
      push({
        label: takenLabel(action, view),
        kind: "raise",
        amount: action.invested,
        toAmount: action.committedStreetBefore + action.invested,
      });
      break;
  }

  const stack = action.stackBefore;
  if (action.toCall === 0) {
    push({ label: "check", kind: "check", amount: 0 });
    for (const f of ctx.betFractions) {
      const amount = Math.min(stack, Math.max(view.bb, Math.round(f * action.potBefore)));
      if (amount <= 0) continue;
      push({ label: `bet ${fracLabel(amount, action.potBefore)}`, kind: "bet", amount });
    }
  } else {
    push({ label: "fold", kind: "fold", amount: 0 });
    const callAmount = Math.min(stack, action.toCall);
    if (callAmount > 0) push({ label: "call", kind: "call", amount: callAmount });
    for (const f of ctx.raiseFractions) {
      const extra = Math.round(f * (action.potBefore + action.toCall));
      const amount = Math.min(stack, action.toCall + extra);
      if (amount <= action.toCall) continue;
      const toAmount = action.committedStreetBefore + amount;
      push({ label: `raise to ${(toAmount / view.bb).toFixed(1)}bb`, kind: "raise", amount, toAmount });
    }
  }
  return out;
}

interface PricingContext {
  equityNow: number;
  equityOf: (ranges: readonly WeightedRange[], label: string) => number;
  pressure: (sizeFraction: number) => { foldFreq: number; continued: WeightedRange[]; ok: boolean };
}

/** EV of one alternative in cents, relative to folding. */
function priceAlternative(
  view: HandView,
  action: ActionView,
  alt: Alternative,
  ctx: PricingContext,
): number {
  const pot = action.potBefore;
  switch (alt.kind) {
    case "fold":
      return 0;
    case "check":
      return ctx.equityNow * pot;
    case "call":
      return callEV(ctx.equityNow, pot, alt.amount);
    case "bet": {
      const sizeFraction = pot > 0 ? alt.amount / pot : 1;
      const { foldFreq, continued, ok } = ctx.pressure(sizeFraction);
      if (!ok) return foldFreq * pot;
      const eqCalled = ctx.equityOf(continued, `${alt.label}/called`);
      return foldFreq * pot + (1 - foldFreq) * (eqCalled * (pot + 2 * alt.amount) - alt.amount);
    }
    default: {
      const potAfterCall = pot + action.toCall;
      const sizeFraction = potAfterCall > 0 ? (alt.amount - action.toCall) / potAfterCall : 1;
      const { foldFreq, continued, ok } = ctx.pressure(sizeFraction);
      if (!ok) return foldFreq * pot;
      const eqCalled = ctx.equityOf(continued, `${alt.label}/called`);
      const villCall = villainCallAmount(view, action, alt);
      return foldFreq * pot + (1 - foldFreq) * (eqCalled * (pot + alt.amount + villCall) - alt.amount);
    }
  }
}

/** Chips the villain must add to call hero's raise, capped by their stack. */
function villainCallAmount(view: HandView, action: ActionView, alt: Alternative): number {
  const toAmount = alt.toAmount ?? action.committedStreetBefore + alt.amount;
  const villainStreet = action.committedStreetBefore + action.toCall;
  const owed = Math.max(0, toAmount - villainStreet);
  let shallowest = Number.POSITIVE_INFINITY;
  for (const s of view.seats) {
    if (s.seat === action.seat) continue;
    if (!stillLive(view, s.seat, action)) continue;
    shallowest = Math.min(shallowest, remainingStack(view, s.seat, action.eventIndex));
  }
  return Number.isFinite(shallowest) ? Math.min(owed, shallowest) : owed;
}

/** A seat's stack (cents) immediately before the event at `eventIndex`. */
function remainingStack(view: HandView, seat: number, eventIndex: number): number {
  const s = seatView(view, seat);
  if (s === undefined) return 0;
  let spent = s.posted;
  for (const a of view.actions) {
    if (a.eventIndex >= eventIndex) break;
    if (a.seat === seat) spent += a.invested;
  }
  return Math.max(0, s.startingStack - spent);
}
