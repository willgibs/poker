import { describe, expect, it } from "vitest";
import { streamFor } from "@poker/rng";
import { naiveEvaluate7 } from "./naive-eval";
import { cardsOf } from "./util";

const ev = (...names: string[]): number => naiveEvaluate7(cardsOf(...names));

describe("naiveEvaluate7 (trust anchor for all equity tests)", () => {
  it("orders the nine hand categories correctly", () => {
    const straightFlush = ev("9s", "8s", "7s", "6s", "5s", "2c", "3d");
    const quads = ev("9s", "9h", "9d", "9c", "5s", "2c", "3d");
    const fullHouse = ev("9s", "9h", "9d", "5c", "5s", "2c", "3d");
    const flush = ev("Ks", "Js", "8s", "6s", "3s", "2c", "3d");
    const straight = ev("9s", "8h", "7d", "6c", "5s", "2c", "3d");
    const trips = ev("9s", "9h", "9d", "6c", "5s", "2c", "Kd");
    const twoPair = ev("9s", "9h", "5d", "5c", "Ks", "2c", "3d");
    const pair = ev("9s", "9h", "Ad", "6c", "5s", "2c", "Kd");
    const high = ev("As", "Kh", "9d", "6c", "5s", "2c", "3d");
    const ordered = [straightFlush, quads, fullHouse, flush, straight, trips, twoPair, pair, high];
    for (let i = 0; i + 1 < ordered.length; i++) {
      expect(ordered[i], `category ${i} vs ${i + 1}`).toBeLessThan(ordered[i + 1] ?? NaN);
    }
  });

  it("ranks straights by high card, wheel lowest", () => {
    const broadway = ev("As", "Kh", "Qd", "Jc", "Ts", "2c", "7d");
    const sixHigh = ev("6s", "5h", "4d", "3c", "2s", "9c", "Jd");
    const wheel = ev("As", "5h", "4d", "3c", "2s", "9c", "Jd");
    expect(broadway).toBeLessThan(sixHigh);
    expect(sixHigh).toBeLessThan(wheel);
  });

  it("breaks kicker battles correctly", () => {
    expect(ev("As", "Kh", "Qd", "Jc", "9s", "2c", "3d")).toBeLessThan(
      ev("As", "Kh", "Qd", "Jc", "8s", "2c", "3d"),
    );
    // pair of aces, K kicker vs Q kicker
    expect(ev("As", "Ah", "Kd", "7c", "5s", "2c", "3d")).toBeLessThan(
      ev("As", "Ah", "Qd", "7c", "5s", "2c", "3d"),
    );
  });

  it("gives equal hands equal values regardless of suits", () => {
    expect(ev("Ah", "Kd", "Qc", "Js", "9h", "2c", "3d")).toBe(
      ev("Ad", "Kh", "Qs", "Jc", "9d", "2h", "3s"),
    );
  });

  it("uses the best five of seven (kicker from hand over board)", () => {
    // Board pair of nines; AK beats AQ as side cards.
    const ak = ev("As", "Kh", "9d", "9c", "7s", "5c", "2d");
    const aq = ev("As", "Qh", "9d", "9c", "7s", "5c", "2d");
    expect(ak).toBeLessThan(aq);
  });

  it("is permutation invariant", () => {
    const cards = cardsOf("9s", "8s", "7s", "6s", "5s", "2c", "3d");
    const expected = naiveEvaluate7(cards);
    const stream = streamFor(20260817, "naive/perm");
    for (let i = 0; i < 25; i++) {
      const shuffled = stream.shuffle([...cards]);
      expect(naiveEvaluate7(shuffled)).toBe(expected);
    }
  });

  it("rejects malformed input", () => {
    expect(() => naiveEvaluate7(cardsOf("As", "Kh"))).toThrow(RangeError);
    expect(() => naiveEvaluate7([...cardsOf("As", "Kh", "Qd", "Jc", "9s", "2c"), 52])).toThrow(
      RangeError,
    );
    expect(() => naiveEvaluate7(cardsOf("As", "Kh", "Qd", "Jc", "9s", "2c", "As"))).toThrow(
      RangeError,
    );
  });
});
