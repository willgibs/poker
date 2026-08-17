import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ALL_COMBOS, COMBO_COUNT, HAND169_COUNT, hand169 } from "@poker/core";
import {
  CLASS_COMBO_COUNT,
  CLASS_OF_COMBO,
  COMBOS_OF_CLASS,
  GRID_SIZE,
  RANGE_SIZE,
  clone,
  combine,
  createRange,
  fromGrid169,
  fullRange,
  maskBlocked,
  normalize,
  toGrid169,
  total,
} from "./range";
import { expectUnitInterval, lcg, pseudoRange } from "./test-helpers";

const deadSetArb = fc.uniqueArray(fc.integer({ min: 0, max: 51 }), { minLength: 0, maxLength: 10 });
const seedArb = fc.integer({ min: 0, max: 0x7fffffff });

function expectClose(actual: number, expected: number, tol: number): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);
}

describe("class tables", () => {
  it("agree with hand169 and partition the 1326 combos", () => {
    expect(RANGE_SIZE).toBe(COMBO_COUNT);
    expect(GRID_SIZE).toBe(HAND169_COUNT);
    let sixes = 0;
    let fours = 0;
    let twelves = 0;
    const seen = new Set<number>();
    for (let c = 0; c < HAND169_COUNT; c++) {
      const combos = COMBOS_OF_CLASS[c]!;
      expect(combos.length).toBe(CLASS_COMBO_COUNT[c]);
      if (combos.length === 6) sixes++;
      else if (combos.length === 4) fours++;
      else if (combos.length === 12) twelves++;
      for (const i of combos) {
        expect(CLASS_OF_COMBO[i]).toBe(c);
        const [a, b] = ALL_COMBOS[i]!;
        expect(hand169(a, b).index).toBe(c);
        seen.add(i);
      }
    }
    expect(sixes).toBe(13);
    expect(fours).toBe(78);
    expect(twelves).toBe(78);
    expect(seen.size).toBe(COMBO_COUNT);
  });
});

describe("basics", () => {
  it("createRange / fullRange / clone / total", () => {
    const empty = createRange();
    expect(total(empty)).toBe(0);
    const full = fullRange();
    expect(total(full)).toBe(COMBO_COUNT);
    const copy = clone(full);
    copy[0] = 0;
    expect(full[0]).toBe(1); // clone is independent
    expect(total(copy)).toBe(COMBO_COUNT - 1);
  });

  it("normalize yields a distribution and leaves zero ranges zero", () => {
    fc.assert(
      fc.property(seedArb, (seed) => {
        const r = pseudoRange(seed);
        const n = normalize(r);
        expectClose(total(n), 1, 1e-4);
        expectUnitInterval(n);
        expect(total(r)).toBeGreaterThan(1); // input untouched
      }),
    );
    const zero = normalize(createRange());
    expect(total(zero)).toBe(0);
  });

  it("normalize supports in-place out aliasing", () => {
    const r = pseudoRange(7);
    const expected = normalize(r);
    const out = normalize(r, r);
    expect(out).toBe(r);
    expect(Array.from(out)).toEqual(Array.from(expected));
  });
});

describe("maskBlocked", () => {
  it("zeros exactly the combos containing a dead card (property)", () => {
    fc.assert(
      fc.property(seedArb, deadSetArb, (seed, dead) => {
        const r = pseudoRange(seed);
        const before = clone(r);
        const masked = maskBlocked(r, dead);
        const deadSet = new Set(dead);
        for (let i = 0; i < COMBO_COUNT; i++) {
          const [a, b] = ALL_COMBOS[i]!;
          if (deadSet.has(a) || deadSet.has(b)) {
            expect(masked[i]).toBe(0);
          } else {
            expect(masked[i]).toBe(r[i]); // untouched, bit-exact
          }
        }
        expect(Array.from(r)).toEqual(Array.from(before)); // input not mutated
      }),
    );
  });

  it("removes C(52,2) - C(52-d,2) combos from the full range", () => {
    fc.assert(
      fc.property(deadSetArb, (dead) => {
        const masked = maskBlocked(fullRange(), dead);
        const live = 52 - dead.length;
        expect(total(masked)).toBe((live * (live - 1)) / 2);
      }),
    );
  });

  it("rejects invalid dead cards and supports aliasing", () => {
    expect(() => maskBlocked(fullRange(), [52])).toThrow(RangeError);
    expect(() => maskBlocked(fullRange(), [-1])).toThrow(RangeError);
    const r = fullRange();
    const out = maskBlocked(r, [0, 51], r);
    expect(out).toBe(r);
    expect(total(r)).toBe((50 * 49) / 2);
  });
});

describe("169 grid round-trip", () => {
  const gridArb = seedArb.map((seed) => {
    const next = lcg(seed);
    const g = new Array<number>(HAND169_COUNT);
    for (let c = 0; c < HAND169_COUNT; c++) g[c] = next();
    return g;
  });

  it("fromGrid169 expands per-combo and conserves total mass", () => {
    fc.assert(
      fc.property(gridArb, (grid) => {
        const r = fromGrid169(grid);
        expectUnitInterval(r);
        let expected = 0;
        for (let c = 0; c < HAND169_COUNT; c++) {
          expected += grid[c]! * CLASS_COMBO_COUNT[c]!;
          for (const i of COMBOS_OF_CLASS[c]!) {
            expectClose(r[i]!, grid[c]!, 1e-6); // f32 rounding only
          }
        }
        expectClose(total(r), expected, 1e-3);
      }),
    );
  });

  it("toGrid169(fromGrid169(g)) recovers g up to f32 rounding", () => {
    fc.assert(
      fc.property(gridArb, (grid) => {
        const g2 = toGrid169(fromGrid169(grid));
        for (let c = 0; c < HAND169_COUNT; c++) expectClose(g2[c]!, grid[c]!, 1e-5);
      }),
    );
  });

  it("fromGrid169(toGrid169(r)) conserves total for arbitrary ranges", () => {
    fc.assert(
      fc.property(seedArb, (seed) => {
        const r = pseudoRange(seed);
        const back = fromGrid169(toGrid169(r));
        expectClose(total(back), total(r), 1e-2);
        expectUnitInterval(back);
      }),
    );
  });

  it("validates grid length and values", () => {
    expect(() => fromGrid169([0.5])).toThrow(RangeError);
    const bad = new Array<number>(HAND169_COUNT).fill(0);
    bad[3] = 1.5;
    expect(() => fromGrid169(bad)).toThrow(RangeError);
    bad[3] = -0.1;
    expect(() => fromGrid169(bad)).toThrow(RangeError);
    bad[3] = Number.NaN;
    expect(() => fromGrid169(bad)).toThrow(RangeError);
  });
});

describe("combine", () => {
  it("is the identity at w=0 and swaps at w=1", () => {
    const a = pseudoRange(1);
    const b = pseudoRange(2);
    expect(Array.from(combine(a, b, 0))).toEqual(Array.from(a));
    expect(Array.from(combine(a, b, 1))).toEqual(Array.from(b));
  });

  it("stays inside [0,1] and blends totals linearly (property)", () => {
    fc.assert(
      fc.property(seedArb, seedArb, fc.double({ min: 0, max: 1, noNaN: true }), (s1, s2, w) => {
        const a = pseudoRange(s1);
        const b = pseudoRange(s2);
        const mixed = combine(a, b, w);
        expectUnitInterval(mixed);
        expectClose(total(mixed), total(a) + w * (total(b) - total(a)), 1e-2);
      }),
    );
  });

  it("rejects out-of-range w", () => {
    expect(() => combine(createRange(), createRange(), -0.1)).toThrow(RangeError);
    expect(() => combine(createRange(), createRange(), 1.1)).toThrow(RangeError);
    expect(() => combine(createRange(), createRange(), Number.NaN)).toThrow(RangeError);
  });
});
