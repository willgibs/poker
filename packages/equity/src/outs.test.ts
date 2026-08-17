import { describe, expect, it } from "vitest";
import { cardToString } from "@poker/core";
import { naiveEvaluate7 } from "../test/naive-eval";
import { cardsOf, handOf } from "../test/util";
import { outs } from "./outs";

/** Sorted human-readable form for readable assertion diffs. */
function names(cards: readonly number[]): string[] {
  return cards.map(cardToString);
}

describe("outs — classic counts", () => {
  it("flush draw + gutshot + two overcards on the turn = 18 outs", () => {
    // Hero AhKh on Qh Jh 7c 2d: 9 hearts, 3 offsuit tens (broadway),
    // 3 aces, 3 kings. Board-pairing sevens/deuces are NOT outs.
    const res = outs(handOf("Ah", "Kh"), cardsOf("Qh", "Jh", "7c", "2d"), naiveEvaluate7);
    const expected = cardsOf(
      "2h", "3h", "4h", "5h", "6h", "7h", "8h", "9h", "Th", // hearts
      "Tc", "Td", "Ts", // broadway straight
      "Ac", "Ad", "As", // pair of aces beats top pair
      "Kc", "Kd", "Ks", // pair of kings beats top pair
    ).sort((a, b) => a - b);
    expect(names(res)).toEqual(names(expected));
    expect(res).toHaveLength(18);
  });

  it("open-ended straight draw on the flop = 8 outs", () => {
    // Hero 8c9d on Td Jh 2c: four queens and four sevens.
    const res = outs(handOf("8c", "9d"), cardsOf("Td", "Jh", "2c"), naiveEvaluate7);
    const expected = cardsOf("Qc", "Qd", "Qh", "Qs", "7c", "7d", "7h", "7s").sort((a, b) => a - b);
    expect(names(res)).toEqual(names(expected));
  });

  it("two overcards on a dry flop = 6 outs (board-pairing cards excluded)", () => {
    // Hero AcKc on 2d 7h 9s: only the three aces and three kings.
    const res = outs(handOf("Ac", "Kc"), cardsOf("2d", "7h", "9s"), naiveEvaluate7);
    const expected = cardsOf("Ad", "Ah", "As", "Kd", "Kh", "Ks").sort((a, b) => a - b);
    expect(names(res)).toEqual(names(expected));
  });

  it("flush draw on the flop = 9 outs", () => {
    // Hero 5h6h on Ah Kh 2c: every remaining heart, nothing else
    // (pairing the 5 or 6 does not beat top pair).
    const res = outs(handOf("5h", "6h"), cardsOf("Ah", "Kh", "2c"), naiveEvaluate7);
    const expected = cardsOf("2h", "3h", "4h", "7h", "8h", "9h", "Th", "Jh", "Qh").sort(
      (a, b) => a - b,
    );
    expect(names(res)).toEqual(names(expected));
  });

  it("underpair set-mining on the turn = 2 outs", () => {
    // Hero 5c5d on Kh 9s 2c 4d: only the two remaining fives.
    const res = outs(handOf("5c", "5d"), cardsOf("Kh", "9s", "2c", "4d"), naiveEvaluate7);
    const expected = cardsOf("5h", "5s");
    expect(names(res)).toEqual(names(expected));
  });
});

describe("outs — not drawing", () => {
  it("returns [] when hero already beats the benchmark (flopped set)", () => {
    const res = outs(handOf("Qh", "Qs"), cardsOf("Qc", "7d", "2s"), naiveEvaluate7);
    expect(res).toEqual([]);
  });

  it("returns [] for an overpair on a dry board", () => {
    const res = outs(handOf("Ah", "Ad"), cardsOf("9c", "5d", "2s"), naiveEvaluate7);
    expect(res).toEqual([]);
  });
});

describe("outs — shape and validation", () => {
  it("returns ascending, duplicate-free live cards", () => {
    const res = outs(handOf("Ah", "Kh"), cardsOf("Qh", "Jh", "7c", "2d"), naiveEvaluate7);
    for (let i = 0; i + 1 < res.length; i++) {
      expect(res[i] ?? -1).toBeLessThan(res[i + 1] ?? -1);
    }
  });

  it("is a pure function (same input, same output)", () => {
    const hero = handOf("8c", "9d");
    const board = cardsOf("Td", "Jh", "2c");
    expect(outs(hero, board, naiveEvaluate7)).toEqual(outs(hero, board, naiveEvaluate7));
  });

  it("rejects boards that are not 3 or 4 cards, and duplicate cards", () => {
    expect(() => outs(handOf("Ah", "Kh"), cardsOf("Qh", "Jh"), naiveEvaluate7)).toThrow(RangeError);
    expect(() =>
      outs(handOf("Ah", "Kh"), cardsOf("Qh", "Jh", "7c", "2d", "3s"), naiveEvaluate7),
    ).toThrow(RangeError);
    expect(() => outs(handOf("Ah", "Kh"), cardsOf("Ah", "Jh", "7c"), naiveEvaluate7)).toThrow(
      RangeError,
    );
  });
});
