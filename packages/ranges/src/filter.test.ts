import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { COMBO_COUNT, cardFromString, comboIndex } from "@poker/core";
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

  describe("known vector: two-street Bayesian update (hand-computed)", () => {
    // A toy 3-hypothesis range narrowed across two streets. Everything off
    // these three combos stays 0 throughout (zero prior mass, per the
    // "never revives" contract), so the whole update reduces to arithmetic
    // over three numbers we can check by hand.
    //
    //   AA (villain value-bets the flop a lot)
    //   KQs (a drawy hand that barrels less, checks back more)
    //   72o (pure air — rarely bets, mostly gives up)
    const iAA = comboIndex(cardFromString("As"), cardFromString("Ah"));
    const iKQs = comboIndex(cardFromString("Ks"), cardFromString("Qs"));
    const i72o = comboIndex(cardFromString("7c"), cardFromString("2d"));

    // Prior: unnormalized weights 2 / 1 / 1 (e.g. AA is twice as combo-heavy
    // in villain's opening range as either of the others after blockers).
    function toyPrior(): Float32Array {
      const p = createRange();
      p[iAA] = 2;
      p[iKQs] = 1;
      p[i72o] = 1;
      return p;
    }

    it("street 1 (flop bet): posterior matches exact fractions 9/11, 3/22, 1/22", () => {
      // Flop-bet likelihoods: AA bets 90% of the time, KQs 30%, 72o 10%.
      // epsilonFloor = 0.01 never engages (all three likelihoods exceed it).
      //
      //   unnormalized: 2*0.9 = 9/5, 1*0.3 = 3/10, 1*0.1 = 1/10
      //   sum:          9/5 + 3/10 + 1/10 = 18/10 + 3/10 + 1/10 = 22/10 = 11/5
      //   posterior:    (9/5)/(11/5) = 9/11
      //                 (3/10)/(11/5) = 3/22
      //                 (1/10)/(11/5) = 1/22
      //   check: 9/11 + 3/22 + 1/22 = 18/22 + 3/22 + 1/22 = 22/22 = 1
      const likelihood1 = (i: number): number => {
        if (i === iAA) return 0.9;
        if (i === iKQs) return 0.3;
        if (i === i72o) return 0.1;
        return 0; // never consulted: those combos have 0 prior
      };
      const post1 = filter(toyPrior(), likelihood1, 0.01);

      expectClose(post1[iAA]!, 9 / 11, 1e-5);
      expectClose(post1[iKQs]!, 3 / 22, 1e-5);
      expectClose(post1[i72o]!, 1 / 22, 1e-5);
      expectClose(total(post1), 1, 1e-5);
      for (let i = 0; i < COMBO_COUNT; i++) {
        if (i !== iAA && i !== iKQs && i !== i72o) expect(post1[i]).toBe(0);
      }
    });

    it("street 2 (turn check): chaining a second filter() lands on exact fractions 4/7, 2/7, 1/7", () => {
      // Turn-check likelihoods: AA checks back only 20% (mostly keeps betting),
      // KQs checks 60%, 72o gives up and checks 90%.
      //
      //   street-1 posterior (fractions, from the test above): 9/11, 3/22, 1/22
      //   unnormalized: (9/11)*(1/5)  = 9/55  = 36/220
      //                 (3/22)*(3/5)  = 9/110 = 18/220
      //                 (1/22)*(9/10) = 9/220 =  9/220
      //   sum:          (36 + 18 + 9)/220 = 63/220
      //   posterior:    36/63 = 4/7, 18/63 = 2/7, 9/63 = 1/7
      //   check: 4/7 + 2/7 + 1/7 = 7/7 = 1
      const likelihood1 = (i: number): number => {
        if (i === iAA) return 0.9;
        if (i === iKQs) return 0.3;
        if (i === i72o) return 0.1;
        return 0;
      };
      const likelihood2 = (i: number): number => {
        if (i === iAA) return 0.2;
        if (i === iKQs) return 0.6;
        if (i === i72o) return 0.9;
        return 0;
      };
      const post1 = filter(toyPrior(), likelihood1, 0.01);
      const post2 = filter(post1, likelihood2, 0.01);

      expectClose(post2[iAA]!, 4 / 7, 1e-5);
      expectClose(post2[iKQs]!, 2 / 7, 1e-5);
      expectClose(post2[i72o]!, 1 / 7, 1e-5);
      expectClose(total(post2), 1, 1e-5);
      for (let i = 0; i < COMBO_COUNT; i++) {
        if (i !== iAA && i !== iKQs && i !== i72o) expect(post2[i]).toBe(0);
      }
    });
  });

  describe("determinism", () => {
    it("independent calls with identical inputs produce identical posteriors", () => {
      const prior = priorWithZeros(17);
      const like = (i: number): number => ((i * 37) % 101) / 101;
      const run1 = filter(prior, like, 0.02);
      const run2 = filter(prior, like, 0.02);
      expect(Array.from(run1)).toEqual(Array.from(run2));
    });
  });
});
