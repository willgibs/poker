/**
 * Classic-matchup known vectors, additive to exact.test.ts: named preflop
 * archetypes (AA/KK, AKs/QQ, 22/AKo) and draw-vs-set flops, each pinned by
 * running the project's own `equityVsRange` exact-enumeration path (with
 * the package's `naiveEvaluate7` test oracle, exactly like every other test
 * in this file) and recording the result. Every pinned number below was
 * produced by calling `equityVsRange` directly with the exact hero/range/
 * board triples that appear in each test — see the comment above each
 * assertion for how it was generated and why the value makes sense.
 *
 * These are flop-conditioned equities, not raw preflop percentages: e.g. AA
 * vs KK is famously ~82% preflop, but conditioning on a *blank flop that KK
 * already missed* pushes it up (KK's only remaining outs are a runner-runner
 * set with two streets left, not three); AK vs QQ moves the other way for
 * the mirror reason (AK's overcards missed the flop, so its only remaining
 * outs are pairing on the turn or river, fewer chances than the full
 * preflop picture). This conditioning effect is real poker math, not a bug
 * — it is exactly why "equity on this flop" and "equity preflop" differ.
 */
import { describe, expect, it } from "vitest";
import { naiveEvaluate7 } from "../test/naive-eval";
import { cardsOf, handOf, rangeOfCombos } from "../test/util";
import { equityVsRange } from "./exact";

describe("equityVsRange — classic matchups, pinned exact vectors", () => {
  it("AA vs KK on a blank rainbow flop (overpair vs overpair)", () => {
    // equityVsRange(AhAd, {KhKc}, [2c,7d,9s], naiveEvaluate7) -> win 0.9161616161616162
    const res = equityVsRange(
      handOf("Ah", "Ad"),
      rangeOfCombos([["Kh", "Kc"]]),
      cardsOf("2c", "7d", "9s"),
      naiveEvaluate7,
    );
    expect(res.tie).toBe(0);
    expect(res.win).toBeCloseTo(0.9161616161616162, 12);
    expect(res.equity).toBeCloseTo(0.9161616161616162, 12);
  });

  it("AKs vs QQ on a blank rainbow flop (missed overcards vs overpair)", () => {
    // equityVsRange(AhKh, {QcQd}, [4c,7d,9s], naiveEvaluate7) -> win 0.23939393939393938
    const res = equityVsRange(
      handOf("Ah", "Kh"),
      rangeOfCombos([["Qc", "Qd"]]),
      cardsOf("4c", "7d", "9s"),
      naiveEvaluate7,
    );
    expect(res.tie).toBe(0);
    expect(res.win).toBeCloseTo(0.23939393939393938, 12);
  });

  it("22 vs AKo on a blank rainbow flop (small pair vs two missed overcards)", () => {
    // equityVsRange(2h2s, {AcKd}, [7c,9d,Js], naiveEvaluate7) -> win 0.701010101010101, tie 0.01616161616161616
    const res = equityVsRange(
      handOf("2h", "2s"),
      rangeOfCombos([["Ac", "Kd"]]),
      cardsOf("7c", "9d", "Js"),
      naiveEvaluate7,
    );
    expect(res.win).toBeCloseTo(0.701010101010101, 12);
    expect(res.tie).toBeCloseTo(0.01616161616161616, 12);
    expect(res.equity).toBeCloseTo(0.7090909090909091, 12);
  });
});

describe("equityVsRange — draw vs a flopped set", () => {
  it("nut flush draw vs a flopped set of nines", () => {
    // Board 9c 7h 2h: villain's pocket nines flop bottom set; hero's AhKh
    // has the nut flush draw (two more hearts already on board). The draw's
    // overcards don't count as outs here (a set beats top pair), so this is
    // meaningfully worse than the "35% by the river" rule of thumb for a
    // bare 9-out draw against a single pair.
    // equityVsRange(AhKh, {9s9d}, [9c,7h,2h], naiveEvaluate7) -> win 0.24646464646464647
    const res = equityVsRange(
      handOf("Ah", "Kh"),
      rangeOfCombos([["9s", "9d"]]),
      cardsOf("9c", "7h", "2h"),
      naiveEvaluate7,
    );
    expect(res.tie).toBe(0);
    expect(res.win).toBeCloseTo(0.24646464646464647, 12);
  });

  it("open-ended straight draw vs a flopped set of tens", () => {
    // Board Th 7d 2c: villain's pocket tens flop a set (using the board's
    // own Th). Hero holds 8h9c: with the board's 7 and T, hero has an
    // open-ended draw (6 or J completes), no flush protection.
    // equityVsRange(8h9c, {TsTd}, [Th,7d,2c], naiveEvaluate7) -> win 0.2585858585858586
    const res = equityVsRange(
      handOf("8h", "9c"),
      rangeOfCombos([["Ts", "Td"]]),
      cardsOf("Th", "7d", "2c"),
      naiveEvaluate7,
    );
    expect(res.tie).toBe(0);
    expect(res.win).toBeCloseTo(0.2585858585858586, 12);
  });
});

describe("equityVsRange — board-plays chops via the full exact-aggregation path", () => {
  it("wheel straight on the river board: exact win/tie/equity is a pure chop", () => {
    const res = equityVsRange(
      handOf("Kh", "Qd"),
      rangeOfCombos([["Jc", "Tc"]]),
      cardsOf("2c", "3d", "4h", "5s", "Ac"),
      naiveEvaluate7,
    );
    expect(res).toEqual({ win: 0, tie: 1, equity: 0.5 });
  });

  it("steel wheel (straight flush) on the river board: exact chop", () => {
    const res = equityVsRange(
      handOf("Ks", "Qd"),
      rangeOfCombos([["Jc", "Td"]]),
      cardsOf("Ah", "2h", "3h", "4h", "5h"),
      naiveEvaluate7,
    );
    expect(res).toEqual({ win: 0, tie: 1, equity: 0.5 });
  });

  it("full house on the river board: exact chop (kicker cannot matter)", () => {
    const res = equityVsRange(
      handOf("Kh", "Qd"),
      rangeOfCombos([["Jc", "Td"]]),
      cardsOf("7c", "7d", "7h", "2c", "2d"),
      naiveEvaluate7,
    );
    expect(res).toEqual({ win: 0, tie: 1, equity: 0.5 });
  });
});
