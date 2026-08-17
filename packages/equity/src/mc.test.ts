import { describe, expect, it } from "vitest";
import { COMBO_COUNT, freshDeck } from "@poker/core";
import { createStream, streamFor } from "@poker/rng";
import { naiveEvaluate7 } from "../test/naive-eval";
import { at, cardsOf, handOf, rangeOfCombos, rangeOfLabels } from "../test/util";
import { equityVsRange } from "./exact";
import { equityVsRangeMC, multiwayEquityMC } from "./mc";

describe("equityVsRangeMC — known preflop matchups (seeded)", () => {
  it("AA vs KK is roughly 0.80-0.83", () => {
    const res = equityVsRangeMC(
      handOf("As", "Ah"),
      rangeOfLabels("KK"),
      [],
      naiveEvaluate7,
      streamFor(20260817, "mc/aa-vs-kk"),
      20_000,
    );
    expect(res.equity).toBeGreaterThanOrEqual(0.8);
    expect(res.equity).toBeLessThanOrEqual(0.83);
    expect(res.win + res.tie).toBeLessThanOrEqual(1);
  });

  it("AKs vs QQ is roughly 0.46 +/- 0.02", () => {
    const res = equityVsRangeMC(
      handOf("As", "Ks"),
      rangeOfLabels("QQ"),
      [],
      naiveEvaluate7,
      streamFor(20260817, "mc/aks-vs-qq"),
      20_000,
    );
    expect(res.equity).toBeGreaterThanOrEqual(0.44);
    expect(res.equity).toBeLessThanOrEqual(0.48);
  });
});

describe("equityVsRangeMC — determinism", () => {
  it("identical seeds produce identical results", () => {
    const run = (): ReturnType<typeof equityVsRangeMC> =>
      equityVsRangeMC(
        handOf("Jh", "Th"),
        rangeOfLabels("77", "AKo"),
        cardsOf("9h", "8c", "2d"),
        naiveEvaluate7,
        createStream(42),
        5_000,
      );
    expect(run()).toEqual(run());
  });

  it("different seeds produce different samples", () => {
    const run = (seed: number): number =>
      equityVsRangeMC(
        handOf("Jh", "Th"),
        rangeOfLabels("77", "AKo"),
        cardsOf("9h", "8c", "2d"),
        naiveEvaluate7,
        createStream(seed),
        5_000,
      ).equity;
    expect(run(1)).not.toBe(run(2));
  });
});

describe("equityVsRangeMC — agreement with exact enumeration", () => {
  it("matches exact turn enumeration within 3 standard errors on seeded random spots", () => {
    const TRIALS = 4_000;
    for (let spot = 0; spot < 5; spot++) {
      const s = streamFor(987_654, `spot/${spot}`);
      const deck = s.shuffle(freshDeck());
      const hero: [number, number] = [at(deck, 0), at(deck, 1)];
      const board = deck.slice(2, 6);
      // Random weighted range over ~60 combos (dead ones are skipped inside).
      const range = new Float32Array(COMBO_COUNT);
      for (let k = 0; k < 60; k++) {
        range[s.nextInt(COMBO_COUNT)] = 0.25 + 0.75 * s.nextFloat();
      }
      const exact = (() => {
        try {
          return equityVsRange(hero, range, board, naiveEvaluate7);
        } catch {
          return null;
        }
      })();
      if (exact === null) continue; // astronomically unlikely: all 60 combos blocked
      const mc = equityVsRangeMC(hero, range, board, naiveEvaluate7, s.fork("mc"), TRIALS);
      const se = Math.sqrt((exact.equity * (1 - exact.equity)) / TRIALS);
      expect(
        Math.abs(mc.equity - exact.equity),
        `spot ${spot}: exact=${exact.equity} mc=${mc.equity}`,
      ).toBeLessThanOrEqual(3 * se + 1e-9);
    }
  });

  it("matches exact enumeration on the river within 3 standard errors", () => {
    const hero = handOf("Ah", "Kd");
    const range = rangeOfLabels("QQ", "JJ", "76s");
    const board = cardsOf("Qs", "Jh", "7c", "2d", "Kc");
    const exact = equityVsRange(hero, range, board, naiveEvaluate7);
    const TRIALS = 5_000;
    const mc = equityVsRangeMC(hero, range, board, naiveEvaluate7, createStream(7), TRIALS);
    const se = Math.sqrt((exact.equity * (1 - exact.equity)) / TRIALS) || 1e-3;
    expect(Math.abs(mc.equity - exact.equity)).toBeLessThanOrEqual(3 * se + 1e-9);
  });
});

describe("equityVsRangeMC — blocked combos", () => {
  const board = cardsOf("2c", "7d", "Jh", "Qs", "3c");

  it("combos containing hero's cards contribute zero (identical stream, identical result)", () => {
    const hero = handOf("As", "Ah");
    const withBlocked = rangeOfCombos([
      ["As", "Ks", 1], // blocked by hero
      ["Ah", "Kh", 1], // blocked by hero
      ["Kc", "Kd", 1],
    ]);
    const clean = rangeOfCombos([["Kc", "Kd", 1]]);
    const a = equityVsRangeMC(hero, withBlocked, board, naiveEvaluate7, createStream(99), 2_000);
    const b = equityVsRangeMC(hero, clean, board, naiveEvaluate7, createStream(99), 2_000);
    expect(a).toEqual(b);
  });

  it("throws when the whole range is blocked", () => {
    const hero = handOf("As", "Ah");
    const allBlocked = rangeOfCombos([
      ["As", "Ks", 1],
      ["Ah", "2d", 1],
    ]);
    expect(() =>
      equityVsRangeMC(hero, allBlocked, board, naiveEvaluate7, createStream(1), 100),
    ).toThrow(RangeError);
  });
});

describe("equityVsRangeMC — input validation", () => {
  const kk = rangeOfLabels("KK");
  it("rejects bad trial counts and long boards", () => {
    const hero = handOf("As", "Ah");
    expect(() => equityVsRangeMC(hero, kk, [], naiveEvaluate7, createStream(1), 0)).toThrow(
      RangeError,
    );
    expect(() => equityVsRangeMC(hero, kk, [], naiveEvaluate7, createStream(1), 10.5)).toThrow(
      RangeError,
    );
    expect(() =>
      equityVsRangeMC(hero, kk, cardsOf("2c", "3c", "4c", "5c", "6c", "7c"), naiveEvaluate7, createStream(1), 100),
    ).toThrow(RangeError);
  });
});

describe("multiwayEquityMC", () => {
  it("AA vs KK vs QQ lands near its known ~0.66 equity (seeded)", () => {
    const res = multiwayEquityMC(
      handOf("As", "Ah"),
      [rangeOfLabels("KK"), rangeOfLabels("QQ")],
      [],
      naiveEvaluate7,
      streamFor(20260817, "mc/aa-kk-qq"),
      8_000,
    );
    expect(res.equity).toBeGreaterThanOrEqual(0.61);
    expect(res.equity).toBeLessThanOrEqual(0.72);
    expect(res.win).toBeGreaterThanOrEqual(res.equity - res.tie); // shares never exceed ties
  });

  it("three-way chop pays exactly one third with exact tie shares", () => {
    // Broadway on the board, nobody can improve: always a three-way chop.
    const res = multiwayEquityMC(
      handOf("2h", "3h"),
      [rangeOfCombos([["2s", "3s"]]), rangeOfCombos([["2d", "3d"]])],
      cardsOf("Tc", "Jd", "Qh", "Ks", "Ac"),
      naiveEvaluate7,
      createStream(5),
      500,
    );
    expect(res.win).toBe(0);
    expect(res.tie).toBe(1);
    expect(res.equity).toBeCloseTo(1 / 3, 9);
  });

  it("is deterministic for a fixed seed", () => {
    const run = (): ReturnType<typeof multiwayEquityMC> =>
      multiwayEquityMC(
        handOf("Jh", "Th"),
        [rangeOfLabels("AA", "AKs"), rangeOfLabels("55", "76s")],
        cardsOf("9h", "8c", "2d"),
        naiveEvaluate7,
        createStream(1234),
        3_000,
      );
    expect(run()).toEqual(run());
  });

  it("throws when villain ranges can never be disjoint", () => {
    const sameCombo = rangeOfCombos([["Kc", "Kd", 1]]);
    expect(() =>
      multiwayEquityMC(
        handOf("As", "Ah"),
        [sameCombo, sameCombo],
        [],
        naiveEvaluate7,
        createStream(1),
        10,
      ),
    ).toThrow(/disjoint/);
  });

  it("throws when a villain range is fully blocked", () => {
    expect(() =>
      multiwayEquityMC(
        handOf("As", "Ah"),
        [rangeOfCombos([["As", "Ks", 1]])],
        [],
        naiveEvaluate7,
        createStream(1),
        10,
      ),
    ).toThrow(RangeError);
  });
});
