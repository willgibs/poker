import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { assertChips, splitPotEven } from "./chips";

const FC_SEED = 20260817; // fixed seed: deterministic per repo testing rules

/** n plus a random permutation of 0..n-1 plus an amount in cents. */
const splitArgs = fc
  .integer({ min: 1, max: 9 })
  .chain((n) =>
    fc.tuple(
      fc.constant(n),
      fc.shuffledSubarray([...Array(n).keys()], { minLength: n, maxLength: n }),
      fc.integer({ min: 0, max: 100_000_000 }),
    ),
  );

describe("assertChips", () => {
  it("accepts non-negative safe integers", () => {
    for (const ok of [0, 1, 100, 2_500_000, Number.MAX_SAFE_INTEGER]) {
      expect(() => assertChips(ok)).not.toThrow();
    }
  });

  it("rejects floats, negatives, and non-finite values", () => {
    for (const bad of [-1, 0.5, 100.01, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      expect(() => assertChips(bad), String(bad)).toThrow(RangeError);
    }
  });
});

describe("splitPotEven", () => {
  it("conserves the total for fuzzed inputs", () => {
    fc.assert(
      fc.property(splitArgs, ([n, order, amount]) => {
        const shares = splitPotEven(amount, n, order);
        expect(shares).toHaveLength(n);
        expect(shares.reduce((sum, s) => sum + s, 0)).toBe(amount);
      }),
      { seed: FC_SEED },
    );
  });

  it("gives every share floor or floor+1, extras to earliest in oddChipOrder", () => {
    fc.assert(
      fc.property(splitArgs, ([n, order, amount]) => {
        const shares = splitPotEven(amount, n, order);
        const base = Math.floor(amount / n);
        const remainder = amount % n;
        for (let k = 0; k < n; k++) {
          const winner = order[k];
          expect(winner).toBeDefined();
          if (winner === undefined) return;
          expect(shares[winner]).toBe(k < remainder ? base + 1 : base);
        }
      }),
      { seed: FC_SEED },
    );
  });

  it("handles known vectors", () => {
    expect(splitPotEven(100, 2, [0, 1])).toEqual([50, 50]);
    expect(splitPotEven(101, 2, [0, 1])).toEqual([51, 50]);
    expect(splitPotEven(101, 2, [1, 0])).toEqual([50, 51]);
    expect(splitPotEven(5, 3, [2, 0, 1])).toEqual([2, 1, 2]);
    expect(splitPotEven(0, 4, [0, 1, 2, 3])).toEqual([0, 0, 0, 0]);
  });

  it("rejects invalid inputs", () => {
    expect(() => splitPotEven(-1, 2, [0, 1])).toThrow(RangeError);
    expect(() => splitPotEven(10.5, 2, [0, 1])).toThrow(RangeError);
    expect(() => splitPotEven(100, 0, [])).toThrow(RangeError);
    expect(() => splitPotEven(100, 1.5, [0])).toThrow(RangeError);
    expect(() => splitPotEven(100, 2, [0])).toThrow(RangeError); // wrong length
    expect(() => splitPotEven(100, 2, [0, 0])).toThrow(RangeError); // duplicate
    expect(() => splitPotEven(100, 2, [0, 2])).toThrow(RangeError); // out of range
    expect(() => splitPotEven(100, 2, [0, 1.5])).toThrow(RangeError); // non-integer
  });
});
