import { describe, expect, it } from "vitest";
import { HAND169_COUNT, combosOf169, label169 } from "@poker/core";

import { actionWeights, getChart } from "./model";
import { NASH_HU, nashHuCallChartId, nashHuJamChartId } from "./nashHU";
import { NASH_HU_DEPTHS_BB, NASH_HU_EPSILON_BB } from "./nashHU.gen";

/** Fraction of all 1326 combos a 169-weight chart plays (0..1). */
function rangeFraction(weights: readonly number[]): number {
  let acc = 0;
  for (let h = 0; h < HAND169_COUNT; h++) {
    acc += ((weights[h] ?? 0) / 100) * combosOf169(h).length;
  }
  return acc / 1326;
}

const DEPTHS = [...NASH_HU_DEPTHS_BB];
const PAIR_INDICES = Array.from({ length: 13 }, (_, i) => i); // AA..22
const ACE_HIGH_INDICES = [
  0, // AA
  ...Array.from({ length: 12 }, (_, i) => 13 + i), // AKs..A2s
  ...Array.from({ length: 12 }, (_, i) => 91 + i), // AKo..A2o
];

describe("NASH_HU structure", () => {
  it("covers depths 2..15bb with a jam and a call chart each", () => {
    expect(DEPTHS).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    expect(NASH_HU.charts.length).toBe(DEPTHS.length * 2);
    for (const d of DEPTHS) {
      const jam = getChart(NASH_HU, nashHuJamChartId(d));
      const call = getChart(NASH_HU, nashHuCallChartId(d));
      expect(jam).toBeDefined();
      expect(call).toBeDefined();
      expect(jam?.depthBb).toBe(d);
      expect(call?.depthBb).toBe(d);
      expect(jam?.node).toBe("sb-jam");
      expect(call?.node).toBe("bb-call-vs-jam");
      expect(jam?.positions).toEqual(["BTN"]);
      expect(call?.positions).toEqual(["BB"]);
      expect(jam?.format).toBe("hu");
    }
  });

  it("has a version stamp", () => {
    expect(NASH_HU.version.length).toBeGreaterThan(0);
  });

  it("every chart has 169 integer weights bounded 0-100", () => {
    for (const chart of NASH_HU.charts) {
      expect(chart.weights.length).toBe(HAND169_COUNT);
      for (const w of chart.weights) {
        expect(Number.isInteger(w)).toBe(true);
        expect(w).toBeGreaterThanOrEqual(0);
        expect(w).toBeLessThanOrEqual(100);
      }
    }
  });

  it("recorded solver exploitability is below 0.001 bb at every depth", () => {
    expect(NASH_HU_EPSILON_BB.length).toBe(DEPTHS.length);
    for (const eps of NASH_HU_EPSILON_BB) {
      expect(eps).toBeGreaterThanOrEqual(0);
      expect(eps).toBeLessThan(0.001);
    }
  });

  it("accessor round-trips the generated data", () => {
    const jam10 = getChart(NASH_HU, nashHuJamChartId(10));
    expect(jam10).toBeDefined();
    expect(actionWeights(NASH_HU, nashHuJamChartId(10), "AA")).toBe(jam10?.weights[0]);
    expect(actionWeights(NASH_HU, nashHuJamChartId(10), 168)).toBe(jam10?.weights[168]);
    expect(actionWeights(NASH_HU, nashHuCallChartId(15), "AKs")).toBe(
      getChart(NASH_HU, nashHuCallChartId(15))?.weights[13],
    );
  });
});

describe("NASH_HU poker anchors", () => {
  it("any pair jams at 10bb and below", () => {
    for (const d of DEPTHS.filter((x) => x <= 10)) {
      for (const h of PAIR_INDICES) {
        const w = actionWeights(NASH_HU, nashHuJamChartId(d), h);
        expect(w, `${label169(h)} at ${d}bb`).toBeGreaterThanOrEqual(90);
      }
    }
  });

  it("any ace always jams at 5bb and below", () => {
    for (const d of DEPTHS.filter((x) => x <= 5)) {
      for (const h of ACE_HIGH_INDICES) {
        const w = actionWeights(NASH_HU, nashHuJamChartId(d), h);
        expect(w, `${label169(h)} at ${d}bb`).toBeGreaterThanOrEqual(95);
      }
    }
  });

  it("32o folds at 15bb", () => {
    expect(actionWeights(NASH_HU, nashHuJamChartId(15), "32o")).toBeLessThanOrEqual(5);
  });

  it("BB always calls with AA", () => {
    for (const d of DEPTHS) {
      expect(actionWeights(NASH_HU, nashHuCallChartId(d), "AA")).toBeGreaterThanOrEqual(99);
    }
  });

  it("call ranges are tighter than jam ranges at 5bb+ depths", () => {
    // At very short depths this anchor is theoretically FALSE: the BB needs
    // only (D-1)/(2D) equity to call (25% at 2bb), so the equilibrium call
    // range is as wide as or wider than the jam range (any-two at 2bb).
    // Tightness of the call range only kicks in once calling costs enough.
    for (const d of DEPTHS.filter((x) => x >= 5)) {
      const jam = getChart(NASH_HU, nashHuJamChartId(d));
      const call = getChart(NASH_HU, nashHuCallChartId(d));
      expect(jam).toBeDefined();
      expect(call).toBeDefined();
      if (jam === undefined || call === undefined) continue;
      expect(rangeFraction(call.weights), `depth ${d}bb`).toBeLessThan(
        rangeFraction(jam.weights),
      );
    }
  });

  it("jam ranges are monotone-ish in depth (shorter stacks jam wider)", () => {
    const fractions = DEPTHS.map((d) => {
      const jam = getChart(NASH_HU, nashHuJamChartId(d));
      return jam === undefined ? 0 : rangeFraction(jam.weights);
    });
    for (let k = 1; k < fractions.length; k++) {
      // Each deeper stack may not jam meaningfully wider than the shorter one.
      expect(
        (fractions[k] ?? 0) - (fractions[k - 1] ?? 1),
        `depth ${DEPTHS[k]}bb vs ${DEPTHS[k - 1]}bb`,
      ).toBeLessThanOrEqual(0.005);
    }
    // And across the whole span the range must shrink substantially.
    expect(fractions[fractions.length - 1] ?? 1).toBeLessThan((fractions[0] ?? 0) - 0.1);
  });

  it("call ranges are monotone-ish in depth as well", () => {
    const fractions = DEPTHS.map((d) => {
      const call = getChart(NASH_HU, nashHuCallChartId(d));
      return call === undefined ? 0 : rangeFraction(call.weights);
    });
    for (let k = 1; k < fractions.length; k++) {
      expect(
        (fractions[k] ?? 0) - (fractions[k - 1] ?? 1),
        `depth ${DEPTHS[k]}bb vs ${DEPTHS[k - 1]}bb`,
      ).toBeLessThanOrEqual(0.005);
    }
  });
});
