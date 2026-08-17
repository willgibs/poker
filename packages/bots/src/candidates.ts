/**
 * Stage 4 — candidate generation and one-street EV.
 *
 * Every action the engine will accept becomes a row: fold, check, call, and
 * the persona's own sizing vocabulary of bets and raises (plus the all-in,
 * always). Each row is priced with a deliberately SHALLOW model — one street,
 * no future betting — because that is what a human at the table actually does
 * and because the honest shallow number is what the bot-mind reveal should
 * show. Deep search would make every character play the same.
 *
 * Fold equity comes from range continuance (`policy.continuanceFraction`), so
 * a bet's price is set by what the modelled opponent folds, not by a constant.
 * Tiers without the `usesFoldEquity` capability substitute a flat naive
 * assumption instead — they bet because they want to, not because they priced
 * it.
 */

import { assertChips } from "@poker/core";
import { callEV, foldEquityEV } from "@poker/equity";
import type { ActionKind } from "@poker/history";
import { continuanceFraction, summarizeAgainst } from "./policy";
import { capabilitiesFor, sizingSetOf, type Intent, type PersonaConfig } from "./persona";
import type { DecisionContext } from "./context";
import type { RangeState } from "./rangeState";
import type { StrengthEstimate } from "./strength";
import type { CandidateTrace, CandidatesTrace } from "./trace";

/**
 * Base fold frequency assumed, per opponent, by personas that do not model
 * fold equity. Crudely size-aware — even a whale knows a bigger bet folds more
 * people out — but blind to ranges, boards and history, which is the point.
 */
export const NAIVE_FOLD_FREQ = 0.3;

export function naiveFoldFreq(sizeFraction: number): number {
  return Math.min(0.9, NAIVE_FOLD_FREQ + 0.3 * Math.log(1 + Math.max(0.02, sizeFraction)));
}

/**
 * Largest bet a persona will consider, as a multiple of the pot — unless the
 * stack is already inside that bound, in which case the shove is on the menu.
 *
 * This is candidate GENERATION, not EV: a one-street EV model systematically
 * overrates all-ins (getting called is priced exactly, while a small bet's
 * future value is not priced at all), so without a bound the whole table
 * open-jams 200bb into a 7.5bb pot every hand. Humans rule those sizes out
 * before they price them, and so does this.
 */
export const MAX_AGGRESSION_POT_RATIO = 2.5;

/**
 * Preflop raises are additionally capped as a multiple of the CURRENT BET
 * LEVEL, which is how preflop sizing actually works: an open is ~3-4x the big
 * blind and each re-raise is a small multiple of the last, not a multiple of a
 * pot that is still tiny. Without this the pot-ratio cap compounds and six
 * players find a stack-off every hand.
 */
export const MAX_PREFLOP_OPEN_MULTIPLE = 4;
export const MAX_PREFLOP_RERAISE_MULTIPLE = 2.6;

/** Highest fold frequency any model is allowed to claim. */
export const MAX_FOLD_FREQ = 0.92;

/** Equity realisation applied to a check: you do not always get to showdown. */
export const REALIZATION_OOP = 0.78;
export const REALIZATION_IP = 0.9;

/** Percentile at or above which an aggressive action counts as value. */
export const VALUE_INTENT_PERCENTILE = 0.62;
/** Percentile below which an aggressive action counts as a bluff. */
export const BLUFF_INTENT_PERCENTILE = 0.42;

export interface Candidate {
  kind: ActionKind;
  /** Engine `ActionInput.amount`; absent for fold/check. */
  amount?: number;
  /** Chips added beyond the current street commitment. */
  invest: number;
  /** Size as a fraction of the pot faced. */
  sizeFraction: number;
  /** Size as a multiple of the current bet level (preflop sizing axis). */
  sizeMultiple: number;
  intent: Intent;
  foldFreq: number;
  equityWhenCalled: number;
  /** One-street EV in cents, relative to folding = 0. */
  ev: number;
  /** EV after personality shaping (stages 5-6); starts equal to `ev`. */
  shapedEv: number;
  /** Selection probability after shaping; 0 until stage 5 runs. */
  probability: number;
  /** True when the bluff gate removed this row from the pool. */
  gatedOut: boolean;
}

export interface CandidateSet {
  candidates: Candidate[];
  /** Fold-equity shift contributed by adaptation memory, for the trace. */
  foldEquityShift: number;
}

function intentOf(percentile: number, equity: number): Intent {
  if (percentile >= VALUE_INTENT_PERCENTILE || equity >= 0.62) return "value";
  if (percentile < BLUFF_INTENT_PERCENTILE && equity < 0.5) return "bluff";
  return "neutral";
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/**
 * Generate and price the candidate set.
 *
 * `foldEquityShift` is the (capped) adjustment adaptation memory contributes —
 * see stage 7. It is applied to every modelled fold frequency here, which is
 * precisely the sentence "adaptation shifts fold-equity estimates".
 */
export function buildCandidates(
  ctx: DecisionContext,
  persona: PersonaConfig,
  rangeState: RangeState,
  strength: StrengthEstimate,
  foldEquityShift: number,
): CandidateSet {
  const caps = capabilitiesFor(persona.tier);
  const sizing = sizingSetOf(persona);
  const strengthNow = rangeState.strength.forStreet(ctx.street);
  const pot = ctx.pot;
  const equity = strength.equity;
  const percentile = strength.strengthPercentile;
  const opponents = Math.max(1, ctx.opponents.length);
  // On the river there is nothing left to realise: the showdown is the pot.
  const realization =
    ctx.street === "river" ? 1 : ctx.inPosition ? REALIZATION_IP : REALIZATION_OOP;

  const candidates: Candidate[] = [];
  const seen = new Set<string>();

  const push = (c: Candidate): void => {
    const key = `${c.kind}:${c.amount ?? "-"}`;
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(c);
  };

  // --- fold ----------------------------------------------------------------
  if (ctx.legal.fold) {
    push({
      kind: "fold",
      invest: 0,
      sizeFraction: 0,
      sizeMultiple: 0,
      intent: "neutral",
      foldFreq: 0,
      equityWhenCalled: 0,
      ev: 0,
      shapedEv: 0,
      probability: 0,
      gatedOut: false,
    });
  }

  // --- check ---------------------------------------------------------------
  if (ctx.legal.check) {
    push({
      kind: "check",
      invest: 0,
      sizeFraction: 0,
      sizeMultiple: 0,
      intent: "neutral",
      foldFreq: 0,
      equityWhenCalled: equity,
      ev: equity * pot * realization,
      shapedEv: 0,
      probability: 0,
      gatedOut: false,
    });
  }

  // --- call ----------------------------------------------------------------
  const call = ctx.legal.call;
  if (call !== undefined) {
    assertChips(call.amount, "call amount");
    push({
      kind: "call",
      amount: call.amount,
      invest: call.amount,
      sizeFraction: pot > 0 ? call.amount / pot : 0,
      sizeMultiple: ctx.bb > 0 ? call.amount / ctx.bb : 0,
      intent: "neutral",
      foldFreq: 0,
      equityWhenCalled: equity,
      ev: callEV(equity, pot, call.amount),
      shapedEv: 0,
      probability: 0,
      gatedOut: false,
    });
  }

  // --- aggressive sizes ----------------------------------------------------
  const priceAggression = (invest: number, sizeFraction: number): {
    foldFreq: number;
    equityWhenCalled: number;
    ev: number;
  } => {
    // Fold equity is a MODELLED quantity — only tiers that can model it get
    // the real number; everyone else uses the flat naive assumption, which is
    // exactly the sort of thing a whale believes.
    const foldFreq = caps.usesFoldEquity
      ? Math.pow(
          clamp(
            1 - continuanceFraction(rangeState.primary, strengthNow, rangeState.primaryParams, sizeFraction) +
              foldEquityShift,
            0,
            MAX_FOLD_FREQ,
          ),
          opponents,
        )
      : clamp(Math.pow(clamp(naiveFoldFreq(sizeFraction) + foldEquityShift, 0, 0.9), opponents), 0, MAX_FOLD_FREQ);

    // Equity WHEN CALLED, however, is a fact about the world, not a skill: a
    // caller is stronger than a random hand at every tier. Skipping this
    // discount is what makes a naive model shove 200bb to win 3 — the maths
    // says "55% against a random hand" and never notices nobody calls with one.
    const summary = summarizeAgainst(
      rangeState.primary,
      strengthNow,
      percentile,
      rangeState.primaryParams,
      sizeFraction,
    );
    const ratio = summary.beatsAll > 0.001 ? summary.beatsContinuing / summary.beatsAll : 1;
    const equityWhenCalled = clamp(equity * clamp(ratio, 0.2, 1.15), 0, 1);
    return { foldFreq, equityWhenCalled, ev: foldEquityEV(invest, pot, foldFreq, equityWhenCalled) };
  };

  // Stacks already inside the bound are "effectively short": the shove is a
  // real sizing there, and stays on the menu.
  const commitCap = Math.round(pot * MAX_AGGRESSION_POT_RATIO);
  const preflopToCap = Math.round(
    ctx.currentBet *
      (ctx.line.preflopRaises <= 1 ? MAX_PREFLOP_OPEN_MULTIPLE : MAX_PREFLOP_RERAISE_MULTIPLE),
  );
  const allInAllowed =
    ctx.effectiveStack <= commitCap + ctx.bb * 2 ||
    (ctx.isPreflop && ctx.self.committedStreet + ctx.self.stack <= preflopToCap);

  const bet = ctx.legal.bet;
  if (bet !== undefined) {
    const ceiling = allInAllowed ? bet.max : Math.max(bet.min, Math.min(bet.max, commitCap));
    const sizes = new Set<number>();
    for (const f of sizing.potFractions) {
      sizes.add(clamp(Math.round(pot * f), bet.min, ceiling));
    }
    sizes.add(ceiling);
    for (const size of sizes) {
      if (size < 1) continue;
      const sizeFraction = pot > 0 ? size / pot : 1;
      const priced = priceAggression(size, sizeFraction);
      push({
        kind: "bet",
        amount: size,
        invest: size,
        sizeFraction,
        sizeMultiple: ctx.bb > 0 ? size / ctx.bb : 0,
        intent: intentOf(percentile, equity),
        foldFreq: priced.foldFreq,
        equityWhenCalled: priced.equityWhenCalled,
        ev: priced.ev,
        shapedEv: 0,
        probability: 0,
        gatedOut: false,
      });
    }
  }

  const raise = ctx.legal.raise;
  if (raise !== undefined) {
    const committedStreet = ctx.self.committedStreet;
    const structuralCap = ctx.isPreflop
      ? Math.min(committedStreet + commitCap, preflopToCap)
      : committedStreet + commitCap;
    const raiseCeiling = allInAllowed
      ? raise.maxTo
      : Math.max(raise.minTo, Math.min(raise.maxTo, structuralCap));
    const tos = new Set<number>();
    if (ctx.isPreflop) {
      for (const m of sizing.preflopMultipliers) {
        tos.add(clamp(Math.round(ctx.currentBet * m), raise.minTo, raiseCeiling));
      }
    } else {
      const potAfterCall = pot + ctx.toCall;
      for (const f of sizing.potFractions) {
        const to = ctx.currentBet + Math.round(potAfterCall * f);
        tos.add(clamp(to, raise.minTo, raiseCeiling));
      }
    }
    tos.add(raise.minTo);
    tos.add(raiseCeiling);
    for (const to of tos) {
      const invest = to - committedStreet;
      if (invest < 1) continue;
      const sizeFraction = pot > 0 ? invest / pot : 1;
      const priced = priceAggression(invest, sizeFraction);
      push({
        kind: "raise",
        amount: to,
        invest,
        sizeFraction,
        sizeMultiple: ctx.currentBet > 0 ? to / ctx.currentBet : 0,
        intent: intentOf(percentile, equity),
        foldFreq: priced.foldFreq,
        equityWhenCalled: priced.equityWhenCalled,
        ev: priced.ev,
        shapedEv: 0,
        probability: 0,
        gatedOut: false,
      });
    }
  }

  const gated = applyGates(candidates, persona, percentile);
  for (const c of gated) c.shapedEv = c.ev;
  return { candidates: gated, foldEquityShift };
}

/**
 * Remove rows the persona's structural gates make unreachable. Only aggressive
 * rows are ever removed, so fold/check/call always survive and the pool can
 * never empty.
 */
function applyGates(
  candidates: readonly Candidate[],
  persona: PersonaConfig,
  percentile: number,
): Candidate[] {
  const g = persona.gates;
  if (g === undefined) return [...candidates];
  return candidates.filter((c) => {
    const aggressive = c.kind === "bet" || c.kind === "raise";
    if (!aggressive) return true;
    if (g.aggressionMinStrength !== undefined && percentile < g.aggressionMinStrength) return false;
    if (c.kind === "raise" && g.raiseMinStrength !== undefined && percentile < g.raiseMinStrength) return false;
    if (
      g.nonValueMaxSizeFraction !== undefined &&
      c.intent !== "value" &&
      c.sizeFraction > g.nonValueMaxSizeFraction
    ) {
      return false;
    }
    if (g.forbiddenSizeBand !== undefined) {
      const [lo, hi] = g.forbiddenSizeBand;
      if (c.sizeFraction > lo && c.sizeFraction < hi) return false;
    }
    return true;
  });
}

/** Project the candidate list into its trace rows. */
export function candidatesTrace(candidates: readonly Candidate[], closeness: number): CandidatesTrace {
  let bestIndex = 0;
  let bestEv = Number.NEGATIVE_INFINITY;
  const rows: CandidateTrace[] = [];
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    if (c === undefined) continue;
    if (c.ev > bestEv) {
      bestEv = c.ev;
      bestIndex = i;
    }
    const row: CandidateTrace = {
      kind: c.kind,
      invest: c.invest,
      sizeFraction: c.sizeFraction,
      intent: c.intent,
      foldFreq: c.foldFreq,
      equityWhenCalled: c.equityWhenCalled,
      ev: c.ev,
      shapedEv: c.shapedEv,
      probability: c.probability,
    };
    if (c.amount !== undefined) row.amount = c.amount;
    if (c.gatedOut) row.gatedOut = true;
    rows.push(row);
  }
  return { rows, bestIndex, closeness };
}
