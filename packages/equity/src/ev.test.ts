import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { callEV, foldEquityEV, potOdds } from "./ev";

const FC_SEED = 20260817; // fixed seed: deterministic per repo testing rules

describe("potOdds", () => {
  it("computes required equity toCall / (pot + toCall)", () => {
    expect(potOdds(100, 50)).toBeCloseTo(1 / 3, 12);
    expect(potOdds(300, 100)).toBeCloseTo(0.25, 12);
    expect(potOdds(150, 150)).toBeCloseTo(0.5, 12);
  });

  it("returns 0 when there is nothing to call (and for an empty pot)", () => {
    expect(potOdds(100, 0)).toBe(0);
    expect(potOdds(0, 0)).toBe(0);
  });

  it("rejects non-chip inputs", () => {
    expect(() => potOdds(-1, 50)).toThrow(RangeError);
    expect(() => potOdds(100, 50.5)).toThrow(RangeError);
    expect(() => potOdds(NaN, 50)).toThrow(RangeError);
  });
});

describe("callEV", () => {
  it("is zero exactly at pot odds (breakeven identity)", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 10_000_000 }),
        fc.integer({ min: 1, max: 10_000_000 }),
        (pot, toCall) => {
          const breakeven = potOdds(pot, toCall);
          expect(callEV(breakeven, pot, toCall)).toBeCloseTo(0, 6);
        },
      ),
      { seed: FC_SEED },
    );
  });

  it("matches hand-computed values", () => {
    expect(callEV(0.5, 100, 50)).toBeCloseTo(25, 12); // 0.5*150 - 50
    expect(callEV(0, 100, 50)).toBe(-50);
    expect(callEV(1, 100, 50)).toBe(100);
  });

  it("is monotone increasing in equity", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (pot, toCall, e1, e2) => {
          const [lo, hi] = e1 <= e2 ? [e1, e2] : [e2, e1];
          expect(callEV(lo, pot, toCall)).toBeLessThanOrEqual(callEV(hi, pot, toCall));
        },
      ),
      { seed: FC_SEED },
    );
  });

  it("rejects out-of-range equity", () => {
    expect(() => callEV(-0.1, 100, 50)).toThrow(RangeError);
    expect(() => callEV(1.1, 100, 50)).toThrow(RangeError);
    expect(() => callEV(NaN, 100, 50)).toThrow(RangeError);
  });
});

describe("foldEquityEV", () => {
  it("collapses to the pot when villain always folds", () => {
    expect(foldEquityEV(75, 100, 1, 0)).toBe(100);
    expect(foldEquityEV(75, 100, 1, 1)).toBe(100);
  });

  it("collapses to the called-showdown EV when villain never folds", () => {
    // equity*(pot + 2*bet) - bet
    expect(foldEquityEV(50, 100, 0, 0.5)).toBeCloseTo(0.5 * 200 - 50, 12);
    expect(foldEquityEV(50, 100, 0, 0)).toBe(-50);
    expect(foldEquityEV(50, 100, 0, 1)).toBe(150);
  });

  it("interpolates linearly in fold frequency", () => {
    const never = foldEquityEV(50, 100, 0, 0.3);
    const always = foldEquityEV(50, 100, 1, 0.3);
    const half = foldEquityEV(50, 100, 0.5, 0.3);
    expect(half).toBeCloseTo((never + always) / 2, 12);
  });

  it("a zero-equity bluff needs the classic breakeven fold frequency bet/(pot+bet)", () => {
    // Betting 50 into 100 with no equity: breakeven at foldFreq = 1/3.
    const f = 50 / 150;
    expect(foldEquityEV(50, 100, f, 0)).toBeCloseTo(0, 12);
  });

  it("rejects invalid inputs", () => {
    expect(() => foldEquityEV(-1, 100, 0.5, 0.5)).toThrow(RangeError);
    expect(() => foldEquityEV(50, 100.5, 0.5, 0.5)).toThrow(RangeError);
    expect(() => foldEquityEV(50, 100, 1.5, 0.5)).toThrow(RangeError);
    expect(() => foldEquityEV(50, 100, 0.5, -0.2)).toThrow(RangeError);
  });
});
