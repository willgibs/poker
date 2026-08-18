import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ALL_COMBOS, COMBO_COUNT, HAND169_COUNT, cardFromString, comboIndex, hand169 } from "@poker/core";
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

describe("known-vector: classic hand-class shapes via 169 grid", () => {
  // No range-string parser exists in this package (see @packageDocumentation
  // in index.ts — "Chart grids arrive as plain ArrayLike<number>"), so a
  // classic chart shape is expressed directly as a 169-class weight vector.
  // Combo counts per class are a fixed public contract (13 pairs x 6, 78
  // suited x 4, 78 offsuit x 12 — see class-tables test above), so the
  // expected totals below are exact, not approximate.
  function gridWithClasses(indices: readonly number[]): number[] {
    const g = new Array<number>(HAND169_COUNT).fill(0);
    for (const c of indices) g[c] = 1;
    return g;
  }
  const PAIR_CLASSES = Array.from({ length: 13 }, (_, i) => i); // 0..12: AA..22
  const SUITED_CLASSES = Array.from({ length: 78 }, (_, i) => 13 + i); // 13..90
  const OFFSUIT_CLASSES = Array.from({ length: 78 }, (_, i) => 91 + i); // 91..168

  it("'every pocket pair' (classes 0-12) is exactly 13*6 = 78 combos", () => {
    const r = fromGrid169(gridWithClasses(PAIR_CLASSES));
    expect(total(r)).toBe(78);
  });

  it("'every suited non-pair' (classes 13-90) is exactly 78*4 = 312 combos", () => {
    const r = fromGrid169(gridWithClasses(SUITED_CLASSES));
    expect(total(r)).toBe(312);
  });

  it("'every offsuit non-pair' (classes 91-168) is exactly 78*12 = 936 combos", () => {
    const r = fromGrid169(gridWithClasses(OFFSUIT_CLASSES));
    expect(total(r)).toBe(936);
  });

  it("pairs + suited + offsuit partition the full range: 78 + 312 + 936 = 1326", () => {
    expect(78 + 312 + 936).toBe(COMBO_COUNT);
    const whole = fromGrid169(gridWithClasses([...PAIR_CLASSES, ...SUITED_CLASSES, ...OFFSUIT_CLASSES]));
    expect(total(whole)).toBe(COMBO_COUNT);
    expect(Array.from(whole)).toEqual(Array.from(fullRange()));
  });

  it("'AA only' (a single pair class) is exactly 6 combos, all weight 1", () => {
    const r = fromGrid169(gridWithClasses([0]));
    expect(total(r)).toBe(6);
    for (const i of COMBOS_OF_CLASS[0]!) expect(r[i]).toBe(1);
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

describe("input validation", () => {
  it("rejects malformed range lengths across the vector ops", () => {
    const short = new Float32Array(5);
    const long = new Float32Array(COMBO_COUNT + 1);
    for (const bad of [short, long]) {
      expect(() => total(bad)).toThrow(RangeError);
      expect(() => clone(bad)).toThrow(RangeError);
      expect(() => normalize(bad)).toThrow(RangeError);
      expect(() => maskBlocked(bad, [])).toThrow(RangeError);
      expect(() => toGrid169(bad)).toThrow(RangeError);
      expect(() => combine(bad, fullRange(), 0.5)).toThrow(RangeError);
      expect(() => combine(fullRange(), bad, 0.5)).toThrow(RangeError);
    }
  });

  it("rejects a malformed `out` buffer, distinct from the input length check", () => {
    const good = fullRange();
    const badOut = new Float32Array(3);
    expect(() => normalize(good, badOut)).toThrow(RangeError);
    expect(() => maskBlocked(good, [], badOut)).toThrow(RangeError);
    expect(() => combine(good, good, 0.5, badOut)).toThrow(RangeError);
    expect(() => toGrid169(good, new Float32Array(3))).toThrow(RangeError);
  });
});

describe("maskBlocked worked example", () => {
  it("removing a board + hole cards zeros exactly the combos that share a card", () => {
    // Board As Kd 7h + hero holds Qc Qs: five dead cards. Any combo sharing
    // one of those five ranks-and-suits is dead; everything else survives.
    const dead = ["As", "Kd", "7h", "Qc", "Qs"].map(cardFromString);
    const masked = maskBlocked(fullRange(), dead);

    // A combo that reuses a dead card is gone...
    expect(masked[comboIndex(cardFromString("As"), cardFromString("Ks"))]).toBe(0); // shares As
    expect(masked[comboIndex(cardFromString("Qc"), cardFromString("Qs"))]).toBe(0); // both hero cards
    expect(masked[comboIndex(cardFromString("7h"), cardFromString("2c"))]).toBe(0); // shares 7h

    // ...while a combo of five untouched cards survives at full weight.
    expect(masked[comboIndex(cardFromString("Jh"), cardFromString("Td"))]).toBe(1);
    expect(masked[comboIndex(cardFromString("9c"), cardFromString("9d"))]).toBe(1);

    // Exactly C(52,2) - C(47,2) combos are removed (5 dead cards).
    expect(total(masked)).toBe((47 * 46) / 2);
  });
});

describe("determinism", () => {
  it("independent calls with identical inputs produce bit-identical output", () => {
    const r = pseudoRange(2024);
    const grid = toGrid169(pseudoRange(99));
    const dead = [cardFromString("2c"), cardFromString("Th")];

    expect(Array.from(normalize(clone(r)))).toEqual(Array.from(normalize(clone(r))));
    expect(Array.from(maskBlocked(clone(r), dead))).toEqual(Array.from(maskBlocked(clone(r), dead)));
    expect(Array.from(fromGrid169(grid))).toEqual(Array.from(fromGrid169(grid)));
    expect(Array.from(toGrid169(clone(r)))).toEqual(Array.from(toGrid169(clone(r))));
    expect(Array.from(combine(pseudoRange(1), pseudoRange(2), 0.37))).toEqual(
      Array.from(combine(pseudoRange(1), pseudoRange(2), 0.37)),
    );
  });
});
