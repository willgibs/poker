import { describe, expect, it } from "vitest";
import { HAND169_COUNT, label169 } from "@poker/core";
import { DEFAULT_PREFLOP_RANKING } from "./ranking";
import { assertRanking } from "./distort";

describe("DEFAULT_PREFLOP_RANKING", () => {
  it("is a permutation of all 169 class indices", () => {
    expect(DEFAULT_PREFLOP_RANKING.length).toBe(HAND169_COUNT);
    expect(() => assertRanking(DEFAULT_PREFLOP_RANKING)).not.toThrow();
  });

  it("anchors the well-known strong and weak ends", () => {
    const labels = Array.from(DEFAULT_PREFLOP_RANKING, (c) => label169(c));
    // Big pairs dominate all-in equity vs random — exact and uncontroversial.
    expect(labels.slice(0, 7)).toEqual(["AA", "KK", "QQ", "JJ", "TT", "99", "88"]);
    expect(labels[7]).toBe("AKs");
    // The bottom is the low disconnected offsuit junk.
    expect(labels[HAND169_COUNT - 1]).toBe("32o");
    const bottomTen = new Set(labels.slice(-10));
    for (const junk of ["32o", "42o", "52o", "62o", "72o"]) {
      expect(bottomTen.has(junk)).toBe(true);
    }
  });

  it("ranks every pair above the same-high-card offsuit hand", () => {
    // Sanity: e.g. TT before T9o, 55 before 54o.
    const pos = new Map<string, number>();
    DEFAULT_PREFLOP_RANKING.forEach((cls, p) => pos.set(label169(cls), p));
    expect(pos.get("TT")!).toBeLessThan(pos.get("T9o")!);
    expect(pos.get("55")!).toBeLessThan(pos.get("54o")!);
    expect(pos.get("AA")!).toBeLessThan(pos.get("AKs")!);
    expect(pos.get("AKs")!).toBeLessThan(pos.get("AKo")!); // suited beats offsuit
    expect(pos.get("76s")!).toBeLessThan(pos.get("76o")!);
  });
});
