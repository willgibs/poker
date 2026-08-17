import { describe, expect, it } from "vitest";
import { cardFromString } from "./cards";
import {
  ALL_COMBOS,
  COMBO_COUNT,
  HAND169_COUNT,
  comboFromIndex,
  comboIndex,
  combosOf169,
  hand169,
  label169,
} from "./combos";

const c = cardFromString;

describe("combo <-> index bijection", () => {
  it("is a bijection over all 1326 combos", () => {
    expect(ALL_COMBOS).toHaveLength(COMBO_COUNT);
    const seen = new Set<number>();
    for (let i = 0; i < COMBO_COUNT; i++) {
      const [a, b] = comboFromIndex(i);
      expect(a).toBeLessThan(b);
      expect(comboIndex(a, b)).toBe(i);
      expect(comboIndex(b, a)).toBe(i); // order-insensitive
      expect(ALL_COMBOS[i]).toEqual([a, b]);
      seen.add(a * 52 + b);
    }
    expect(seen.size).toBe(COMBO_COUNT);
  });

  it("anchors the canonical order", () => {
    expect(comboFromIndex(0)).toEqual([0, 1]);
    expect(comboFromIndex(50)).toEqual([0, 51]);
    expect(comboFromIndex(51)).toEqual([1, 2]);
    expect(comboFromIndex(COMBO_COUNT - 1)).toEqual([50, 51]);
  });

  it("rejects invalid input", () => {
    expect(() => comboIndex(0, 0)).toThrow(RangeError);
    expect(() => comboIndex(-1, 5)).toThrow(RangeError);
    expect(() => comboIndex(0, 52)).toThrow(RangeError);
    expect(() => comboFromIndex(-1)).toThrow(RangeError);
    expect(() => comboFromIndex(COMBO_COUNT)).toThrow(RangeError);
    expect(() => comboFromIndex(0.5)).toThrow(RangeError);
  });
});

describe("hand169", () => {
  it("has 13 pairs, 78 suited, 78 offsuit in the canonical blocks", () => {
    let pairs = 0;
    let suited = 0;
    let offsuit = 0;
    let total = 0;
    for (let idx = 0; idx < HAND169_COUNT; idx++) {
      const combos = combosOf169(idx);
      total += combos.length;
      const label = label169(idx);
      if (combos.length === 6) {
        pairs++;
        expect(idx).toBeLessThan(13);
        expect(label).toMatch(/^([2-9TJQKA])\1$/);
      } else if (combos.length === 4) {
        suited++;
        expect(idx).toBeGreaterThanOrEqual(13);
        expect(idx).toBeLessThan(91);
        expect(label).toMatch(/^[2-9TJQKA]{2}s$/);
      } else if (combos.length === 12) {
        offsuit++;
        expect(idx).toBeGreaterThanOrEqual(91);
        expect(label).toMatch(/^[2-9TJQKA]{2}o$/);
      } else {
        throw new Error(`unexpected combo count ${combos.length} at index ${idx}`);
      }
    }
    expect(pairs).toBe(13);
    expect(suited).toBe(78);
    expect(offsuit).toBe(78);
    expect(total).toBe(COMBO_COUNT); // expansion covers all 1326 combos
  });

  it("expansion partitions the 1326 combos and round-trips through hand169", () => {
    const seen = new Set<number>();
    for (let idx = 0; idx < HAND169_COUNT; idx++) {
      for (const [a, b] of combosOf169(idx)) {
        expect(a).toBeLessThan(b);
        const h = hand169(a, b);
        expect(h.index).toBe(idx);
        expect(h.label).toBe(label169(idx));
        seen.add(comboIndex(a, b));
      }
    }
    expect(seen.size).toBe(COMBO_COUNT);
  });

  it("anchors the canonical 169 ordering and labels", () => {
    expect(hand169(c("As"), c("Ah"))).toEqual({ index: 0, label: "AA" });
    expect(hand169(c("Kd"), c("Kc"))).toEqual({ index: 1, label: "KK" });
    expect(hand169(c("2c"), c("2d"))).toEqual({ index: 12, label: "22" });
    expect(hand169(c("As"), c("Ks"))).toEqual({ index: 13, label: "AKs" });
    expect(hand169(c("2h"), c("Ah"))).toEqual({ index: 24, label: "A2s" });
    expect(hand169(c("Kc"), c("Qc"))).toEqual({ index: 25, label: "KQs" });
    expect(hand169(c("3d"), c("2d"))).toEqual({ index: 90, label: "32s" });
    expect(hand169(c("As"), c("Kh"))).toEqual({ index: 91, label: "AKo" });
    expect(hand169(c("9c"), c("Ts"))).toEqual({ index: hand169(c("Td"), c("9h")).index, label: "T9o" });
    expect(hand169(c("3c"), c("2d"))).toEqual({ index: 168, label: "32o" });
    expect(label169(0)).toBe("AA");
    expect(label169(12)).toBe("22");
    expect(label169(13)).toBe("AKs");
    expect(label169(90)).toBe("32s");
    expect(label169(91)).toBe("AKo");
    expect(label169(168)).toBe("32o");
  });

  it("is order- and suit-insensitive within a hand class", () => {
    expect(hand169(c("7h"), c("7s")).index).toBe(hand169(c("7c"), c("7d")).index);
    expect(hand169(c("Qd"), c("Jd")).index).toBe(hand169(c("Jh"), c("Qh")).index);
    expect(hand169(c("Qd"), c("Jh")).index).toBe(hand169(c("Jc"), c("Qs")).index);
  });

  it("rejects invalid input", () => {
    expect(() => hand169(5, 5)).toThrow(RangeError);
    expect(() => hand169(-1, 3)).toThrow(RangeError);
    expect(() => combosOf169(-1)).toThrow(RangeError);
    expect(() => combosOf169(169)).toThrow(RangeError);
    expect(() => label169(1.5)).toThrow(RangeError);
  });
});
