/**
 * `decide` — the nine-stage bot decision pipeline.
 *
 * ```
 * 1 context      2 range state   3 strength     4 candidates + EV
 * 5 shaping      6 tilt/error    7 adaptation   8 think time    9 trace
 * ```
 *
 * Ordering note: stage 7 is the adaptation MEMORY. Memory is read early (its
 * fold-equity shift is what stage 4 prices bets against, and its opponent
 * model is what stage 2's prior is sized from) and written at hand boundaries
 * by `observeHandEnd`. Stage 7's slot in the sequence is where it reports what
 * it contributed — putting the read call physically later would mean pricing
 * candidates against a model the bot had not consulted yet.
 *
 * Everything is pure and deterministic: identical `(snapshot, botState,
 * streams)` always produce an identical `BotDecision`, on every platform. All
 * randomness comes from the two injected streams, in a fixed draw order that
 * does not depend on the board — otherwise a what-if branch would diverge for
 * reasons the player could never see.
 */

import { suitOf } from "@poker/core";
import { legalActions } from "@poker/engine";
import type { ActionKind } from "@poker/history";
import { buildContext, type DecisionContext } from "./context";
import { buildRangeState } from "./rangeState";
import { estimateStrength } from "./strength";
import { buildCandidates, candidatesTrace, type Candidate } from "./candidates";
import { shapeAndSelect } from "./shaping";
import { computeAdaptation } from "./adaptation";
import { injectDeliberateError, mistakeEligible, tiltAdjust } from "./tilt";
import { applyBehaviorTells, applySizingTells, applyTimingTells, type TellFacts } from "./tells";
import { computeThinkTime } from "./timing";
import { holdingFeatures } from "./handclass";
import { cloneBotState, opponentOf, type BotState } from "./state";
import { STAGE_NAMES, type DecisionTrace, type FiredTellTrace } from "./trace";
import type { BotDecision, BotStreams, DecisionSnapshot } from "./types";

/**
 * Decide one action.
 *
 * @throws RangeError when the snapshot is not this seat's turn, or the engine
 * offers no legal action at all (both are caller bugs, not game states).
 */
export function decide(
  snapshot: DecisionSnapshot,
  botState: BotState,
  streams: BotStreams,
): BotDecision {
  const { state, seat, persona } = snapshot;
  if (state.actionSeat !== seat) {
    throw new RangeError(`decide called for seat ${seat} but the action is on ${String(state.actionSeat)}`);
  }

  // --- stage 1: context ----------------------------------------------------
  const ctx = buildContext(snapshot);
  if (ctx.legalKinds.length === 0) throw new RangeError("engine offers no legal action");

  // --- stage 2: range state ------------------------------------------------
  const rangeState = buildRangeState(ctx, persona, botState);

  // --- stage 3: strength ---------------------------------------------------
  const strength = estimateStrength(ctx, persona, rangeState, streams.mc);

  // --- stage 7 (read): adaptation memory -----------------------------------
  const adaptation = computeAdaptation(ctx, persona, botState);

  // --- stage 4: candidates + one-street EV ---------------------------------
  const { candidates } = buildCandidates(ctx, persona, rangeState, strength, adaptation.foldEquityShift);
  if (candidates.length === 0) throw new RangeError("no candidate actions generated");

  // Fixed draw order — never conditional on the board or the persona.
  const bluffRoll = streams.decision.nextFloat();
  const selectionRoll = streams.decision.nextFloat();
  const errorRoll = streams.decision.nextFloat();
  const jitterRoll = streams.decision.nextFloat();

  const primarySeat = adaptation.trace.primaryOpponent;
  const opponentStats = primarySeat === null ? null : opponentOf(botState, primarySeat);
  const features = holdingFeatures(ctx.hole, ctx.board);
  const poolFacts = buildFacts(
    snapshot,
    ctx,
    candidates[0] as Candidate,
    strength.strengthPercentile,
    botState,
    features,
    Math.abs(adaptation.foldEquityShift),
    opponentStats,
  );
  const behaviorTells = applyBehaviorTells(persona, poolFacts, botState);
  const behavior = {
    disableFold: behaviorTells.disableFold,
    aggressionBias: behaviorTells.aggressionBias,
    bluffFrequencyScale: behaviorTells.bluffFrequencyScale * adaptation.bluffScale,
  };

  // --- stage 5: personality shaping ----------------------------------------
  const baseParams = tiltAdjust(persona, 0);
  const shaped = shapeAndSelect({
    ctx,
    persona,
    params: baseParams,
    candidates,
    strengthPercentile: strength.strengthPercentile,
    bluffRoll,
    selectionRoll,
    behavior,
  });

  // --- stage 6: tilt + deliberate error ------------------------------------
  const tiltParams = tiltAdjust(persona, botState.tilt);
  const tilted =
    botState.tilt > 0
      ? shapeAndSelect({
          ctx,
          persona,
          params: tiltParams,
          candidates,
          strengthPercentile: strength.strengthPercentile,
          bluffRoll,
          selectionRoll,
          behavior,
        })
      : shaped;
  const changedChoice = tilted.chosen !== shaped.chosen;

  const eligible = mistakeEligible(ctx, persona, strength.strengthPercentile, botState.tilt, opponentStats);
  const injected = injectDeliberateError(
    ctx,
    persona,
    tilted.chosen,
    candidates,
    eligible,
    tiltParams.errorRate,
    errorRoll,
  );
  let chosen: Candidate = injected.candidate;

  // Safety net: never return an action the engine did not offer.
  if (!ctx.legalKinds.includes(chosen.kind)) {
    const fallback = candidates.find((c) => ctx.legalKinds.includes(c.kind));
    if (fallback === undefined) throw new RangeError("no legal candidate survived selection");
    chosen = fallback;
  }

  // --- stage 8: tells + think time -----------------------------------------
  const handNumber = handNumberOf(ctx);
  const facts = buildFacts(
    snapshot,
    ctx,
    chosen,
    strength.strengthPercentile,
    botState,
    features,
    Math.abs(adaptation.foldEquityShift),
    opponentStats,
  );

  const sizing = applySizingTells(persona, facts, botState);
  const timingTells = applyTimingTells(persona, facts, botState);
  const timing = computeThinkTime({
    ctx,
    persona,
    candidate: chosen,
    closeness: tilted.closeness,
    tilt: botState.tilt,
    tellBand: timingTells.band,
    tellScale: timingTells.scale,
    jitterRoll,
  });

  const firedTells: FiredTellTrace[] = [...behaviorTells.fired, ...sizing.fired, ...timingTells.fired];

  // --- final engine amount -------------------------------------------------
  const amount = resolveAmount(chosen, sizing.amount, ctx, candidates);
  const finalFraction = chosen.kind === "bet" || chosen.kind === "raise" ? sizing.sizeFraction : chosen.sizeFraction;

  // --- stage 9: trace ------------------------------------------------------
  const trace: DecisionTrace = {
    v: 1,
    personaId: persona.id,
    personaName: persona.name,
    tier: persona.tier,
    stagesCompleted: STAGE_NAMES,
    context: {
      street: ctx.street,
      seat: ctx.seat,
      position: ctx.position,
      inPosition: ctx.inPosition,
      pot: ctx.pot,
      toCall: ctx.toCall,
      stack: ctx.stack,
      effectiveStack: ctx.effectiveStack,
      spr: ctx.spr,
      potOddsRequired: ctx.potOddsRequired,
      opponents: ctx.opponents,
      board: ctx.board,
      hole: ctx.hole,
      texture: ctx.texture,
      scareCard: ctx.scareCard,
      line: ctx.line,
      legal: ctx.legalKinds,
    },
    rangeState: rangeState.trace,
    strength: strength.trace,
    candidates: candidatesTrace(candidates, tilted.closeness),
    shaping: tilted.trace,
    tiltError: {
      tilt: botState.tilt,
      susceptibility: persona.tiltSusceptibility,
      effectiveAggression: tiltParams.aggression,
      effectiveCallDown: tiltParams.callDownTendency,
      effectiveErrorRate: tiltParams.errorRate,
      changedChoice,
      deliberateError: injected.deliberateError,
      evSacrificed: injected.evSacrificed,
      errorRoll: injected.roll,
      ...(injected.deliberateError
        ? { errorClass: persona.mistake.id, errorLabel: persona.mistake.label }
        : {}),
    },
    adaptation: adaptation.trace,
    timing: timing.trace,
    tells: firedTells,
    chosen: {
      kind: chosen.kind,
      ...(amount !== undefined ? { amount } : {}),
      sizeFraction: finalFraction,
      intent: chosen.intent,
      ev: chosen.ev,
    },
  };

  // --- next state ----------------------------------------------------------
  const nextBotState = cloneBotState(botState);
  for (const id of [...behaviorTells.firedIds, ...sizing.firedIds, ...timingTells.firedIds]) {
    nextBotState.tellLastFired[id] = handNumber;
  }

  const decision: BotDecision = {
    action: chosen.kind,
    thinkTimeMs: timing.thinkTimeMs,
    trace,
    nextBotState,
  };
  if (amount !== undefined) decision.amount = amount;
  return decision;
}

/**
 * 1-based hand number for cooldown bookkeeping: the log's own number when the
 * log has a `start` event, otherwise engine truth.
 */
function handNumberOf(ctx: DecisionContext): number {
  return ctx.scan.handNumber > 0 ? ctx.scan.handNumber : ctx.handNumber;
}

/** Assemble the fact set every tell trigger is evaluated against. */
function buildFacts(
  snapshot: DecisionSnapshot,
  ctx: DecisionContext,
  candidate: Candidate,
  strengthPercentile: number,
  botState: BotState,
  features: ReturnType<typeof holdingFeatures>,
  adaptationShift: number,
  opponent: ReturnType<typeof opponentOf> | null,
): TellFacts {
  let opponentConsecutiveChecks = 0;
  for (const [, n] of ctx.line.consecutiveChecksBySeat) {
    if (n > opponentConsecutiveChecks) opponentConsecutiveChecks = n;
  }
  const facts: TellFacts = {
    ctx,
    candidate,
    strengthPercentile,
    tilt: botState.tilt,
    features,
    handsObserved: botState.handsObserved,
    handNumber: handNumberOf(ctx),
    handsSinceFlop: botState.handsSinceFlop,
    suited: suitOf(ctx.hole[0]) === suitOf(ctx.hole[1]),
    oneCardFlushInterest: hasOneCardFlushInterest(ctx),
    opponentConsecutiveChecks,
    adaptationShift,
    opponent,
  };
  if (snapshot.heroSeat !== undefined) facts.heroSeat = snapshot.heroSeat;
  return facts;
}

/** Board shows 2+ of a suit and the bot holds exactly one card of that suit. */
function hasOneCardFlushInterest(ctx: DecisionContext): boolean {
  if (ctx.board.length < 2) return false;
  const counts = [0, 0, 0, 0];
  for (const c of ctx.board) counts[suitOf(c)] = (counts[suitOf(c)] ?? 0) + 1;
  const s0 = suitOf(ctx.hole[0]);
  const s1 = suitOf(ctx.hole[1]);
  for (let s = 0; s < 4; s++) {
    if ((counts[s] ?? 0) < 2) continue;
    const held = (s0 === s ? 1 : 0) + (s1 === s ? 1 : 0);
    if (held === 1) return true;
  }
  return false;
}

/**
 * Engine `ActionInput.amount` for the chosen candidate: bet size, raise-to
 * total, exact call amount, or nothing for fold and check. Sizing tells may
 * have moved the amount; it is re-clamped to the legal menu here so a tell can
 * never make an action illegal.
 */
function resolveAmount(
  candidate: Candidate,
  tellAmount: number | undefined,
  ctx: DecisionContext,
  candidates: readonly Candidate[],
): number | undefined {
  if (candidate.kind === "fold" || candidate.kind === "check") return undefined;
  if (candidate.kind === "call") return ctx.legal.call?.amount ?? candidate.amount;
  const proposed = tellAmount ?? candidate.amount;
  if (proposed === undefined) return undefined;

  // A sizing tell reshapes the size WITHIN the persona's generated envelope:
  // clamped to the legal menu, and never past the largest (or below the
  // smallest) size stage 4 was willing to consider. Tells change what a bet
  // says, not how much of the stack it risks.
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const c of candidates) {
    if (c.kind !== candidate.kind || c.amount === undefined) continue;
    if (c.amount < lo) lo = c.amount;
    if (c.amount > hi) hi = c.amount;
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
    lo = proposed;
    hi = proposed;
  }
  const bounded = Math.max(lo, Math.min(hi, Math.round(proposed)));

  if (candidate.kind === "bet") {
    const bet = ctx.legal.bet;
    if (bet === undefined) return bounded;
    return Math.max(bet.min, Math.min(bet.max, bounded));
  }
  const raise = ctx.legal.raise;
  if (raise === undefined) return bounded;
  return Math.max(raise.minTo, Math.min(raise.maxTo, bounded));
}

/**
 * Convenience wrapper: compute the legal menu, decide, and hand back an
 * `ActionInput` the engine's `applyAction` accepts verbatim.
 */
export function decideAction(
  snapshot: DecisionSnapshot,
  botState: BotState,
  streams: BotStreams,
): { input: { seat: number; kind: ActionKind; amount?: number }; decision: BotDecision } {
  const withLegal: DecisionSnapshot =
    snapshot.legal === undefined ? { ...snapshot, legal: legalActions(snapshot.state) } : snapshot;
  const decision = decide(withLegal, botState, streams);
  const input: { seat: number; kind: ActionKind; amount?: number } = {
    seat: snapshot.seat,
    kind: decision.action,
  };
  if (decision.amount !== undefined) input.amount = decision.amount;
  return { input, decision };
}
