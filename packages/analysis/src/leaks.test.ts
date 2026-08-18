import type { HandRecord } from "@poker/history";
import { describe, expect, it } from "vitest";
import { MIN_SAMPLE_HANDS, STATS, minSampleHands } from "./concepts";
import {
  LEAK_DETECTORS,
  aggregateStats,
  detectLeaks,
  evaluateDetectors,
  statValue,
} from "./leaks";
import { hand } from "./test-helpers";

const SEATS = [0, 1, 2, 3, 4, 5];
const HERO = 3; // UTG when the button is seat 0

/**
 * Corpus builder. Each hand is a full 6-max hand with hero at seat 3 and the
 * button at seat 0, so hero's position is UTG throughout — every stat below is
 * therefore a clean, position-stable measurement.
 *
 * `shape` decides what hero does; everything else is scripted to make the
 * denominator hero needs actually occur.
 */
type Shape =
  | "hero-folds-utg"
  | "hero-opens-utg"
  | "hero-limps-utg"
  | "hero-folds-to-3bet"
  | "hero-calls-3bet"
  | "hero-cbets-flop"
  | "hero-checks-flop"
  | "hero-cbets-then-barrels"
  | "hero-cbets-then-gives-up"
  | "hero-folds-to-cbet"
  | "hero-calls-cbet"
  | "hero-showdown-win"
  | "hero-showdown-loss";

function makeHand(shape: Shape, n: number): HandRecord {
  const b = hand({
    handNumber: n,
    seats: SEATS,
    button: 0,
    stack: 20_000,
    bb: 100,
    id: `${shape}-${n}`,
    seed: `corpus-${shape}-${n}`,
    board: ["Qc", "9d", "2s", "5h", "3c"],
  })
    .blinds()
    .dealTo(HERO, "Ah", "Qs")
    .deal();

  switch (shape) {
    case "hero-folds-utg":
      b.fold(HERO).fold(4).fold(5).fold(0).fold(1);
      return b.award(2).build();

    case "hero-limps-utg":
      b.call(HERO).fold(4).fold(5).fold(0).fold(1).check(2);
      b.flop().check(2).check(HERO).turn().check(2).check(HERO).river().check(2).check(HERO);
      return b.showdown(2, HERO).award(HERO).build();

    case "hero-opens-utg":
      b.raise(HERO, 300).fold(4).fold(5).fold(0).fold(1).fold(2);
      return b.award(HERO).build();

    case "hero-folds-to-3bet":
      b.raise(HERO, 300).fold(4).raise(5, 900).fold(0).fold(1).fold(2).fold(HERO);
      return b.award(5).build();

    case "hero-calls-3bet":
      b.raise(HERO, 300).fold(4).raise(5, 900).fold(0).fold(1).fold(2).call(HERO);
      b.flop().check(HERO).check(5).turn().check(HERO).check(5).river().check(HERO).check(5);
      return b.showdown(HERO, 5).award(HERO).build();

    case "hero-cbets-flop":
      b.raise(HERO, 300).fold(4).fold(5).fold(0).fold(1).call(2);
      b.flop().check(2).bet(HERO, 400).fold(2);
      return b.award(HERO).build();

    case "hero-checks-flop":
      b.raise(HERO, 300).fold(4).fold(5).fold(0).fold(1).call(2);
      b.flop().check(2).check(HERO).turn().check(2).check(HERO).river().check(2).check(HERO);
      return b.showdown(2, HERO).award(HERO).build();

    case "hero-cbets-then-barrels":
      b.raise(HERO, 300).fold(4).fold(5).fold(0).fold(1).call(2);
      b.flop().check(2).bet(HERO, 400).call(2);
      b.turn().check(2).bet(HERO, 900).fold(2);
      return b.award(HERO).build();

    case "hero-cbets-then-gives-up":
      b.raise(HERO, 300).fold(4).fold(5).fold(0).fold(1).call(2);
      b.flop().check(2).bet(HERO, 400).call(2);
      b.turn().check(2).check(HERO);
      b.river().check(2).check(HERO);
      return b.showdown(2, HERO).award(HERO).build();

    // Hero opens from UTG, gets 3-bet by the cutoff and calls; the cutoff is
    // now the preflop aggressor, so its flop bet is the c-bet hero faces.
    case "hero-folds-to-cbet":
      b.raise(HERO, 300).fold(4).raise(5, 900).fold(0).fold(1).fold(2).call(HERO);
      b.flop().check(HERO).bet(5, 900).fold(HERO);
      return b.award(5).build();

    case "hero-calls-cbet":
      b.raise(HERO, 300).fold(4).raise(5, 900).fold(0).fold(1).fold(2).call(HERO);
      b.flop().check(HERO).bet(5, 900).call(HERO);
      b.turn().check(HERO).check(5).river().check(HERO).check(5);
      return b.showdown(HERO, 5).award(HERO).build();

    case "hero-showdown-win":
      b.raise(HERO, 300).fold(4).fold(5).fold(0).fold(1).call(2);
      b.flop().check(2).check(HERO).turn().check(2).check(HERO).river().check(2).check(HERO);
      return b.showdown(2, HERO).award(HERO).build();

    case "hero-showdown-loss":
      // The blind leads every street and hero calls all three down.
      b.raise(HERO, 300).fold(4).fold(5).fold(0).fold(1).call(2);
      b.flop().bet(2, 200).call(HERO);
      b.turn().bet(2, 400).call(HERO);
      b.river().bet(2, 800).call(HERO);
      return b.showdown(2, HERO).award(2).build();
  }
}

/** `count` hands of each shape, interleaved so hand numbers stay unique. */
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

// ---------------------------------------------------------------------------

describe("aggregateStats", () => {
  it("counts VPIP and PFR against hands dealt", () => {
    const records = corpus([
      ["hero-opens-utg", 30],
      ["hero-folds-utg", 70],
    ]);
    const agg = aggregateStats(records, HERO);
    expect(agg.hands).toBe(100);
    expect(statValue(agg, "vpip")).toBeCloseTo(30, 6);
    expect(statValue(agg, "pfr")).toBeCloseTo(30, 6);
    expect(statValue(agg, "vpipPfrGap")).toBeCloseTo(0, 6);
  });

  it("separates limping from raising in the VPIP−PFR gap", () => {
    const agg = aggregateStats(
      corpus([
        ["hero-limps-utg", 20],
        ["hero-opens-utg", 10],
        ["hero-folds-utg", 70],
      ]),
      HERO,
    );
    expect(statValue(agg, "vpip")).toBeCloseTo(30, 6);
    expect(statValue(agg, "pfr")).toBeCloseTo(10, 6);
    expect(statValue(agg, "vpipPfrGap")).toBeCloseTo(20, 6);
    expect(statValue(agg, "openLimp")).toBeCloseTo(20, 6);
  });

  it("counts fold-to-3-bet only when hero opened and got re-raised", () => {
    const agg = aggregateStats(
      corpus([
        ["hero-folds-to-3bet", 7],
        ["hero-calls-3bet", 3],
        ["hero-opens-utg", 50],
      ]),
      HERO,
    );
    expect(statValue(agg, "foldToThreeBet")).toBeCloseTo(70, 6);
  });

  it("counts flop c-bets only when hero was the preflop aggressor", () => {
    const agg = aggregateStats(
      corpus([
        ["hero-cbets-flop", 9],
        ["hero-checks-flop", 1],
        ["hero-folds-to-cbet", 20], // hero is not the aggressor: no opportunity
      ]),
      HERO,
    );
    expect(statValue(agg, "cbetFlop")).toBeCloseTo(90, 6);
    expect(statValue(agg, "foldToCbetFlop")).toBeCloseTo(100, 6);
  });

  it("counts turn barrels only after a flop c-bet", () => {
    const agg = aggregateStats(
      corpus([
        ["hero-cbets-then-barrels", 3],
        ["hero-cbets-then-gives-up", 7],
        ["hero-checks-flop", 20],
      ]),
      HERO,
    );
    expect(statValue(agg, "turnBarrel")).toBeCloseTo(30, 6);
  });

  it("counts showdown stats against flops seen", () => {
    const agg = aggregateStats(
      corpus([
        ["hero-showdown-win", 4],
        ["hero-showdown-loss", 4],
        ["hero-cbets-flop", 2],
      ]),
      HERO,
    );
    expect(agg.flopsSeen).toBe(10);
    expect(statValue(agg, "wtsd")).toBeCloseTo(80, 6);
    expect(statValue(agg, "wsd")).toBeCloseTo(50, 6);
    // Hero wins the pot in the 4 showdown wins and the 2 c-bet takedowns.
    expect(statValue(agg, "wwsf")).toBeCloseTo(60, 6);
  });

  it("computes aggression factor as bets+raises over calls", () => {
    const agg = aggregateStats(corpus([["hero-showdown-loss", 10]]), HERO);
    // Three postflop calls per hand, no aggression.
    expect(statValue(agg, "af")).toBeCloseTo(0, 6);
    const aggro = aggregateStats(corpus([["hero-cbets-then-barrels", 10]]), HERO);
    // Two bets per hand and no calls at all: a ratio with a zero denominator
    // is not a number, and reporting one would be a fiction.
    expect(aggro.counters.af).toEqual({ n: 20, d: 0 });
    expect(statValue(aggro, "af")).toBeUndefined();
  });

  it("accumulates example hand ids as evidence, capped", () => {
    const agg = aggregateStats(corpus([["hero-limps-utg", 30]]), HERO);
    expect(agg.evidence.openLimp.length).toBe(8);
    expect(agg.evidence.openLimp[0]).toBe("hero-limps-utg-1");
    expect(agg.evidence.pfr).toHaveLength(0);
  });

  it("skips records where hero was not dealt in", () => {
    const records = corpus([["hero-opens-utg", 5]]);
    expect(aggregateStats(records, 99).hands).toBe(0);
  });

  it("returns undefined rather than zero for a stat with no opportunity", () => {
    const agg = aggregateStats(corpus([["hero-folds-utg", 10]]), HERO);
    expect(statValue(agg, "cbetFlop")).toBeUndefined();
    expect(statValue(agg, "wtsd")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------

describe("leak detectors fire on corpora engineered to exhibit them", () => {
  it("loose-preflop: VPIP well above the healthy band", () => {
    const records = corpus([
      ["hero-opens-utg", 120],
      ["hero-folds-utg", 130],
    ]);
    const agg = aggregateStats(records, HERO);
    expect(statValue(agg, "vpip")).toBeCloseTo(48, 6);
    const finding = detectLeaks(agg).find((f) => f.detector.id === "loose-preflop");
    expect(finding).toBeDefined();
    expect(finding?.concept).toBe("hand-selection");
    expect(finding?.deviation).toBeCloseTo(16, 6);
    expect(finding?.costBb100).toBeGreaterThan(0);
    expect(finding?.evidenceHandIds.length).toBeGreaterThan(0);
    expect(finding?.drillHook).toContain("chart trainer");
  });

  it("tight-preflop: VPIP well below the healthy band", () => {
    const records = corpus([
      ["hero-opens-utg", 20],
      ["hero-folds-utg", 230],
    ]);
    expect(fired(records, "tight-preflop")).toBe(true);
    expect(fired(records, "loose-preflop")).toBe(false);
  });

  it("open-limping: limps above the taxonomy's effectively-zero band", () => {
    const records = corpus([
      ["hero-limps-utg", 40],
      ["hero-opens-utg", 30],
      ["hero-folds-utg", 180],
    ]);
    expect(fired(records, "open-limping")).toBe(true);
  });

  it("passive-preflop: a VPIP−PFR gap wider than six points", () => {
    const records = corpus([
      ["hero-limps-utg", 50],
      ["hero-opens-utg", 20],
      ["hero-folds-utg", 180],
    ]);
    expect(fired(records, "passive-preflop")).toBe(true);
  });

  it("over-folds-to-three-bet: folding over 60% of opens to a re-raise", () => {
    const records = corpus([
      ["hero-folds-to-3bet", 90],
      ["hero-calls-3bet", 10],
      ["hero-opens-utg", 450],
    ]);
    const agg = aggregateStats(records, HERO);
    expect(statValue(agg, "foldToThreeBet")).toBeCloseTo(90, 6);
    expect(fired(records, "over-folds-to-three-bet")).toBe(true);
  });

  it("auto-cbet: c-betting over 80% of flops as the aggressor", () => {
    const records = corpus([
      ["hero-cbets-flop", 95],
      ["hero-checks-flop", 5],
      ["hero-folds-utg", 700],
    ]);
    expect(fired(records, "auto-cbet")).toBe(true);
    expect(fired(records, "cbet-too-rare")).toBe(false);
  });

  it("cbet-too-rare: giving up the flop far too often", () => {
    const records = corpus([
      ["hero-cbets-flop", 20],
      ["hero-checks-flop", 80],
      ["hero-folds-utg", 700],
    ]);
    expect(fired(records, "cbet-too-rare")).toBe(true);
    expect(fired(records, "auto-cbet")).toBe(false);
  });

  it("over-folds-to-cbet: folding over 60% of flops to the aggressor's bet", () => {
    const records = corpus([
      ["hero-folds-to-cbet", 80],
      ["hero-calls-cbet", 20],
      ["hero-folds-utg", 700],
    ]);
    expect(fired(records, "over-folds-to-cbet")).toBe(true);
  });

  it("one-and-done: c-betting the flop then shutting down on the turn", () => {
    const records = corpus([
      ["hero-cbets-then-barrels", 10],
      ["hero-cbets-then-gives-up", 90],
      ["hero-folds-utg", 700],
    ]);
    expect(fired(records, "one-and-done")).toBe(true);
  });

  it("showdown-chasing: high WTSD only fires alongside a weak W$SD", () => {
    const chasing = corpus([
      ["hero-showdown-win", 200],
      ["hero-showdown-loss", 400],
      ["hero-cbets-flop", 400],
      ["hero-folds-utg", 1000],
    ]);
    const aggChasing = aggregateStats(chasing, HERO);
    expect(statValue(aggChasing, "wtsd")).toBeCloseTo(60, 6);
    expect(statValue(aggChasing, "wsd")).toBeCloseTo(33.333333, 4);
    expect(fired(chasing, "showdown-chasing")).toBe(true);

    // The same high WTSD with a healthy W$SD is not a leak — the corroborating
    // stat is what separates "plays a lot of showdowns" from "pays them off".
    const winning = corpus([
      ["hero-showdown-win", 500],
      ["hero-showdown-loss", 100],
      ["hero-cbets-flop", 400],
      ["hero-folds-utg", 1000],
    ]);
    expect(statValue(aggregateStats(winning, HERO), "wtsd")).toBeCloseTo(60, 6);
    expect(fired(winning, "showdown-chasing")).toBe(false);
  });

  it("passive-postflop: winning under 42% of the flops seen", () => {
    const records = corpus([
      ["hero-showdown-win", 200],
      ["hero-showdown-loss", 800],
      ["hero-folds-utg", 1200],
    ]);
    const agg = aggregateStats(records, HERO);
    expect(statValue(agg, "wwsf")).toBeCloseTo(20, 6);
    expect(fired(records, "passive-postflop")).toBe(true);
  });
});

// ---------------------------------------------------------------------------

describe("leak detectors stay silent on a healthy corpus", () => {
  /**
   * A 2000-hand corpus tuned to sit inside every band the detectors watch:
   * VPIP 25%, PFR 25%, no limps, c-bet 60%, turn barrel 50%, WTSD ~27%,
   * W$SD ~57%, WWSF ~46%.
   */
  function healthyCorpus(): HandRecord[] {
    return corpus([
      ["hero-opens-utg", 190], // pure preflop takedowns
      ["hero-cbets-flop", 108], // saw flop, won it
      ["hero-checks-flop", 42], // saw flop, checked, won at showdown
      ["hero-cbets-then-barrels", 30],
      ["hero-cbets-then-gives-up", 30],
      ["hero-showdown-win", 40],
      ["hero-showdown-loss", 60],
      ["hero-folds-to-3bet", 25],
      ["hero-calls-3bet", 25],
      ["hero-folds-utg", 1450],
    ]);
  }

  it("computes a healthy stat line", () => {
    const agg = aggregateStats(healthyCorpus(), HERO);
    expect(agg.hands).toBe(2000);
    const vpip = statValue(agg, "vpip") ?? 0;
    expect(vpip).toBeGreaterThanOrEqual(22);
    expect(vpip).toBeLessThanOrEqual(32);
    expect(statValue(agg, "vpipPfrGap")).toBeCloseTo(0, 6);
    expect(statValue(agg, "openLimp") ?? 0).toBeLessThan(2);
    const cbet = statValue(agg, "cbetFlop") ?? 0;
    expect(cbet).toBeGreaterThan(45);
    expect(cbet).toBeLessThan(80);
  });

  it("reports no leaks at all", () => {
    const leaks = detectLeaks(aggregateStats(healthyCorpus(), HERO));
    expect(leaks.map((l) => l.detector.id)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------

describe("minimum-sample gates", () => {
  it("does not fire below the family gate, however extreme the stat", () => {
    // 100% VPIP, but only 50 hands — under the 200-hand preflop gate.
    const records = corpus([["hero-opens-utg", 50]]);
    const agg = aggregateStats(records, HERO);
    expect(statValue(agg, "vpip")).toBe(100);
    expect(detectLeaks(agg)).toEqual([]);

    const gated = evaluateDetectors(agg).find((f) => f.detector.id === "loose-preflop");
    expect(gated?.gateMet).toBe(false);
    expect(gated?.fired).toBe(false);
    expect(gated?.minHands).toBe(MIN_SAMPLE_HANDS["preflop-frequency"]);
    expect(gated?.hands).toBe(50);
  });

  it("fires the moment the gate is met", () => {
    const under = aggregateStats(corpus([["hero-opens-utg", 199]]), HERO);
    const over = aggregateStats(corpus([["hero-opens-utg", 200]]), HERO);
    expect(detectLeaks(under).some((f) => f.detector.id === "loose-preflop")).toBe(false);
    expect(detectLeaks(over).some((f) => f.detector.id === "loose-preflop")).toBe(true);
  });

  it("gates showdown stats at the taxonomy's 2000 hands", () => {
    const records = corpus([
      ["hero-showdown-loss", 500],
      ["hero-folds-utg", 1000],
    ]);
    const agg = aggregateStats(records, HERO);
    expect(agg.hands).toBe(1500);
    expect(statValue(agg, "wwsf")).toBe(0);
    expect(detectLeaks(agg).some((f) => f.detector.id === "passive-postflop")).toBe(false);
    expect(minSampleHands("wwsf")).toBe(2000);
  });

  it("also requires a minimum number of opportunities", () => {
    const detector = LEAK_DETECTORS.find((d) => d.id === "over-folds-to-three-bet");
    expect(detector?.minOpportunities).toBeGreaterThan(0);
    // 500+ hands clears the family gate, but only 5 fold-to-3-bet spots occur.
    const records = corpus([
      ["hero-folds-to-3bet", 5],
      ["hero-folds-utg", 600],
    ]);
    const agg = aggregateStats(records, HERO);
    expect(statValue(agg, "foldToThreeBet")).toBe(100);
    expect(detectLeaks(agg).some((f) => f.detector.id === "over-folds-to-three-bet")).toBe(false);
  });
});

describe("leak report shape", () => {
  it("ranks findings by estimated cost, most expensive first", () => {
    const records = corpus([
      ["hero-limps-utg", 600],
      ["hero-opens-utg", 200],
      ["hero-folds-utg", 1400],
    ]);
    const leaks = detectLeaks(aggregateStats(records, HERO));
    expect(leaks.length).toBeGreaterThan(1);
    for (let i = 1; i < leaks.length; i++) {
      expect(leaks[i - 1]?.costBb100).toBeGreaterThanOrEqual(leaks[i]?.costBb100 ?? 0);
    }
  });

  it("caps the estimated cost", () => {
    const records = corpus([["hero-limps-utg", 400]]);
    for (const f of detectLeaks(aggregateStats(records, HERO))) {
      expect(f.costBb100).toBeLessThanOrEqual(f.detector.costCapBb100);
    }
  });

  it("keys every detector to a stat whose family gate it reports", () => {
    const agg = aggregateStats(corpus([["hero-opens-utg", 10]]), HERO);
    for (const f of evaluateDetectors(agg)) {
      expect(f.minHands).toBe(MIN_SAMPLE_HANDS[STATS[f.detector.stat].family]);
    }
  });

  it("ships between eight and twelve core detectors", () => {
    expect(LEAK_DETECTORS.length).toBeGreaterThanOrEqual(8);
    expect(LEAK_DETECTORS.length).toBeLessThanOrEqual(12);
  });
});

// ---------------------------------------------------------------------------
// Edge-case coverage: threshold boundaries, hand-count floors, and
// corroboration exoneration for the detectors the describe blocks above only
// exercise with wide margins. `offBy` in leaks.ts is a STRICT inequality
// (`by > 0`), so a value sitting exactly on the threshold must not fire and
// the very next value past it must — that contract is what these tests pin.
// ---------------------------------------------------------------------------

describe("leak detector threshold boundaries — strict inequality, not inclusive", () => {
  it("tight-preflop: 18% VPIP exactly does not fire; 17% does", () => {
    const atThreshold = corpus([
      ["hero-opens-utg", 180],
      ["hero-folds-utg", 820],
    ]);
    const justBelow = corpus([
      ["hero-opens-utg", 170],
      ["hero-folds-utg", 830],
    ]);
    expect(statValue(aggregateStats(atThreshold, HERO), "vpip")).toBe(18);
    expect(statValue(aggregateStats(justBelow, HERO), "vpip")).toBe(17);
    expect(fired(atThreshold, "tight-preflop")).toBe(false);
    expect(fired(justBelow, "tight-preflop")).toBe(true);
  });

  it("open-limping: 2% limps exactly does not fire; past it does", () => {
    const atThreshold = corpus([
      ["hero-limps-utg", 20],
      ["hero-folds-utg", 980],
    ]);
    const justAbove = corpus([
      ["hero-limps-utg", 21],
      ["hero-folds-utg", 979],
    ]);
    expect(statValue(aggregateStats(atThreshold, HERO), "openLimp")).toBeCloseTo(2, 6);
    expect(statValue(aggregateStats(justAbove, HERO), "openLimp")).toBeCloseTo(2.1, 6);
    expect(fired(atThreshold, "open-limping")).toBe(false);
    expect(fired(justAbove, "open-limping")).toBe(true);
  });

  it("one-and-done: 40% turn barrel exactly does not fire; 39% does", () => {
    const atThreshold = corpus([
      ["hero-cbets-then-barrels", 40],
      ["hero-cbets-then-gives-up", 60],
      ["hero-folds-utg", 700],
    ]);
    const justBelow = corpus([
      ["hero-cbets-then-barrels", 39],
      ["hero-cbets-then-gives-up", 61],
      ["hero-folds-utg", 700],
    ]);
    expect(statValue(aggregateStats(atThreshold, HERO), "turnBarrel")).toBe(40);
    expect(statValue(aggregateStats(justBelow, HERO), "turnBarrel")).toBe(39);
    expect(fired(atThreshold, "one-and-done")).toBe(false);
    expect(fired(justBelow, "one-and-done")).toBe(true);
  });
});

describe("leak detectors stay quiet up to each stat family's exact hand-count floor", () => {
  // The existing "minimum-sample gates" describe block above pins this for
  // the preflop-frequency family (200) via loose-preflop. These do the same
  // one-hand-either-side check for the other three families, holding the
  // stat's own value and opportunity count fixed so the family gate is the
  // only thing that moves.
  it("preflop-response (500): over-folds-to-three-bet", () => {
    const under = corpus([
      ["hero-folds-to-3bet", 90],
      ["hero-calls-3bet", 10],
      ["hero-opens-utg", 399],
    ]);
    const over = corpus([
      ["hero-folds-to-3bet", 90],
      ["hero-calls-3bet", 10],
      ["hero-opens-utg", 400],
    ]);
    expect(aggregateStats(under, HERO).hands).toBe(499);
    expect(aggregateStats(over, HERO).hands).toBe(500);
    expect(fired(under, "over-folds-to-three-bet")).toBe(false);
    expect(fired(over, "over-folds-to-three-bet")).toBe(true);
  });

  it("postflop-cbet (750): cbet-too-rare", () => {
    const under = corpus([
      ["hero-cbets-flop", 20],
      ["hero-checks-flop", 80],
      ["hero-folds-utg", 649],
    ]);
    const over = corpus([
      ["hero-cbets-flop", 20],
      ["hero-checks-flop", 80],
      ["hero-folds-utg", 650],
    ]);
    expect(aggregateStats(under, HERO).hands).toBe(749);
    expect(aggregateStats(over, HERO).hands).toBe(750);
    expect(fired(under, "cbet-too-rare")).toBe(false);
    expect(fired(over, "cbet-too-rare")).toBe(true);
  });

  it("showdown (2000): passive-postflop", () => {
    const under = corpus([
      ["hero-showdown-win", 200],
      ["hero-showdown-loss", 800],
      ["hero-folds-utg", 999],
    ]);
    const over = corpus([
      ["hero-showdown-win", 200],
      ["hero-showdown-loss", 800],
      ["hero-folds-utg", 1000],
    ]);
    expect(aggregateStats(under, HERO).hands).toBe(1999);
    expect(aggregateStats(over, HERO).hands).toBe(2000);
    expect(fired(under, "passive-postflop")).toBe(false);
    expect(fired(over, "passive-postflop")).toBe(true);
  });
});

describe("conflicting-evidence exoneration", () => {
  it("showdown-chasing: the corroborating W$SD stat exonerates right at its own 48% boundary", () => {
    // WTSD is a stable 50% (well past its 32% threshold) in both corpora —
    // only W$SD moves, straddling the corroborating stat's own threshold.
    const atBoundary = corpus([
      ["hero-showdown-win", 48],
      ["hero-showdown-loss", 52],
      ["hero-cbets-flop", 100],
      ["hero-folds-utg", 1800],
    ]);
    const justBelow = corpus([
      ["hero-showdown-win", 47],
      ["hero-showdown-loss", 53],
      ["hero-cbets-flop", 100],
      ["hero-folds-utg", 1800],
    ]);
    const aggAt = aggregateStats(atBoundary, HERO);
    const aggBelow = aggregateStats(justBelow, HERO);
    expect(statValue(aggAt, "wtsd")).toBeCloseTo(50, 6);
    expect(statValue(aggAt, "wsd")).toBe(48);
    expect(statValue(aggBelow, "wsd")).toBe(47);
    // At exactly 48, "W$SD below 48" does not hold: the corroboration fails
    // and the primary WTSD signal alone is not reported as a leak.
    expect(fired(atBoundary, "showdown-chasing")).toBe(false);
    // One point under, corroboration clears and the leak fires.
    expect(fired(justBelow, "showdown-chasing")).toBe(true);
  });
});

describe("grading determinism — aggregateStats and leak detection are pure", () => {
  it("produce identical output across repeated calls over the same records", () => {
    const records = corpus([
      ["hero-limps-utg", 600],
      ["hero-opens-utg", 200],
      ["hero-folds-utg", 1400],
    ]);
    const aggA = aggregateStats(records, HERO);
    const aggB = aggregateStats(records, HERO);
    expect(aggA).toEqual(aggB);
    expect(evaluateDetectors(aggA)).toEqual(evaluateDetectors(aggB));
    expect(detectLeaks(aggA)).toEqual(detectLeaks(aggregateStats(records, HERO)));
  });
});
