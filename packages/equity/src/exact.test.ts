import { describe, expect, it } from "vitest";
import { COMBO_COUNT, cardFromString, comboIndex } from "@poker/core";
import { naiveEvaluate7 } from "../test/naive-eval";
import { cardsOf, handOf, rangeOfCombos } from "../test/util";
import { equityVsRange } from "./exact";

describe("equityVsRange — river (pure win/lose/tie checks)", () => {
  const board = cardsOf("2c", "7d", "Jh", "Qs", "3c");

  it("hero ahead of a single combo = pure win", () => {
    const res = equityVsRange(handOf("As", "Ah"), rangeOfCombos([["Ks", "Kh"]]), board, naiveEvaluate7);
    expect(res).toEqual({ win: 1, tie: 0, equity: 1 });
  });

  it("hero behind a single combo = pure loss", () => {
    const res = equityVsRange(handOf("Ks", "Kh"), rangeOfCombos([["As", "Ah"]]), board, naiveEvaluate7);
    expect(res).toEqual({ win: 0, tie: 0, equity: 0 });
  });

  it("chopped board = pure tie, equity one half", () => {
    const chopBoard = cardsOf("Ah", "Kd", "Qc", "Js", "Th");
    const res = equityVsRange(handOf("2c", "3d"), rangeOfCombos([["2h", "3s"]]), chopBoard, naiveEvaluate7);
    expect(res).toEqual({ win: 0, tie: 1, equity: 0.5 });
  });

  it("respects combo weights (3:1 favourite mix)", () => {
    // Hero AA beats KK (weight 3), loses to JJ-top-set (weight 1).
    const range = rangeOfCombos([
      ["Ks", "Kh", 3],
      ["Jc", "Jd", 1],
    ]);
    const res = equityVsRange(handOf("As", "Ah"), range, board, naiveEvaluate7);
    expect(res.win).toBeCloseTo(0.75, 12);
    expect(res.tie).toBe(0);
    expect(res.equity).toBeCloseTo(0.75, 12);
  });
});

describe("equityVsRange — blocked combos", () => {
  const board = cardsOf("2c", "7d", "Jh", "Qs", "3c");

  it("combos containing hero's cards contribute zero", () => {
    const withBlocked = rangeOfCombos([
      ["As", "Ks", 1], // contains hero's As -> blocked
      ["Ah", "Kh", 1], // contains hero's Ah -> blocked
      ["Kc", "Kd", 1],
    ]);
    const clean = rangeOfCombos([["Kc", "Kd", 1]]);
    const hero = handOf("As", "Ah");
    expect(equityVsRange(hero, withBlocked, board, naiveEvaluate7)).toEqual(
      equityVsRange(hero, clean, board, naiveEvaluate7),
    );
  });

  it("combos containing board cards contribute zero", () => {
    const withBlocked = rangeOfCombos([
      ["Qs", "Qd", 1], // contains board Qs -> blocked
      ["Kc", "Kd", 1],
    ]);
    const clean = rangeOfCombos([["Kc", "Kd", 1]]);
    const hero = handOf("As", "Ah");
    expect(equityVsRange(hero, withBlocked, board, naiveEvaluate7)).toEqual(
      equityVsRange(hero, clean, board, naiveEvaluate7),
    );
  });

  it("throws when every positive-weight combo is blocked", () => {
    const allBlocked = rangeOfCombos([
      ["As", "Ks", 1],
      ["Ah", "2d", 1],
    ]);
    expect(() => equityVsRange(handOf("As", "Ah"), allBlocked, board, naiveEvaluate7)).toThrow(
      RangeError,
    );
  });
});

describe("equityVsRange — turn enumeration", () => {
  it("matches a hand-counted spot (AA vs KK, two clean outs)", () => {
    // Board Qc Jc 2h 3h. Villain KK wins only on the two remaining kings
    // (44 rivers, no straight/flush/chop rescue for either side).
    const res = equityVsRange(
      handOf("As", "Ad"),
      rangeOfCombos([["Ks", "Kd"]]),
      cardsOf("Qc", "Jc", "2h", "3h"),
      naiveEvaluate7,
    );
    expect(res.win).toBeCloseTo(42 / 44, 12);
    expect(res.tie).toBe(0);
    expect(res.equity).toBeCloseTo(42 / 44, 12);
  });
});

describe("equityVsRange — flop enumeration", () => {
  const flop = cardsOf("2c", "7d", "9s");

  it("mirror symmetry: opposing equities sum to one", () => {
    const a = equityVsRange(handOf("Ah", "Ad"), rangeOfCombos([["Kh", "Kd"]]), flop, naiveEvaluate7);
    const b = equityVsRange(handOf("Kh", "Kd"), rangeOfCombos([["Ah", "Ad"]]), flop, naiveEvaluate7);
    expect(a.equity + b.equity).toBeCloseTo(1, 12);
    expect(a.win).toBeCloseTo(1 - b.win - b.tie, 12);
    expect(a.tie).toBeCloseTo(b.tie, 12);
  });

  it("dominance: the overpair is a large favourite", () => {
    const a = equityVsRange(handOf("Ah", "Ad"), rangeOfCombos([["Kh", "Kd"]]), flop, naiveEvaluate7);
    expect(a.equity).toBeGreaterThan(0.85);
    expect(a.equity).toBeLessThan(0.98);
  });
});

describe("equityVsRange — input validation", () => {
  const board5 = cardsOf("2c", "7d", "Jh", "Qs", "3c");
  const kk = rangeOfCombos([["Ks", "Kh"]]);

  it("rejects preflop/short boards (use MC)", () => {
    expect(() => equityVsRange(handOf("As", "Ah"), kk, [], naiveEvaluate7)).toThrow(RangeError);
    expect(() => equityVsRange(handOf("As", "Ah"), kk, cardsOf("2c", "7d"), naiveEvaluate7)).toThrow(
      RangeError,
    );
  });

  it("rejects hero/board card overlap and invalid cards", () => {
    expect(() =>
      equityVsRange(handOf("2c", "Ah"), kk, board5, naiveEvaluate7),
    ).toThrow(RangeError);
    expect(() =>
      equityVsRange([cardFromString("As"), 52], kk, board5, naiveEvaluate7),
    ).toThrow(RangeError);
  });

  it("rejects malformed ranges", () => {
    expect(() =>
      equityVsRange(handOf("As", "Ah"), new Float32Array(100), board5, naiveEvaluate7),
    ).toThrow(RangeError);
    const negative = new Float32Array(COMBO_COUNT);
    negative[comboIndex(cardFromString("Ks"), cardFromString("Kh"))] = -1;
    expect(() => equityVsRange(handOf("As", "Ah"), negative, board5, naiveEvaluate7)).toThrow(
      RangeError,
    );
  });
});
