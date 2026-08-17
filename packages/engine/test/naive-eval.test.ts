/**
 * Sanity checks for the TEST-ONLY naive evaluator, so the engine tests that
 * rely on it rest on verified ground.
 */

import { describe, expect, it } from "vitest";
import { cardFromString } from "@poker/core";
import { evaluate7Naive } from "./helpers";

function ev(cards: string): number {
  return evaluate7Naive(cards.split(" ").map(cardFromString));
}

describe("evaluate7Naive (test-only oracle)", () => {
  it("orders the major categories correctly (lower = stronger)", () => {
    const straightFlush = ev("5h 6h 7h 8h 9h 2c 3d");
    const quads = ev("Ac Ad Ah As Kc 2d 3h");
    const fullHouse = ev("Kc Kd Kh 2c 2d 7s 8s");
    const flush = ev("Ah Jh 9h 6h 3h Kc 2d");
    const straight = ev("4c 5d 6h 7s 8c Kd 2h");
    const trips = ev("Qc Qd Qh 7s 2c 3d 9h");
    const twoPair = ev("Jc Jd 8h 8s Ac 2d 3h");
    const pair = ev("Tc Td Ah 7s 2c 3d 9h");
    const high = ev("Ac Jd 9h 7s 5c 3d 2h");
    const chain = [straightFlush, quads, fullHouse, flush, straight, trips, twoPair, pair, high];
    for (let i = 1; i < chain.length; i++) {
      expect(chain[i - 1]!).toBeLessThan(chain[i]!);
    }
  });

  it("detects the wheel and ranks it below a six-high straight", () => {
    const wheel = ev("Ac 2d 3h 4s 5c Kd 9h");
    const sixHigh = ev("2c 3d 4h 5s 6c Kd 9h");
    expect(sixHigh).toBeLessThan(wheel);
    const sevenHigh = ev("3c 4d 5h 6s 7c Kd 9h");
    expect(sevenHigh).toBeLessThan(sixHigh);
  });

  it("breaks kicker battles", () => {
    const aceKicker = ev("Tc Td Ah 7s 2c 3d 4h");
    const kingKicker = ev("Tc Td Kh 7s 2c 3d 4h");
    expect(aceKicker).toBeLessThan(kingKicker);
  });

  it("uses the best five of seven (board plays → tie)", () => {
    const board = "Ts Js Qs Ks As";
    const a = ev(`${board} 2c 3d`);
    const b = ev(`${board} 7h 8h`);
    expect(a).toBe(b);
  });

  it("is permutation invariant", () => {
    const cards = ["Ac", "Kd", "7h", "7s", "2c", "9d", "Jh"].map(cardFromString);
    const base = evaluate7Naive(cards);
    expect(evaluate7Naive([...cards].reverse())).toBe(base);
    const rotated = [...cards.slice(3), ...cards.slice(0, 3)];
    expect(evaluate7Naive(rotated)).toBe(base);
  });

  it("prefers a flush over a straight when both are present", () => {
    // 7 cards containing both a straight and a flush.
    const both = ev("4h 5h 6h 8h Th 7c 9d"); // straight 6-T, flush T-high
    const flushOnly = ev("4h 5h 6h 8h Th 2c 9d");
    expect(both).toBe(flushOnly); // the flush is the better five
  });
});
