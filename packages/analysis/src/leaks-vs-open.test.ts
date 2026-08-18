/**
 * Coverage for the "facing exactly one raise" preflop stats — threeBet,
 * coldCall — which the main `leaks.test.ts` corpus structurally cannot
 * exercise: its hero sits at seat 3 (UTG), first to act every hand, so
 * `raisesBefore` is always empty and the "Facing exactly one raise" branch
 * in `accumulateHand` never runs. This file's hero sits one seat later (CO,
 * seat 5) with UTG opening in front, so hero's first preflop action is
 * genuinely a response to a raise.
 *
 * Same builder conventions as `leaks.test.ts`: deterministic seeds, one
 * `HandBuilder` per synthetic hand, `corpus()` interleaves shapes with
 * unique hand numbers.
 */
import type { HandRecord } from "@poker/history";
import { describe, expect, it } from "vitest";
import { MIN_SAMPLE_HANDS } from "./concepts";
import { aggregateStats, detectLeaks, evaluateDetectors, statValue } from "./leaks";
import { hand } from "./test-helpers";

const SEATS = [0, 1, 2, 3, 4, 5];
const HERO = 5; // CO when the button is seat 0 and UTG (seat 3) opens first.

type Shape =
  | "hero-folds-vs-open"
  | "hero-three-bets"
  | "hero-cold-calls"
  | "hero-vs-nothing";

function makeHand(shape: Shape, n: number): HandRecord {
  const b = hand({
    handNumber: n,
    seats: SEATS,
    button: 0,
    stack: 20_000,
    bb: 100,
    id: `${shape}-${n}`,
    seed: `vs-open-${shape}-${n}`,
    board: ["Qc", "9d", "2s", "5h", "3c"],
  })
    .blinds()
    .dealTo(HERO, "Ah", "Qs")
    .deal();

  switch (shape) {
    // UTG opens, HJ folds, hero (CO) faces exactly one raise and folds.
    case "hero-folds-vs-open":
      b.raise(3, 300).fold(4).fold(HERO).fold(0).fold(1).fold(2);
      return b.award(3).build();

    // UTG opens, HJ folds, hero 3-bets, the field folds and UTG gives up.
    case "hero-three-bets":
      b.raise(3, 300).fold(4).raise(HERO, 900).fold(0).fold(1).fold(2).fold(3);
      return b.award(HERO).build();

    // UTG opens, HJ folds, hero cold-calls; the blinds fold and it runs out.
    case "hero-cold-calls":
      b.raise(3, 300).fold(4).call(HERO).fold(0).fold(1).fold(2);
      b.flop().check(3).check(HERO).turn().check(3).check(HERO).river().check(3).check(HERO);
      return b.showdown(3, HERO).award(3).build();

    // Nobody opens ahead of hero at all: a walk to the BB, not a threeBet
    // spot — pure filler to move the hand count without touching the stat.
    case "hero-vs-nothing":
      b.fold(3).fold(4).fold(HERO).fold(0).fold(1);
      return b.award(2).build();
  }
}

function corpus(mix: ReadonlyArray<[Shape, number]>): HandRecord[] {
  const out: HandRecord[] = [];
  let n = 1;
  for (const [shape, count] of mix) {
    for (let i = 0; i < count; i++) out.push(makeHand(shape, n++));
  }
  return out;
}

function fired(records: readonly HandRecord[], detectorId: string): boolean {
  return detectLeaks(aggregateStats(records, HERO)).some((f) => f.detector.id === detectorId);
}

describe("aggregateStats — facing exactly one raise", () => {
  it("counts threeBet's opportunity only over vs-open spots, not every hand", () => {
    const records = corpus([
      ["hero-three-bets", 6],
      ["hero-cold-calls", 24],
      ["hero-folds-vs-open", 470],
      ["hero-vs-nothing", 500],
    ]);
    const agg = aggregateStats(records, HERO);
    expect(agg.hands).toBe(1000);
    // The walk hands (no raise in front of hero) do not count as opportunities.
    expect(agg.counters.threeBet.d).toBe(500);
    expect(statValue(agg, "threeBet")).toBeCloseTo(1.2, 6); // 6 / 500
    expect(statValue(agg, "coldCall")).toBeCloseTo(4.8, 6); // 24 / 500
  });
});

describe("three-bet-too-rare", () => {
  it("fires when hero 3-bets well under the 4% healthy floor", () => {
    const records = corpus([
      ["hero-three-bets", 10],
      ["hero-cold-calls", 40],
      ["hero-folds-vs-open", 450],
      ["hero-vs-nothing", 500],
    ]);
    const agg = aggregateStats(records, HERO);
    expect(statValue(agg, "threeBet")).toBeCloseTo(2, 6); // 10 / 500
    const finding = detectLeaks(agg).find((f) => f.detector.id === "three-bet-too-rare");
    expect(finding).toBeDefined();
    expect(finding?.concept).toBe("3betting");
    expect(finding?.deviation).toBeCloseTo(2, 6); // threshold 4 − observed 2
    expect(finding?.costBb100).toBeGreaterThan(0);
    expect(finding?.drillHook).toContain("3-bet");
  });

  it("does not fire exactly at the 4% threshold; fires the moment it drops below", () => {
    const atThreshold = corpus([
      ["hero-three-bets", 4],
      ["hero-cold-calls", 96],
      ["hero-vs-nothing", 400],
    ]);
    const justBelow = corpus([
      ["hero-three-bets", 3],
      ["hero-cold-calls", 97],
      ["hero-vs-nothing", 400],
    ]);
    expect(statValue(aggregateStats(atThreshold, HERO), "threeBet")).toBe(4);
    expect(statValue(aggregateStats(justBelow, HERO), "threeBet")).toBe(3);
    expect(fired(atThreshold, "three-bet-too-rare")).toBe(false);
    expect(fired(justBelow, "three-bet-too-rare")).toBe(true);
  });

  it("does not fire below the preflop-response 500-hand family gate, however extreme", () => {
    // 0% threeBet, but only 499 hands total — one short of the 500-hand gate.
    const records = corpus([
      ["hero-cold-calls", 100],
      ["hero-vs-nothing", 399],
    ]);
    const agg = aggregateStats(records, HERO);
    expect(agg.hands).toBe(499);
    expect(statValue(agg, "threeBet")).toBe(0);
    expect(detectLeaks(agg).some((f) => f.detector.id === "three-bet-too-rare")).toBe(false);
    const gated = evaluateDetectors(agg).find((f) => f.detector.id === "three-bet-too-rare");
    expect(gated?.gateMet).toBe(false);
    expect(gated?.minHands).toBe(MIN_SAMPLE_HANDS["preflop-response"]);
    expect(gated?.hands).toBe(499);
  });

  it("fires the moment the 500-hand family gate is met", () => {
    const under = corpus([
      ["hero-cold-calls", 100],
      ["hero-vs-nothing", 399],
    ]);
    const over = corpus([
      ["hero-cold-calls", 100],
      ["hero-vs-nothing", 400],
    ]);
    expect(aggregateStats(under, HERO).hands).toBe(499);
    expect(aggregateStats(over, HERO).hands).toBe(500);
    expect(fired(under, "three-bet-too-rare")).toBe(false);
    expect(fired(over, "three-bet-too-rare")).toBe(true);
  });

  it("also requires the detector's own minimum opportunity count (60)", () => {
    // 500+ hands clears the family gate, but only 10 vs-open spots occur.
    const records = corpus([
      ["hero-cold-calls", 10],
      ["hero-vs-nothing", 490],
    ]);
    const agg = aggregateStats(records, HERO);
    expect(agg.hands).toBe(500);
    expect(agg.counters.threeBet.d).toBe(10);
    expect(statValue(agg, "threeBet")).toBe(0);
    expect(detectLeaks(agg).some((f) => f.detector.id === "three-bet-too-rare")).toBe(false);
  });
});
