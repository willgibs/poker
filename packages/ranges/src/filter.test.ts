import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { COMBO_COUNT } from "@poker/core";
import { clone, createRange, maskBlocked, normalize, total } from "./range";
import { filter } from "./filter";
import { expectUnitInterval, lcg, pseudoRange } from "./test-helpers";

const seedArb = fc.integer({ min: 0, max: 0x7fffffff });

function expectClose(actual: number, expected: number, tol: number): void {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tol);
}

/** Prior with a realistic mix of zero and fractional weights. */
function priorWithZeros(seed: number): Float32Array {
  const r = pseudoRange(seed);
  const next = lcg(seed ^ 0x5eed);
  for (let i = 0; i < COMBO_COUNT; i++) {
    if (next() < 0.3) r[i] = 0; // fold branches / model exclusions
  }
  // plus card-removal zeros
  return maskBlocked(r, [0, 17, 51], r);
}

describe("filter", () => {
  it("keeps the posterior normalized, floors live combos, never revives dead ones (property)", () => {
    fc.assert(
      fc.property(
        seedArb,
        seedArb,
        fc.double({ min: 1e-6, max: 0.5, noNaN: true }),
        (priorSeed, likeSeed, eps) => {
          const prior = priorWithZeros(priorSeed);
          const before = clone(prior);
          const next = lcg(likeSeed);
          const likes = new Float64Array(COMBO_COUNT);
          for (let i = 0; i < COMBO_COUNT; i++) likes[i] = next() * 2; // [0, 2): sometimes < eps
          const post = filter(prior, (i) => likes[i]!, eps);

          // normalized distribution in [0, 1]
          expectClose(total(post), 1, 1e-4);
          expectUnitInterval(post);

          // exact Bayes with floored likelihood, computed independently
          let sum = 0;
          const expected = new Float64Array(COMBO_COUNT);
          for (let i = 0; i < COMBO_COUNT; i++) {
            const p = before[i]!;
            if (p <= 0) continue;
            expected[i] = p * Math.max(likes[i]!, eps);
            sum += expected[i]!;
          }
          for (let i = 0; i < COMBO_COUNT; i++) {
            const want = expected[i]! / sum;
            expectClose(post[i]!, want, 1e-5 + want * 1e-4);
            if (before[i]! > 0) expect(post[i]!).toBeGreaterThan(0); // floor: never zeroed
            else expect(post[i]).toBe(0); // dead combos stay dead
          }

          expect(Array.from(prior)).toEqual(Array.from(before)); // pure
        },
      ),
    );
  });

  it("an all-below-floor likelihood degrades to the normalized prior", () => {
    const prior = priorWithZeros(42);
    const post = filter(prior, () => 0, 0.01);
    const expected = normalize(prior);
    for (let i = 0; i < COMBO_COUNT; i++) {
      expectClose(post[i]!, expected[i]!, 1e-6);
    }
  });

  it("sharpens toward high-likelihood combos", () => {
    const prior = pseudoRange(9);
    const strong = 100; // model says only combo 100 takes this action
    const post = filter(prior, (i) => (i === strong ? 1 : 0), 0.001);
    expect(post[strong]!).toBeGreaterThan(0.5);
    expectClose(total(post), 1, 1e-4);
  });

  it("returns all zeros for an all-zero prior", () => {
    const post = filter(createRange(), () => 1, 0.01);
    expect(total(post)).toBe(0);
  });

  it("supports out aliasing the input", () => {
    const prior = pseudoRange(4);
    const expected = filter(prior, (i) => (i % 2 === 0 ? 1 : 0.2), 0.05);
    const out = filter(prior, (i) => (i % 2 === 0 ? 1 : 0.2), 0.05, prior);
    expect(out).toBe(prior);
    expect(Array.from(out)).toEqual(Array.from(expected));
  });

  it("validates epsilonFloor and likelihood outputs", () => {
    const prior = pseudoRange(1);
    expect(() => filter(prior, () => 1, 0)).toThrow(RangeError);
    expect(() => filter(prior, () => 1, -0.1)).toThrow(RangeError);
    expect(() => filter(prior, () => 1, 1.1)).toThrow(RangeError);
    expect(() => filter(prior, () => Number.NaN, 0.01)).toThrow(RangeError);
    expect(() => filter(prior, () => Number.POSITIVE_INFINITY, 0.01)).toThrow(RangeError);
  });

  it("treats negative likelihoods as the floor", () => {
    const prior = pseudoRange(2);
    const withNeg = filter(prior, (i) => (i < 100 ? -5 : 1), 0.01);
    const withZero = filter(prior, (i) => (i < 100 ? 0 : 1), 0.01);
    expect(Array.from(withNeg)).toEqual(Array.from(withZero));
  });
});
