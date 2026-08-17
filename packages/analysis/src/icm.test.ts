import { NASH_HU, nashHuJamChartId } from "@poker/charts";
import { describe, expect, it } from "vitest";
import { MAX_ICM_PLAYERS, icmAllInEv, icmDiff, icmEquities, pushFoldCrossCheck } from "./icm";

describe("icmEquities — Malmuth-Harville", () => {
  it("matches the published 3-player worked example", () => {
    // The canonical textbook case: stacks 50/30/20 into a 50/30/20 ladder.
    // Hand-computed finish probabilities for the chip leader:
    //   P(1st) = 0.5
    //   P(2nd) = 0.3·(0.5/0.7) + 0.2·(0.5/0.8) = 0.3392857142857143
    //   P(3rd) = 1 − 0.5 − P(2nd)              = 0.1607142857142857
    // giving $38.392857…, and likewise $32.75 and $28.857142… for the others.
    const equities = icmEquities([5000, 3000, 2000], [50, 30, 20]);
    expect(equities[0]).toBeCloseTo(38.392857142857146, 10);
    expect(equities[1]).toBeCloseTo(32.75, 10);
    expect(equities[2]).toBeCloseTo(28.857142857142854, 10);
  });

  it("sums to the prize pool — every prize is awarded to somebody", () => {
    const cases: Array<{ stacks: number[]; payouts: number[] }> = [
      { stacks: [5000, 3000, 2000], payouts: [50, 30, 20] },
      { stacks: [1, 1, 1, 1], payouts: [100] },
      { stacks: [12_000, 8000, 6000, 3000, 1000], payouts: [5000, 3000, 2000] },
      { stacks: [100, 200, 300, 400, 500, 600, 700, 800, 900], payouts: [900, 540, 360, 200] },
    ];
    for (const { stacks, payouts } of cases) {
      const total = payouts.reduce((a, b) => a + b, 0);
      const sum = icmEquities(stacks, payouts).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(total, 8);
    }
  });

  it("is chip-proportional under a winner-take-all ladder", () => {
    // With one prize there is no ladder to be concave, so ICM degenerates to
    // chip equity — the sanity check that the model has no built-in bias.
    const stacks = [4000, 3000, 2000, 1000];
    const equities = icmEquities(stacks, [100]);
    const totalChips = stacks.reduce((a, b) => a + b, 0);
    stacks.forEach((s, i) => {
      expect(equities[i]).toBeCloseTo((s / totalChips) * 100, 8);
    });
  });

  it("pays everyone the same when every place pays the same", () => {
    const equities = icmEquities([4000, 3000, 2000, 1000], [25, 25, 25, 25]);
    for (const v of equities) expect(v).toBeCloseTo(25, 8);
  });

  it("orders equity by stack and is concave in chips", () => {
    const stacks = [6000, 3000, 1000];
    const payouts = [50, 30, 20];
    const eq = icmEquities(stacks, payouts);
    expect(eq[0]).toBeGreaterThan(eq[1] as number);
    expect(eq[1]).toBeGreaterThan(eq[2] as number);
    // The leader holds 60% of the chips but well under 60% of the money.
    const total = payouts.reduce((a, b) => a + b, 0);
    expect((eq[0] as number) / total).toBeLessThan(0.6);
  });

  it("gives equal stacks equal equity", () => {
    const eq = icmEquities([1000, 1000, 1000, 1000], [50, 30, 20]);
    for (const v of eq) expect(v).toBeCloseTo(25, 8);
  });

  it("ignores places beyond the payout ladder", () => {
    const bubble = icmEquities([5000, 3000, 2000], [100]);
    expect(bubble[0]).toBeCloseTo(50, 8);
    expect(bubble[1]).toBeCloseTo(30, 8);
    expect(bubble[2]).toBeCloseTo(20, 8);
  });

  it("rejects malformed input", () => {
    expect(() => icmEquities([1000], [100])).toThrow(RangeError);
    expect(() => icmEquities([1000, 0], [100])).toThrow(RangeError);
    expect(() => icmEquities([1000, 1000], [100, 50, 25])).toThrow(RangeError);
    expect(() => icmEquities([1000, 1000], [])).toThrow(RangeError);
    expect(() => icmEquities(new Array<number>(MAX_ICM_PLAYERS + 1).fill(100), [100])).toThrow(
      RangeError,
    );
  });
});

describe("icmDiff", () => {
  it("prices chips won below chips lost — the concavity that IS ICM", () => {
    const payouts = [50, 30, 20];
    const before = [3000, 3000, 3000, 1000];
    const gain = icmDiff(before, [4000, 2000, 3000, 1000], payouts, 0);
    const loss = -icmDiff(before, [2000, 4000, 3000, 1000], payouts, 0);
    expect(gain).toBeGreaterThan(0);
    expect(loss).toBeGreaterThan(0);
    expect(gain).toBeLessThan(loss);
  });

  it("is zero when nothing moves", () => {
    const stacks = [3000, 3000, 3000];
    expect(icmDiff(stacks, stacks, [50, 30, 20], 1)).toBeCloseTo(0, 10);
  });
});

describe("icmAllInEv", () => {
  const payouts = [50, 30, 20];

  // Hero flips 2000 chips with an equal stack while a short stack sits out —
  // exactly chip-neutral, so anything ICM adds is pure risk premium.
  const bubbleFlip = {
    hero: 0,
    stacksIfFold: [4000, 4000, 1000],
    stacksIfWin: [6000, 2000, 1000],
    stacksIfLose: [2000, 6000, 1000],
  };

  it("reports a positive risk premium on the bubble", () => {
    const result = icmAllInEv({ ...bubbleFlip, payouts, equity: 0.5 });
    expect(result.chipBreakEvenEquity).toBeCloseTo(0.5, 10);
    expect(result.breakEvenEquity).toBeGreaterThan(0.5);
    expect(result.riskPremium).toBeGreaterThan(0);
    // A coin flip is a money loss even though it is chip-neutral.
    expect(result.diff).toBeLessThan(0);
  });

  it("has no risk premium under a winner-take-all ladder", () => {
    const result = icmAllInEv({ ...bubbleFlip, payouts: [100], equity: 0.5 });
    expect(result.riskPremium).toBeCloseTo(0, 10);
    expect(result.diff).toBeCloseTo(0, 10);
  });

  it("turns positive once equity clears the money threshold", () => {
    const marginal = icmAllInEv({ ...bubbleFlip, payouts, equity: 0.5 });
    const clear = icmAllInEv({
      ...bubbleFlip,
      payouts,
      equity: Math.min(1, marginal.breakEvenEquity + 0.1),
    });
    expect(clear.diff).toBeGreaterThan(0);
  });

  it("rejects an out-of-range equity", () => {
    expect(() =>
      icmAllInEv({
        payouts,
        hero: 0,
        stacksIfFold: [1000, 1000],
        stacksIfWin: [2000, 1],
        stacksIfLose: [1, 2000],
        equity: 1.5,
      }),
    ).toThrow(RangeError);
  });
});

describe("pushFoldCrossCheck", () => {
  it("agrees with the shipped Nash chart on a clear jam", () => {
    const check = pushFoldCrossCheck({ depthBb: 10, hand: "AA", taken: "jam" });
    expect(check.chartId).toBe(nashHuJamChartId(10));
    expect(check.chartSetVersion).toBe(NASH_HU.version);
    expect(check.jamWeight).toBe(100);
    expect(check.chartAction).toBe("jam");
    expect(check.verdict).toBe("agrees");
  });

  it("flags a fold of a clear jam as divergent", () => {
    const check = pushFoldCrossCheck({ depthBb: 10, hand: "AA", taken: "fold" });
    expect(check.verdict).toBe("diverges");
  });

  it("agrees with a fold of a hand the chart never jams", () => {
    const check = pushFoldCrossCheck({ depthBb: 10, hand: "32o", taken: "fold" });
    expect(check.jamWeight).toBe(0);
    expect(check.chartAction).toBe("fold");
    expect(check.verdict).toBe("agrees");
  });

  it("raises the jam threshold under ICM pressure", () => {
    const noPressure = pushFoldCrossCheck({ depthBb: 10, hand: "AA", taken: "jam" });
    const pressured = pushFoldCrossCheck({
      depthBb: 10,
      hand: "AA",
      taken: "jam",
      riskPremium: 0.2,
    });
    expect(pressured.requiredWeight).toBeGreaterThan(noPressure.requiredWeight);
    expect(pressured.note).toContain("not an ICM-Nash solve");
    // A hand the chart jams at 100% survives a 20% risk premium.
    expect(pressured.verdict).toBe("agrees");
  });

  it("says so when the chart is missing rather than guessing", () => {
    const check = pushFoldCrossCheck({
      depthBb: 10,
      hand: "AA",
      taken: "jam",
      chartId: "no-such-chart",
    });
    expect(check.verdict).toBe("no-chart");
    expect(check.chartAction).toBe("unknown");
    expect(check.jamWeight).toBeUndefined();
  });
});
