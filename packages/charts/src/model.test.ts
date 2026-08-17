import { describe, expect, it } from "vitest";
import { HAND169_COUNT, label169 } from "@poker/core";

import { actionWeights, getChart, type Chart, type ChartSet } from "./model";

function makeFixture(): ChartSet {
  const weightsA: number[] = new Array<number>(HAND169_COUNT).fill(0);
  weightsA[0] = 100; // AA
  weightsA[13] = 75; // AKs
  weightsA[168] = 1; // 32o
  const weightsB: number[] = new Array<number>(HAND169_COUNT).fill(50);
  const chartA: Chart = {
    id: "test-jam",
    format: "hu",
    positions: ["BTN"],
    depthBb: 10,
    node: "sb-jam",
    weights: weightsA,
  };
  const chartB: Chart = {
    id: "test-call",
    format: "hu",
    positions: ["BB"],
    depthBb: 10,
    node: "bb-call-vs-jam",
    weights: weightsB,
  };
  return { version: "test-v1", charts: [chartA, chartB] };
}

describe("getChart", () => {
  it("round-trips charts by id", () => {
    const set = makeFixture();
    expect(getChart(set, "test-jam")?.node).toBe("sb-jam");
    expect(getChart(set, "test-call")?.positions).toEqual(["BB"]);
  });

  it("returns undefined for an unknown id", () => {
    expect(getChart(makeFixture(), "nope")).toBeUndefined();
  });
});

describe("actionWeights", () => {
  it("reads weights by canonical index", () => {
    const set = makeFixture();
    expect(actionWeights(set, "test-jam", 0)).toBe(100);
    expect(actionWeights(set, "test-jam", 13)).toBe(75);
    expect(actionWeights(set, "test-jam", 168)).toBe(1);
    expect(actionWeights(set, "test-jam", 100)).toBe(0);
  });

  it("reads weights by canonical label", () => {
    const set = makeFixture();
    expect(actionWeights(set, "test-jam", "AA")).toBe(100);
    expect(actionWeights(set, "test-jam", "AKs")).toBe(75);
    expect(actionWeights(set, "test-jam", "32o")).toBe(1);
    expect(actionWeights(set, "test-call", "T9o")).toBe(50);
  });

  it("labels agree with indices for every hand", () => {
    const set = makeFixture();
    for (let h = 0; h < HAND169_COUNT; h++) {
      expect(actionWeights(set, "test-jam", label169(h))).toBe(
        actionWeights(set, "test-jam", h),
      );
    }
  });

  it("throws on an unknown chart id", () => {
    expect(() => actionWeights(makeFixture(), "nope", 0)).toThrow(RangeError);
  });

  it("throws on invalid hand indices", () => {
    const set = makeFixture();
    expect(() => actionWeights(set, "test-jam", -1)).toThrow(RangeError);
    expect(() => actionWeights(set, "test-jam", HAND169_COUNT)).toThrow(RangeError);
    expect(() => actionWeights(set, "test-jam", 1.5)).toThrow(RangeError);
  });

  it("throws on non-canonical labels", () => {
    const set = makeFixture();
    expect(() => actionWeights(set, "test-jam", "KAs")).toThrow(RangeError);
    expect(() => actionWeights(set, "test-jam", "AK")).toThrow(RangeError);
    expect(() => actionWeights(set, "test-jam", "aks")).toThrow(RangeError);
    expect(() => actionWeights(set, "test-jam", "")).toThrow(RangeError);
  });
});
