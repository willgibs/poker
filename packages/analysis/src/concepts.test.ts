import { describe, expect, it } from "vitest";
import {
  ALL_CONCEPTS,
  CONCEPTS,
  CONCEPT_IDS,
  CONCEPT_TIERS,
  MIN_SAMPLE_HANDS,
  STATS,
  STAT_IDS,
  conceptsByTier,
  conceptsForStat,
  isConceptId,
  isStatId,
  minSampleHands,
} from "./concepts";
import { LEAK_DETECTORS } from "./leaks";

describe("concept taxonomy data", () => {
  it("carries exactly the 26 taxonomy ids, with no duplicates", () => {
    expect(CONCEPT_IDS).toHaveLength(26);
    expect(new Set(CONCEPT_IDS).size).toBe(26);
  });

  it("transcribes the taxonomy index verbatim, in order", () => {
    expect([...CONCEPT_IDS]).toEqual([
      "hand-selection",
      "position",
      "pot-odds",
      "value-betting",
      "folding-discipline",
      "cbet-basics",
      "open-vs-limp",
      "stack-awareness",
      "3bet-defense",
      "3betting",
      "cbet-sizing",
      "double-barreling",
      "bluff-catching",
      "semibluffing",
      "blind-defense",
      "iso-raising",
      "thin-value",
      "pot-control",
      "blockers",
      "polarization",
      "overbetting",
      "exploiting-tendencies",
      "multiway-adjustments",
      "balance",
      "icm-pressure",
      "push-fold",
    ]);
  });

  it("splits into the taxonomy's tier sections (8 / 10 / 8)", () => {
    expect(conceptsByTier("foundations")).toHaveLength(8);
    expect(conceptsByTier("intermediate")).toHaveLength(10);
    expect(conceptsByTier("advanced")).toHaveLength(8);
    expect(CONCEPT_TIERS).toEqual(["foundations", "intermediate", "advanced"]);
  });

  it("keys every concept under its own id and gives each a name and drill hook", () => {
    for (const id of CONCEPT_IDS) {
      const concept = CONCEPTS[id];
      expect(concept.id).toBe(id);
      expect(concept.name.length).toBeGreaterThan(0);
      expect(concept.drillHook.length).toBeGreaterThan(0);
      expect(CONCEPT_TIERS).toContain(concept.tier);
    }
    expect(ALL_CONCEPTS).toHaveLength(26);
  });

  it("gives every concept either tracker stats or an explicit graded-only mark", () => {
    for (const concept of ALL_CONCEPTS) {
      if (concept.gradedOnly) {
        expect(concept.stats).toHaveLength(0);
      } else {
        expect(concept.stats.length).toBeGreaterThan(0);
      }
    }
    // The taxonomy names no tracker stat for exactly these concepts.
    const gradedOnly = ALL_CONCEPTS.filter((c) => c.gradedOnly).map((c) => c.id);
    expect(gradedOnly).toEqual([
      "stack-awareness",
      "cbet-sizing",
      "blockers",
      "overbetting",
      "exploiting-tendencies",
      "balance",
      "icm-pressure",
      "push-fold",
    ]);
  });

  it("links only to stats that exist, with a note on every link", () => {
    for (const concept of ALL_CONCEPTS) {
      for (const link of concept.stats) {
        expect(isStatId(link.stat)).toBe(true);
        expect(STATS[link.stat].id).toBe(link.stat);
        expect(link.note.length).toBeGreaterThan(0);
      }
      // At most one link per stat per concept.
      const seen = concept.stats.map((l) => l.stat);
      expect(new Set(seen).size).toBe(seen.length);
    }
  });

  it("puts every tracked stat in a gated family", () => {
    for (const id of STAT_IDS) {
      const spec = STATS[id];
      expect(spec.id).toBe(id);
      expect(MIN_SAMPLE_HANDS[spec.family]).toBeGreaterThan(0);
      expect(minSampleHands(id)).toBe(MIN_SAMPLE_HANDS[spec.family]);
    }
  });

  it("uses the taxonomy's minimum-sample table", () => {
    expect(MIN_SAMPLE_HANDS).toEqual({
      "preflop-frequency": 200,
      "preflop-response": 500,
      "postflop-cbet": 750,
      showdown: 2000,
    });
    expect(minSampleHands("vpip")).toBe(200);
    expect(minSampleHands("threeBet")).toBe(500);
    expect(minSampleHands("cbetFlop")).toBe(750);
    expect(minSampleHands("wtsd")).toBe(2000);
  });

  it("labels every healthy band with its source, and orders low below high", () => {
    for (const id of STAT_IDS) {
      const band = STATS[id].healthy;
      if (band === undefined) continue;
      expect(["taxonomy", "house"]).toContain(band.source);
      if (band.low !== undefined && band.high !== undefined) {
        expect(band.low).toBeLessThan(band.high);
      }
    }
  });

  it("keeps the taxonomy's printed bands intact", () => {
    expect(STATS.vpip.healthy).toEqual({ low: 22, high: 28, source: "taxonomy" });
    expect(STATS.threeBet.healthy).toEqual({ low: 6, high: 9, source: "taxonomy" });
    expect(STATS.foldToThreeBet.healthy).toEqual({ low: 45, high: 55, source: "taxonomy" });
    expect(STATS.cbetFlop.healthy).toEqual({ low: 55, high: 70, source: "taxonomy" });
    expect(STATS.wtsd.healthy).toEqual({ low: 24, high: 30, source: "taxonomy" });
    expect(STATS.wwsf.healthy).toEqual({ low: 42, high: 48, source: "taxonomy" });
    expect(STATS.openLimp.healthy).toEqual({ high: 2, source: "taxonomy" });
  });

  it("reverse-maps stats to the concepts they evidence", () => {
    expect(conceptsForStat("vpip").map((c) => c.id)).toEqual(["hand-selection", "position"]);
    expect(conceptsForStat("cbetFlop").map((c) => c.id)).toEqual(["cbet-basics"]);
    // Every non-graded-only concept is reachable from at least one stat.
    const reachable = new Set(STAT_IDS.flatMap((s) => conceptsForStat(s).map((c) => c.id)));
    for (const concept of ALL_CONCEPTS) {
      if (!concept.gradedOnly) expect(reachable.has(concept.id)).toBe(true);
    }
  });

  it("guards its id predicates", () => {
    expect(isConceptId("push-fold")).toBe(true);
    expect(isConceptId("pushfold")).toBe(false);
    expect(isStatId("wsd")).toBe(true);
    expect(isStatId("nope")).toBe(false);
  });

  it("keys every leak detector to a real concept and a real stat", () => {
    for (const d of LEAK_DETECTORS) {
      expect(isConceptId(d.concept)).toBe(true);
      expect(isStatId(d.stat)).toBe(true);
      for (const c of d.corroborate ?? []) expect(isStatId(c.stat)).toBe(true);
    }
    expect(new Set(LEAK_DETECTORS.map((d) => d.id)).size).toBe(LEAK_DETECTORS.length);
  });
});
