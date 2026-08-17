import { describe, expect, it } from "vitest";
import type { HandEvent } from "@poker/history";
import { personaById } from "./cast/index";
import { observeHandEnd } from "./observe";
import { MAX_FOLD_EQUITY_SHIFT } from "./adaptation";
import { adaptationRamp, initialBotState, opponentOf, type BotState } from "./state";
import { decide } from "./pipeline";
import { startHand, streamsFor } from "./test-helpers";

/**
 * Scripted exploit pattern: seat 1 faces a raise every hand and folds every
 * time. Nothing else happens, so the only thing the observer can learn is
 * "this player folds to aggression".
 */
function foldsToEverything(handNumber: number): HandEvent[] {
  return [
    {
      t: "start",
      handNumber,
      button: 0,
      seats: [
        { seat: 0, stack: 20000 },
        { seat: 1, stack: 20000 },
      ],
      blinds: { sb: 50, bb: 100, ante: 0 },
    },
    { t: "post", seat: 0, kind: "sb", amount: 50 },
    { t: "post", seat: 1, kind: "bb", amount: 100 },
    { t: "act", seat: 0, kind: "raise", toAmount: 300 },
    { t: "act", seat: 1, kind: "fold" },
    { t: "pot", potIndex: 0, seat: 0, amount: 400 },
    {
      t: "end",
      net: [
        { seat: 0, net: 100 },
        { seat: 1, net: -100 },
      ],
    },
  ];
}

/** The mirror image: seat 1 calls everything down and never folds. */
function callsEverything(handNumber: number): HandEvent[] {
  return [
    {
      t: "start",
      handNumber,
      button: 0,
      seats: [
        { seat: 0, stack: 20000 },
        { seat: 1, stack: 20000 },
      ],
      blinds: { sb: 50, bb: 100, ante: 0 },
    },
    { t: "post", seat: 0, kind: "sb", amount: 50 },
    { t: "post", seat: 1, kind: "bb", amount: 100 },
    { t: "act", seat: 0, kind: "raise", toAmount: 300 },
    { t: "act", seat: 1, kind: "call", amount: 200 },
    { t: "board", street: "flop", cards: [10, 22, 35] },
    { t: "act", seat: 1, kind: "check" },
    { t: "act", seat: 0, kind: "bet", amount: 400 },
    { t: "act", seat: 1, kind: "call", amount: 400 },
    { t: "pot", potIndex: 0, seat: 1, amount: 1400 },
    {
      t: "end",
      net: [
        { seat: 0, net: -700 },
        { seat: 1, net: 700 },
      ],
    },
  ];
}

function observeMany(
  personaId: string,
  script: (n: number) => HandEvent[],
  hands: number,
): BotState {
  const persona = personaById(personaId);
  let state = initialBotState(persona);
  for (let n = 1; n <= hands; n++) state = observeHandEnd(state, persona, script(n), { seat: 0 });
  return state;
}

describe("opponent memory", () => {
  it("learns a fold-to-aggression pattern with exponential weighting", () => {
    const after10 = observeMany("ingrid", foldsToEverything, 10);
    const after80 = observeMany("ingrid", foldsToEverything, 80);
    const s10 = opponentOf(after10, 1);
    const s80 = opponentOf(after80, 1);
    expect(s10.foldToBet).toBeGreaterThan(0.5);
    expect(s80.foldToBet).toBeGreaterThan(s10.foldToBet);
    expect(s80.foldToBet).toBeGreaterThan(0.9);
    expect(s80.betsFaced).toBe(80);
    expect(s80.vpip).toBeLessThan(0.1);
  });

  it("learns the opposite pattern too", () => {
    const state = observeMany("ingrid", callsEverything, 80);
    const stats = opponentOf(state, 1);
    expect(stats.foldToBet).toBeLessThan(0.1);
    expect(stats.callDown).toBeGreaterThan(0.9);
    expect(stats.vpip).toBeGreaterThan(0.9);
  });

  it("ramps confidence over ~50-100 hands rather than trusting hand one", () => {
    expect(adaptationRamp({ ...opponentOf(observeMany("ingrid", foldsToEverything, 1), 1) })).toBeLessThan(0.1);
    expect(adaptationRamp({ ...opponentOf(observeMany("ingrid", foldsToEverything, 30), 1) })).toBeCloseTo(0.5, 1);
    expect(adaptationRamp({ ...opponentOf(observeMany("ingrid", foldsToEverything, 80), 1) })).toBe(1);
  });
});

describe("adaptation shifts fold-equity estimates", () => {
  function foldEquityFor(personaId: string, state: BotState): { shift: number; maxFoldFreq: number } {
    const persona = personaById(personaId);
    const { state: table, events } = startHand({ seed: "adapt", stacks: [20000, 20000] });
    const seat = table.actionSeat as number;
    const decision = decide(
      { state: table, seat, persona, events },
      state,
      streamsFor("adapt", seat, "preflop", 0),
    );
    const aggressive = decision.trace.candidates.rows.filter((r) => r.kind === "bet" || r.kind === "raise");
    return {
      shift: decision.trace.adaptation.foldEquityShift,
      maxFoldFreq: aggressive.reduce((acc, r) => Math.max(acc, r.foldFreq), 0),
    };
  }

  it("raises modelled fold equity after a scripted over-folder", () => {
    const ingrid = personaById("ingrid");
    const cold = foldEquityFor("ingrid", initialBotState(ingrid));
    const warm = foldEquityFor("ingrid", observeMany("ingrid", foldsToEverything, 80));
    expect(cold.shift).toBe(0);
    expect(warm.shift).toBeGreaterThan(0.1);
    expect(warm.maxFoldFreq).toBeGreaterThan(cold.maxFoldFreq);
  });

  it("lowers it after a scripted station", () => {
    const ingrid = personaById("ingrid");
    const cold = foldEquityFor("ingrid", initialBotState(ingrid));
    const warm = foldEquityFor("ingrid", observeMany("ingrid", callsEverything, 80));
    expect(warm.shift).toBeLessThan(-0.1);
    expect(warm.maxFoldFreq).toBeLessThan(cold.maxFoldFreq);
  });

  it("caps the shift no matter how extreme the pattern or how high adaptationRate is", () => {
    const warm = foldEquityFor("ingrid", observeMany("ingrid", foldsToEverything, 400));
    expect(warm.shift).toBeLessThanOrEqual(MAX_FOLD_EQUITY_SHIFT);
    expect(warm.shift).toBeCloseTo(MAX_FOLD_EQUITY_SHIFT, 6);
  });

  it("scales with the persona's adaptationRate — the Professor barely moves", () => {
    const ingrid = foldEquityFor("ingrid", observeMany("ingrid", foldsToEverything, 80)).shift;
    const professor = foldEquityFor(
      "the-professor",
      observeMany("the-professor", foldsToEverything, 80),
    ).shift;
    const doris = foldEquityFor("doris", observeMany("doris", foldsToEverything, 80)).shift;
    expect(ingrid).toBeGreaterThan(professor);
    expect(professor).toBeGreaterThan(doris);
    expect(doris).toBeLessThan(0.05);
  });

  it("reports what it did in the trace, including the confidence ramp", () => {
    const ingrid = personaById("ingrid");
    const state = observeMany("ingrid", foldsToEverything, 80);
    const { state: table, events } = startHand({ seed: "adapt-trace", stacks: [20000, 20000] });
    const seat = table.actionSeat as number;
    const trace = decide(
      { state: table, seat, persona: ingrid, events },
      state,
      streamsFor("adapt-trace", seat, "preflop", 0),
    ).trace.adaptation;
    expect(trace.primaryOpponent).toBe(seat === 0 ? 1 : 0);
    expect(trace.ramp).toBe(1);
    expect(trace.handsObserved).toBe(80);
    expect(trace.observedFoldToBet).toBeGreaterThan(0.9);
    expect(trace.capped).toBe(true);
  });
});
