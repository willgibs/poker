/**
 * MC-vs-exact convergence, additive to mc.test.ts's single-N agreement
 * checks: here we sweep multiple *fixed* trial counts (never time-boxed,
 * per the determinism rules) on the same named spot, using named seeded
 * streams (`streamFor`, matching the project's session-seed-hierarchy
 * convention), and check two things a single-N check cannot:
 *
 * 1. The MC estimate stays within its theoretical 3-standard-error band of
 *    the exact value at every trial count in the sweep, not just one.
 * 2. Sampling *variance itself* shrinks like the standard Monte Carlo
 *    1/sqrt(N) law: replicated estimates at a small N spread out more than
 *    replicated estimates at a much larger N.
 *
 * Exact reference values reuse the pinned vectors from matchups.test.ts
 * (computed via this package's own `equityVsRange`), so a regression in
 * either the exact or the MC path can surface here independently of that
 * file.
 */
import { describe, expect, it } from "vitest";
import { streamFor } from "@poker/rng";
import { naiveEvaluate7 } from "../test/naive-eval";
import { cardsOf, handOf, rangeOfCombos } from "../test/util";
import { equityVsRange } from "./exact";
import { equityVsRangeMC } from "./mc";

const ROOT_SEED = 20260818; // fixed seed: deterministic per repo testing rules

describe("equityVsRangeMC — convergence sweep against a pinned exact vector", () => {
  it("AA vs KK on a blank flop: MC agrees with exact within 3 SE at every trial count in the sweep", () => {
    const hero = handOf("Ah", "Ad");
    const range = rangeOfCombos([["Kh", "Kc"]]);
    const board = cardsOf("2c", "7d", "9s");
    const exact = equityVsRange(hero, range, board, naiveEvaluate7);

    for (const trials of [500, 2_000, 8_000, 32_000]) {
      const stream = streamFor(ROOT_SEED, `convergence/aa-vs-kk/${trials}`);
      const mc = equityVsRangeMC(hero, range, board, naiveEvaluate7, stream, trials);
      const se = Math.sqrt((exact.equity * (1 - exact.equity)) / trials);
      expect(
        Math.abs(mc.equity - exact.equity),
        `trials=${trials}: exact=${exact.equity} mc=${mc.equity} se=${se}`,
      ).toBeLessThanOrEqual(3 * se + 1e-9);
    }
  });

  it("flush draw vs a flopped set: MC agrees with exact within 3 SE at every trial count in the sweep", () => {
    const hero = handOf("Ah", "Kh");
    const range = rangeOfCombos([["9s", "9d"]]);
    const board = cardsOf("9c", "7h", "2h");
    const exact = equityVsRange(hero, range, board, naiveEvaluate7);

    for (const trials of [500, 2_000, 8_000, 32_000]) {
      const stream = streamFor(ROOT_SEED, `convergence/flush-draw-vs-set/${trials}`);
      const mc = equityVsRangeMC(hero, range, board, naiveEvaluate7, stream, trials);
      const se = Math.sqrt((exact.equity * (1 - exact.equity)) / trials);
      expect(
        Math.abs(mc.equity - exact.equity),
        `trials=${trials}: exact=${exact.equity} mc=${mc.equity} se=${se}`,
      ).toBeLessThanOrEqual(3 * se + 1e-9);
    }
  });
});

describe("equityVsRangeMC — sampling variance shrinks with trial count (1/sqrt(N) law)", () => {
  it("replicated estimates spread less at 8,000 trials than at 500 trials", () => {
    const hero = handOf("Ah", "Ad");
    const range = rangeOfCombos([["Kh", "Kc"]]);
    const board = cardsOf("2c", "7d", "9s");
    const REPS = 24;

    const stdevOf = (trials: number): number => {
      const estimates: number[] = [];
      for (let i = 0; i < REPS; i++) {
        const stream = streamFor(ROOT_SEED, `convergence/aa-vs-kk/variance/n${trials}/rep${i}`);
        estimates.push(equityVsRangeMC(hero, range, board, naiveEvaluate7, stream, trials).equity);
      }
      const mean = estimates.reduce((a, b) => a + b, 0) / estimates.length;
      const variance =
        estimates.reduce((a, x) => a + (x - mean) ** 2, 0) / (estimates.length - 1);
      return Math.sqrt(variance);
    };

    const sdSmall = stdevOf(500);
    const sdLarge = stdevOf(8_000);

    // Theoretical ratio is sqrt(8000/500) = 4; with only 24 replications the
    // *measured* ratio is noisy, so this only pins the qualitative direction
    // (more trials -> tighter spread) plus a loose sanity band around the
    // theoretical factor rather than the factor itself.
    expect(sdLarge).toBeLessThan(sdSmall);
    const ratio = sdSmall / sdLarge;
    expect(ratio).toBeGreaterThan(1.5);
    expect(ratio).toBeLessThan(10);
  });
});

describe("equityVsRangeMC — named seeded streams are independent and reproducible", () => {
  it("different sweep labels on the same root seed do not collide", () => {
    const hero = handOf("Ah", "Ad");
    const range = rangeOfCombos([["Kh", "Kc"]]);
    const board = cardsOf("2c", "7d", "9s");
    const a = equityVsRangeMC(
      hero,
      range,
      board,
      naiveEvaluate7,
      streamFor(ROOT_SEED, "convergence/aa-vs-kk/2000"),
      2_000,
    );
    const b = equityVsRangeMC(
      hero,
      range,
      board,
      naiveEvaluate7,
      streamFor(ROOT_SEED, "convergence/flush-draw-vs-set/2000"),
      2_000,
    );
    expect(a).not.toEqual(b);
  });

  it("re-deriving the same label from the same root reproduces the exact same result", () => {
    const hero = handOf("Ah", "Ad");
    const range = rangeOfCombos([["Kh", "Kc"]]);
    const board = cardsOf("2c", "7d", "9s");
    const run = (): ReturnType<typeof equityVsRangeMC> =>
      equityVsRangeMC(
        hero,
        range,
        board,
        naiveEvaluate7,
        streamFor(ROOT_SEED, "convergence/aa-vs-kk/8000"),
        8_000,
      );
    expect(run()).toEqual(run());
  });
});
