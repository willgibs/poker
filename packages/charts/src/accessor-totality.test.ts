/**
 * Accessor totality: `actionWeights`/`getChart` must answer every position ×
 * every 169-hand class with a defined, in-range action weight — both for
 * arbitrary charts (property-based) and, exhaustively, for the real shipped
 * NASH_HU chart set (every depth's jam chart and call chart, all 169 classes,
 * addressed both by canonical index and by canonical label).
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { HAND169_COUNT, label169 } from "@poker/core";

import { actionWeights, getChart, type Chart, type ChartSet } from "./model";
import { NASH_HU, nashHuCallChartId, nashHuJamChartId } from "./nashHU";
import { NASH_HU_DEPTHS_BB } from "./nashHU.gen";

const FC_SEED = 20260818; // fixed seed: deterministic per repo testing rules

const weightsArb = fc.array(fc.integer({ min: 0, max: 100 }), {
  minLength: HAND169_COUNT,
  maxLength: HAND169_COUNT,
});

function chartFrom(id: string, weights: readonly number[]): Chart {
  return { id, format: "cash", positions: ["BTN"], depthBb: 100, node: "open", weights };
}

describe("actionWeights totality (property, arbitrary charts)", () => {
  it("agrees with the raw weights array at every one of the 169 canonical indices", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 12 }), weightsArb, (id, weights) => {
        const set: ChartSet = { version: "prop-v1", charts: [chartFrom(id, weights)] };
        for (let h = 0; h < HAND169_COUNT; h++) {
          expect(actionWeights(set, id, h)).toBe(weights[h]);
        }
      }),
      { seed: FC_SEED, numRuns: 50 },
    );
  });

  it("agrees whether a hand is addressed by index or by its canonical label", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1, maxLength: 12 }), weightsArb, (id, weights) => {
        const set: ChartSet = { version: "prop-v1", charts: [chartFrom(id, weights)] };
        for (let h = 0; h < HAND169_COUNT; h++) {
          expect(actionWeights(set, id, label169(h))).toBe(actionWeights(set, id, h));
        }
      }),
      { seed: FC_SEED, numRuns: 50 },
    );
  });

  it("never leaves a class undefined, across a multi-chart set", () => {
    fc.assert(
      fc.property(fc.array(weightsArb, { minLength: 1, maxLength: 5 }), (weightsList) => {
        const charts = weightsList.map((w, i) => chartFrom(`c${i}`, w));
        const set: ChartSet = { version: "prop-v1", charts };
        for (const c of charts) {
          for (let h = 0; h < HAND169_COUNT; h++) {
            expect(actionWeights(set, c.id, h)).not.toBeUndefined();
          }
        }
      }),
      { seed: FC_SEED, numRuns: 20 },
    );
  });
});

describe("NASH_HU accessor totality (exhaustive sweep over production data)", () => {
  it("every tabled depth resolves both a jam chart id and a call chart id", () => {
    expect(NASH_HU_DEPTHS_BB.length).toBeGreaterThan(0);
    for (const d of NASH_HU_DEPTHS_BB) {
      expect(getChart(NASH_HU, nashHuJamChartId(d)), `jam@${d}bb`).toBeDefined();
      expect(getChart(NASH_HU, nashHuCallChartId(d)), `call@${d}bb`).toBeDefined();
    }
  });

  it("every chart answers all 169 hand classes, by index and by label, in range and matching the raw array", () => {
    expect(NASH_HU.charts.length).toBe(NASH_HU_DEPTHS_BB.length * 2);
    for (const chart of NASH_HU.charts) {
      for (let h = 0; h < HAND169_COUNT; h++) {
        const label = label169(h);
        const byIndex = actionWeights(NASH_HU, chart.id, h);
        const byLabel = actionWeights(NASH_HU, chart.id, label);
        expect(byIndex, `${chart.id} ${label}`).toBe(chart.weights[h]);
        expect(byLabel, `${chart.id} ${label}`).toBe(byIndex);
        expect(Number.isInteger(byIndex), `${chart.id} ${label}`).toBe(true);
        expect(byIndex, `${chart.id} ${label}`).toBeGreaterThanOrEqual(0);
        expect(byIndex, `${chart.id} ${label}`).toBeLessThanOrEqual(100);
      }
    }
  });
});
