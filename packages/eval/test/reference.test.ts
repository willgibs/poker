/**
 * Reference-evaluator sanity: the from-scratch 5-card oracle must reproduce
 * the published 5-card frequency table and the 7462 equivalence classes with
 * the standard category boundaries — and evaluate7 must agree with the
 * brute-force best-of-21 oracle on a seeded random sample.
 */

import { describe, it, expect, beforeAll } from "vitest";
import {
  buildClassMap,
  best7Ref,
  type ClassMap,
  CAT_STRAIGHT_FLUSH,
  CAT_QUADS,
  CAT_FULL_HOUSE,
  CAT_FLUSH,
  CAT_STRAIGHT,
  CAT_TRIPS,
  CAT_TWO_PAIR,
  CAT_PAIR,
  CAT_HIGH,
} from "../tablegen/reference";
import { evaluate7, handCategory, type HandCategory } from "../src/index";
import { makeLcg, randomBoard } from "./helpers";

let cm: ClassMap;

beforeAll(() => {
  cm = buildClassMap(); // full C(52,5) enumeration, ~1s
}, 120_000);

describe("reference 5-card evaluator (full C(52,5) enumeration)", () => {
  it("finds exactly 7462 equivalence classes", () => {
    expect(cm.classCount).toBe(7462);
  });

  it("reproduces the published 5-card category hand counts", () => {
    expect(cm.handCounts5[CAT_STRAIGHT_FLUSH]).toBe(40);
    expect(cm.handCounts5[CAT_QUADS]).toBe(624);
    expect(cm.handCounts5[CAT_FULL_HOUSE]).toBe(3744);
    expect(cm.handCounts5[CAT_FLUSH]).toBe(5108);
    expect(cm.handCounts5[CAT_STRAIGHT]).toBe(10200);
    expect(cm.handCounts5[CAT_TRIPS]).toBe(54912);
    expect(cm.handCounts5[CAT_TWO_PAIR]).toBe(123552);
    expect(cm.handCounts5[CAT_PAIR]).toBe(1098240);
    expect(cm.handCounts5[CAT_HIGH]).toBe(1302540);
    expect(cm.handCounts5.reduce((a, b) => a + b, 0)).toBe(2598960);
  });

  it("assigns classes in contiguous blocks matching handCategory boundaries", () => {
    const catName: Record<number, HandCategory> = {
      [CAT_STRAIGHT_FLUSH]: "straight-flush",
      [CAT_QUADS]: "four-of-a-kind",
      [CAT_FULL_HOUSE]: "full-house",
      [CAT_FLUSH]: "flush",
      [CAT_STRAIGHT]: "straight",
      [CAT_TRIPS]: "three-of-a-kind",
      [CAT_TWO_PAIR]: "two-pair",
      [CAT_PAIR]: "pair",
      [CAT_HIGH]: "high-card",
    };
    for (let cls = 1; cls <= 7462; cls++) {
      expect(handCategory(cls)).toBe(catName[cm.classCat[cls]!]);
    }
  });
});

describe("evaluate7 vs brute-force best-of-21 oracle", () => {
  it("agrees on 20,000 seeded random boards", () => {
    const next = makeLcg(0xc0ffee);
    const board = new Uint8Array(7);
    const deck = new Uint8Array(52);
    const arr = new Array<number>(7);
    for (let n = 0; n < 20_000; n++) {
      randomBoard(next, board, deck);
      for (let i = 0; i < 7; i++) arr[i] = board[i]!;
      const fast = evaluate7(arr[0]!, arr[1]!, arr[2]!, arr[3]!, arr[4]!, arr[5]!, arr[6]!);
      const slow = best7Ref(arr, cm.classOf);
      if (fast !== slow) {
        expect.fail(`mismatch on board [${arr.join(",")}]: fast=${fast} slow=${slow}`);
      }
    }
  }, 120_000);
});
