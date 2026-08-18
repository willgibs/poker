/**
 * Nash push/fold known-vector pins.
 *
 * These pin specific hand-checkable numbers against the shipped NASH_HU
 * equilibrium data. Provenance: the repo generates this table entirely
 * in-repo (see packages/charts/README.md and tools/nash-pushfold/) — there
 * is no external chart to diff against, so every pin here is grounded
 * either in standard hold'em premium/trash intuition (AA always plays;
 * 72o/32o are the folklore-canonical worst starting hands) or in the EV
 * algebra documented at the top of tools/nash-pushfold/solve.ts:
 *   SB fold: -0.5bb.  SB jam + BB fold: +1bb.  SB jam + BB call: 2*D*eq - D.
 * A regression here means either the solver output changed on
 * regeneration or a real bug crept into the generated table — both worth
 * seeing explicitly rather than only through the aggregate fraction
 * checks in nashHU.test.ts.
 */
import { describe, expect, it } from "vitest";
import { HAND169_COUNT, label169 } from "@poker/core";

import { actionWeights, getChart } from "./model";
import { NASH_HU, nashHuCallChartId, nashHuJamChartId } from "./nashHU";
import { NASH_HU_DEPTHS_BB } from "./nashHU.gen";

const DEPTHS = [...NASH_HU_DEPTHS_BB];

const PREMIUM = ["AA", "KK", "QQ", "AKs", "AKo", "A2s", "A2o", "22", "JTs"];

describe("NASH_HU known-vector pins", () => {
  it("premium hands play every combo at every tabled depth: jam 100 and call 100, 2-15bb", () => {
    for (const d of DEPTHS) {
      for (const label of PREMIUM) {
        expect(actionWeights(NASH_HU, nashHuJamChartId(d), label), `jam ${label}@${d}bb`).toBe(100);
        expect(actionWeights(NASH_HU, nashHuCallChartId(d), label), `call ${label}@${d}bb`).toBe(100);
      }
    }
  });

  it("the two folklore-worst starting hands (72o, 32o) never jam, at any tabled depth", () => {
    for (const label of ["72o", "32o"]) {
      for (const d of DEPTHS) {
        expect(actionWeights(NASH_HU, nashHuJamChartId(d), label), `${label}@${d}bb`).toBe(0);
      }
    }
  });

  it("BB calls any two cards at 2bb, but the worst hands' call weight collapses to 0 by 3bb", () => {
    // Pot odds to call a 2bb jam are (D-1)/(2D) = 1/4 at D=2: even the
    // worst hand's raw equity vs a uniformly random hand clears 25%, so BB
    // calls literally everything at 2bb. One bb deeper the odds tighten
    // past what 72o/32o clear.
    for (const label of ["72o", "32o"]) {
      expect(actionWeights(NASH_HU, nashHuCallChartId(2), label), `${label}@2bb`).toBe(100);
      for (const d of DEPTHS.filter((x) => x >= 3)) {
        expect(actionWeights(NASH_HU, nashHuCallChartId(d), label), `${label}@${d}bb`).toBe(0);
      }
    }
  });

  it("BB's 2bb call chart plays literally every one of the 169 classes (any-two-calls)", () => {
    const call2 = getChart(NASH_HU, nashHuCallChartId(2));
    expect(call2).toBeDefined();
    for (let h = 0; h < HAND169_COUNT; h++) {
      expect(call2?.weights[h], label169(h)).toBe(100);
    }
  });

  it("SB's 2bb jam range folds exactly a pinned 12-hand list of trash, jams every other class", () => {
    // At 2bb, BB calls any two (previous test), so jamming must clear
    // equity 0.375 against a *random* hand to beat folding outright:
    // EV(jam) = 4*eq - 2 must exceed EV(fold) = -0.5 => eq > 0.375. Only
    // the worst disconnected low, unsuited (or near-unsuited) holdings
    // fall under that bar; every other class jams at 100.
    const FOLDS_AT_2BB = [
      "42s", "32s",
      "82o", "73o", "72o", "63o", "62o", "53o", "52o", "43o", "42o", "32o",
    ];
    const jam2 = getChart(NASH_HU, nashHuJamChartId(2));
    expect(jam2).toBeDefined();
    let foldCount = 0;
    let jamCount = 0;
    for (let h = 0; h < HAND169_COUNT; h++) {
      const label = label169(h);
      const w = jam2?.weights[h];
      if (FOLDS_AT_2BB.includes(label)) {
        expect(w, label).toBe(0);
        foldCount++;
      } else {
        expect(w, label).toBe(100);
        jamCount++;
      }
    }
    expect(foldCount).toBe(FOLDS_AT_2BB.length);
    expect(jamCount).toBe(HAND169_COUNT - FOLDS_AT_2BB.length);
  });

  it("exact playable-class counts at the deepest tabled depth (15bb), as concrete regression anchors", () => {
    // Complements the aggregate rangeFraction monotonicity property already
    // covered in nashHU.test.ts with an exact, hand-countable snapshot.
    const jam15 = getChart(NASH_HU, nashHuJamChartId(15));
    const call15 = getChart(NASH_HU, nashHuCallChartId(15));
    expect(jam15).toBeDefined();
    expect(call15).toBeDefined();
    const jamPlayable = (jam15?.weights ?? []).filter((w) => w > 0).length;
    const callPlayable = (call15?.weights ?? []).filter((w) => w > 0).length;
    expect(jamPlayable).toBe(94);
    expect(callPlayable).toBe(53);
  });
});
