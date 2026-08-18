/**
 * Symmetry: chart weights are indexed by the documented 169-class contract
 * (model.ts's header: pairs 0-12, suited 13-90, offsuit 91-168) and are
 * meant to compose with the per-class combo counts (6 pair / 4 suited /
 * 12 offsuit combos) to describe a real fraction of the 1326-combo deck.
 * These tests pin that composition, both structurally (the segment
 * boundaries carry the combo counts they're documented to) and against a
 * real production chart, so a boundary slip in either package would show
 * up as a wrong combo total rather than only as a wrong single weight.
 */
import { describe, expect, it } from "vitest";
import { COMBO_COUNT, HAND169_COUNT, combosOf169 } from "@poker/core";

import { getChart } from "./model";
import { NASH_HU, nashHuJamChartId } from "./nashHU";

/** Combo-weighted total (0-1326) a 169-length weights array covers. */
function comboWeightedTotal(weights: readonly number[]): number {
  let acc = 0;
  for (let h = 0; h < HAND169_COUNT; h++) {
    acc += ((weights[h] ?? 0) / 100) * combosOf169(h).length;
  }
  return acc;
}

describe("chart weight indexing composes correctly with the 169-class combo partition", () => {
  it("the three documented index segments carry exactly 78/312/936 of the 1326 combos", () => {
    let pairCombos = 0;
    let suitedCombos = 0;
    let offsuitCombos = 0;
    for (let h = 0; h < 13; h++) pairCombos += combosOf169(h).length;
    for (let h = 13; h < 91; h++) suitedCombos += combosOf169(h).length;
    for (let h = 91; h < HAND169_COUNT; h++) offsuitCombos += combosOf169(h).length;
    expect(pairCombos).toBe(13 * 6);
    expect(suitedCombos).toBe(78 * 4);
    expect(offsuitCombos).toBe(78 * 12);
    expect(pairCombos + suitedCombos + offsuitCombos).toBe(COMBO_COUNT);
  });

  it("a chart that plays every class at weight 100 covers all 1326 combos; one that never plays covers zero", () => {
    const allIn = new Array<number>(HAND169_COUNT).fill(100);
    const allOut = new Array<number>(HAND169_COUNT).fill(0);
    expect(comboWeightedTotal(allIn)).toBe(COMBO_COUNT);
    expect(comboWeightedTotal(allOut)).toBe(0);
  });

  it("playing exactly the 13 pair classes at 100 covers exactly the 78 pair combos", () => {
    const pairsOnly = new Array<number>(HAND169_COUNT).fill(0);
    for (let h = 0; h < 13; h++) pairsOnly[h] = 100;
    expect(comboWeightedTotal(pairsOnly)).toBe(78);
  });

  it("the shipped 2bb SB jam chart covers exactly 1198 of 1326 combos (matches its pinned 12-hand fold list)", () => {
    // 12 folded classes at 2bb: 2 suited (4 combos each = 8) + 10 offsuit
    // (12 combos each = 120) = 128 excluded combos; 1326 - 128 = 1198.
    // See nash-known-vectors.test.ts for the pinned fold list and its
    // EV-threshold derivation.
    const jam2 = getChart(NASH_HU, nashHuJamChartId(2));
    expect(jam2).toBeDefined();
    if (jam2 === undefined) return;
    expect(comboWeightedTotal(jam2.weights)).toBe(1198);
  });
});
