import { describe, expect, it } from "vitest";
import { personaById } from "./cast/index";
import { bandForCloseness, computeThinkTime } from "./timing";
import { buildContext, type DecisionContext } from "./context";
import type { Candidate } from "./candidates";
import { startHand } from "./test-helpers";

const priya = personaById("priya");
const doris = personaById("doris");

function contextFor(personaId: string): DecisionContext {
  const persona = personaById(personaId);
  const { state, events } = startHand({ seed: "timing-ctx", stacks: [20000, 20000, 20000] });
  return buildContext({ state, seat: state.actionSeat as number, persona, events });
}

function candidate(kind: Candidate["kind"]): Candidate {
  return {
    kind,
    invest: 0,
    sizeFraction: 0,
    sizeMultiple: 0,
    intent: "neutral",
    foldFreq: 0,
    equityWhenCalled: 0.5,
    ev: 0,
    shapedEv: 0,
    probability: 1,
    gatedOut: false,
  };
}

describe("bandForCloseness", () => {
  it("hits each authored anchor exactly", () => {
    expect(bandForCloseness(priya, 0)).toEqual(priya.timing.trivial);
    expect(bandForCloseness(priya, 0.5)).toEqual(priya.timing.base);
    expect(bandForCloseness(priya, 1)).toEqual(priya.timing.close);
  });

  it("is monotone: a closer decision never takes less time", () => {
    let previous = -1;
    for (let c = 0; c <= 1.0001; c += 0.1) {
      const band = bandForCloseness(priya, c);
      expect(band.maxMs).toBeGreaterThanOrEqual(previous);
      previous = band.maxMs;
    }
  });

  it("clamps closeness outside [0, 1]", () => {
    expect(bandForCloseness(priya, -5)).toEqual(priya.timing.trivial);
    expect(bandForCloseness(priya, 5)).toEqual(priya.timing.close);
  });

  it("lets a street band replace the MIDDLE anchor, not the whole clock", () => {
    const street = { minMs: 1000, maxMs: 2000 };
    expect(bandForCloseness(priya, 0.5, street)).toEqual(street);
    // The trivial and close ends are still the persona's own.
    expect(bandForCloseness(priya, 0, street)).toEqual(priya.timing.trivial);
    expect(bandForCloseness(priya, 1, street)).toEqual(priya.timing.close);
  });
});

describe("computeThinkTime", () => {
  const ctx = contextFor("priya");

  const run = (opts: Partial<Parameters<typeof computeThinkTime>[0]>): number =>
    computeThinkTime({
      ctx,
      persona: priya,
      candidate: candidate("call"),
      closeness: 0.5,
      tilt: 0,
      tellBand: null,
      tellScale: 1,
      jitterRoll: 0.5,
      ...opts,
    }).thinkTimeMs;

  it("returns raw integer milliseconds, never below the persona floor", () => {
    const ms = run({ tellBand: { minMs: 0, maxMs: 0 } });
    expect(Number.isInteger(ms)).toBe(true);
    expect(ms).toBe(priya.timing.floorMs);
  });

  it("takes longer on close decisions than trivial ones", () => {
    expect(run({ closeness: 1 })).toBeGreaterThan(run({ closeness: 0 }));
  });

  it("moves within the band as jitter moves, and stays inside it", () => {
    const low = run({ jitterRoll: 0 });
    const high = run({ jitterRoll: 0.999 });
    expect(high).toBeGreaterThan(low);
    // The test context is a preflop decision, so Priya's authored preflop
    // tempo replaces the middle anchor of the closeness curve.
    const band = bandForCloseness(priya, 0.5, priya.timing.streets?.preflop);
    expect(low).toBeGreaterThanOrEqual(band.minMs);
    expect(high).toBeLessThanOrEqual(band.maxMs);
  });

  it("applies the persona's tilt scale, weighted by susceptibility", () => {
    const chip = personaById("chip"); // tiltScale 0.6, susceptibility 0.9
    const chipCtx = contextFor("chip");
    const at = (tilt: number): number =>
      computeThinkTime({
        ctx: chipCtx,
        persona: chip,
        candidate: candidate("call"),
        closeness: 0.5,
        tilt,
        tellBand: null,
        tellScale: 1,
        jitterRoll: 0.5,
      }).thinkTimeMs;
    expect(at(1)).toBeLessThan(at(0));
    expect(at(1) / at(0)).toBeCloseTo(1 + 1 * 0.9 * (0.6 - 1), 2);
  });

  it("lets a tell replace the band outright", () => {
    const ms = run({ tellBand: { minMs: 6000, maxMs: 9000 }, jitterRoll: 0.5 });
    expect(ms).toBeGreaterThanOrEqual(6000);
    expect(ms).toBeLessThanOrEqual(9000);
  });

  it("keeps Doris's metronome inside 2.2-3.2s at every closeness", () => {
    const dorisCtx = contextFor("doris");
    for (const closeness of [0, 0.25, 0.5, 0.75, 1]) {
      for (const jitterRoll of [0, 0.5, 0.999]) {
        const ms = computeThinkTime({
          ctx: dorisCtx,
          persona: doris,
          candidate: candidate("call"),
          closeness,
          tilt: 0,
          tellBand: { minMs: 2200, maxMs: 3200 },
          tellScale: 1,
          jitterRoll,
        }).thinkTimeMs;
        expect(ms).toBeGreaterThanOrEqual(2200);
        expect(ms).toBeLessThanOrEqual(3200);
      }
    }
  });

  it("reports the pre-tell and post-tell bands separately in the trace", () => {
    const result = computeThinkTime({
      ctx,
      persona: priya,
      candidate: candidate("call"),
      closeness: 0.5,
      tilt: 0,
      tellBand: { minMs: 6000, maxMs: 9000 },
      tellScale: 1,
      jitterRoll: 0.5,
    });
    // baseBand is the pre-tell band: the closeness curve WITH the street
    // middle applied (this is a preflop context) but before tells/habits.
    expect(result.trace.baseBand).toEqual(
      bandForCloseness(priya, 0.5, priya.timing.streets?.preflop),
    );
    expect(result.trace.band).toEqual({ minMs: 6000, maxMs: 9000 });
    expect(result.trace.floorMs).toBe(priya.timing.floorMs);
    expect(result.trace.thinkTimeMs).toBe(result.thinkTimeMs);
  });
});
