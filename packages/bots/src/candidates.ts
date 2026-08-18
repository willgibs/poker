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
import type { ActionKind, Street } from "@poker/history";
import { responseFractions, summarizeAgainst } from "./policy";
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
 *
 * 1.6 is just above the largest size any authored persona owns (the `polar`
 * vocabulary tops out at 1.4x pot), so every character can still make every
 * bet its bible gives it — and nothing else. The bound matters most where it
 * compounds: a generated ceiling of 2.5x pot re-raised twice is a stack, which
 * is why an uncapped cast decides 3% of heads-up hands for 200bb and the tier
 * ladder inverts (the aggressor wins the small pots and loses the ladder).
 */
export const MAX_AGGRESSION_POT_RATIO = 1.6;

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

/**
 * Per-opponent raise-back frequency assumed by personas that do not model
 * fold equity. A whale knows people sometimes raise; he does not know who.
 */
export const NAIVE_RAISE_BACK = 0.12;

/** Equity realisation applied to a check: you do not always get to showdown. */
export const REALIZATION_OOP = 0.78;
export const REALIZATION_IP = 0.9;

/**
 * Weight given to a preflop opponent who has not voluntarily put a chip in
 * yet — a seat still to act, or one facing a raise it has not answered.
 *
 * The passive rows have to survive the players who actually see a flop, not
 * every seat that has merely not folded yet. Counting the whole table makes
 * cold-calling look like a five-way showdown against four random hands, which
 * is how a tier-5 reg ends up with a 12% VPIP.
 */
export const PENDING_OPPONENT_WEIGHT = 0.45;

/**
 * Stage 3 prices equity against ONE opponent — the primary villain's range.
 * Every passive row (check, call) then has to survive the whole field, and
 * beating five players is not the same event as beating one.
 *
 * The correction is the standard one: to win a showdown you must beat each
 * live opponent, so equity compounds as `e^n`. Pure `e^n` is too harsh —
 * opponents share a board, so their hands are positively correlated and their
 * ranges overlap — hence the exponent grows by {@link MULTIWAY_EQUITY_EXPONENT}
 * per extra opponent rather than by a full 1. At 0.55 this reproduces the
 * textbook multiway numbers closely (a hand 50% against one villain is ~34%
 * three-handed and ~16% five-handed; aces are ~55% five-handed).
 *
 * Leaving it out is not a rounding error: it is the single biggest reason a
 * table of bots limp-calls everything. The aggressive rows were always
 * multiway-aware (fold equity is raised to the power of the field), so without
 * this the model reads "call" as cheap and "bet" as expensive in exactly the
 * spots where the truth is the reverse.
 */
export const MULTIWAY_EQUITY_EXPONENT = 0.55;

/** Equity against a field of `opponents` live players. */
export function fieldEquity(equity: number, opponents: number): number {
  if (opponents <= 1 || equity <= 0) return equity;
  return Math.pow(equity, 1 + MULTIWAY_EQUITY_EXPONENT * (opponents - 1));
}

/**
 * One-street EV of investing `invest` chips when the villain folds `foldFreq`
 * of the time.
 *
 * For a BET this is exactly `@poker/equity`'s `foldEquityEV`, and it delegates.
 * For a RAISE it must not: `foldEquityEV` models a villain who calls the whole
 * of hero's investment, but a villain who has already bet only has to add the
 * raise INCREMENT. Feeding a raise into it counts the villain's bet twice —
 * once inside `pot`, once inside `2 * invest` — so every raise faced with a
 * bet in front of it books chips that do not exist. That is why an
 * unreconstructed pipeline folds or raises and almost never calls: the middle
 * of the strategy is priced out by an accounting error, and a bot that cannot
 * bluff-catch is the most exploitable thing at the table.
 */
export function aggressionEV(
  invest: number,
  toCall: number,
  pot: number,
  foldFreq: number,
  equityWhenCalled: number,
  raiseBackFreq = 0,
  expectedCallers = 1,
): number {
  if (raiseBackFreq <= 0 && toCall <= 0 && expectedCallers <= 1) {
    return foldEquityEV(invest, pot, foldFreq, equityWhenCalled);
  }
  const villainAdds = toCall <= 0 ? invest : Math.max(0, invest - toCall);
  // Every caller pays, not just the first. Discounting equity for a field of
  // four while booking one villain's chips is the asymmetry that makes a bot
  // fold aces under the gun at a table of stations.
  const evWhenCalled =
    equityWhenCalled * (pot + invest + Math.max(1, expectedCallers) * villainAdds) - invest;
  // Being raised off the hand costs the investment, less the share of it a
  // genuinely strong holding gets back by continuing. A bot that never prices
  // this bets and raises with everything, which is the maniac failure mode.
  const evWhenRaised = -invest * (1 - equityWhenCalled);
  const raised = clamp(raiseBackFreq, 0, 1 - foldFreq);
  const called = Math.max(0, 1 - foldFreq - raised);
  return foldFreq * pot + raised * evWhenRaised + called * evWhenCalled;
}

/**
 * Implied odds: the chips a call plays for beyond the pot on the table now.
 *
 * `callEV` treats a call as if it closed the hand — hero's equity against the
 * pot, full stop. That is right on the river and wrong everywhere else, and it
 * is wrong in one direction: it prices the CONTINUING rows pessimistically
 * while the aggressive rows book their fold equity in full. The consequence
 * shows up as a table that folds to 60% of every bet on every street and
 * reaches a showdown on one heads-up hand in ten — a bot you beat forever by
 * betting.
 *
 * Expressed as a multiple of the current pot, by street. The values are the
 * ordinary shape of a no-limit hand: most of the money still to come arrives
 * on the flop, less on the turn, none after the river card is out.
 */
export const IMPLIED_POT_FLOP = 0.35;
export const IMPLIED_POT_TURN = 0.2;

/** Multiplier on the pot a call plays for, by street. */
export function impliedPotMultiplier(street: Street): number {
  if (street === "flop") return 1 + IMPLIED_POT_FLOP;
  if (street === "turn") return 1 + IMPLIED_POT_TURN;
  return 1;
}

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
  // On the river there is nothing left to realise: the showdown is the pot.
  const realization =
    ctx.street === "river" ? 1 : ctx.inPosition ? REALIZATION_IP : REALIZATION_OOP;

  // Equity as the passive rows must see it: against the field that is actually
  // contesting the pot, discounting seats that have not paid to be here yet.
  const potEquity = fieldEquity(equity, contestedOpponents(ctx));

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
      equityWhenCalled: potEquity,
      ev: potEquity * pot * realization,
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
      equityWhenCalled: potEquity,
      ev: callEV(potEquity, Math.round(pot * impliedPotMultiplier(ctx.street)), call.amount),
      shapedEv: 0,
      probability: 0,
      gatedOut: false,
    });
  }

  // --- aggressive sizes ----------------------------------------------------
  const priceAggression = (invest: number, sizeFraction: number, toCall: number): {
    foldFreq: number;
    equityWhenCalled: number;
    ev: number;
  } => {
    // Fold equity is a MODELLED quantity — only tiers that can model it get
    // the real number; everyone else uses the flat naive assumption, which is
    // exactly the sort of thing a whale believes.
    //
    // It is also modelled SEAT BY SEAT. Stage 2 already holds a posterior and a
    // parameter set per live opponent; pricing a bet against the primary
    // villain and then raising that number to the power of the field says "the
    // table is six copies of the one player I am watching". Against a station
    // that reads as no fold equity anywhere and nobody ever opens a pot; against
    // a nit it reads as free money and everybody barrels.
    let foldAll = 1;
    let noRaise = 1;
    let callers = 0;
    for (const seat of ctx.opponents) {
      const range = rangeState.byOpponent.get(seat) ?? rangeState.primary;
      const params = rangeState.paramsByOpponent.get(seat) ?? rangeState.primaryParams;
      const response = caps.usesFoldEquity
        ? responseFractions(range, strengthNow, params, sizeFraction)
        : { continues: 1 - naiveFoldFreq(sizeFraction), raises: NAIVE_RAISE_BACK };
      const folds = clamp(1 - response.continues * (1 - foldEquityShift), 0, MAX_FOLD_FREQ);
      foldAll *= folds;
      noRaise *= 1 - clamp(response.raises, 0, 1);
      callers += 1 - folds;
    }
    const foldFreq = clamp(foldAll, 0, MAX_FOLD_FREQ);
    // Somebody raising is the union over the field, not one villain's habit.
    const raiseBackFreq = clamp(1 - noRaise, 0, 1);
    // Conditional on being called at all, at least one seat is in.
    const expectedCallers = Math.max(1, callers);

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
    // Getting called by one villain and getting called by four are different
    // showdowns: price the row against the callers it actually expects.
    const equityWhenCalled = clamp(
      fieldEquity(equity, expectedCallers) * clamp(ratio, 0.2, 1.15),
      0,
      1,
    );
    return {
      foldFreq,
      equityWhenCalled,
      ev: aggressionEV(
        invest,
        toCall,
        pot,
        foldFreq,
        equityWhenCalled,
        raiseBackFreq,
        expectedCallers,
      ),
    };
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
      const priced = priceAggression(size, sizeFraction, 0);
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
      const priced = priceAggression(invest, sizeFraction, ctx.toCall);
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

/**
 * Opponents actually contesting the pot, counting a preflop seat that has not
 * voluntarily invested at {@link PENDING_OPPONENT_WEIGHT}. Postflop every live
 * opponent has already paid to be there and counts in full.
 */
export function contestedOpponents(ctx: DecisionContext): number {
  if (ctx.opponents.length === 0) return 1;
  if (!ctx.isPreflop) return ctx.opponents.length;
  const voluntary = new Set<number>();
  for (const a of ctx.scan.byStreet.preflop) {
    if (a.kind === "call" || a.kind === "bet" || a.kind === "raise") voluntary.add(a.seat);
  }
  let n = 0;
  for (const seat of ctx.opponents) n += voluntary.has(seat) ? 1 : PENDING_OPPONENT_WEIGHT;
  return Math.max(1, n);
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
