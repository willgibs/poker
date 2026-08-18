/**
 * Evaluator edge vectors, additive to evaluate7.test.ts: the full straight
 * ladder (all ten class boundaries, not just wheel/broadway), a "quad rank
 * always dominates kicker" sweep across every adjacent rank pair, and
 * board-plays chops (identical 7-card classes for different hole cards)
 * for quads, wheel, steel wheel, and full house.
 *
 * All vectors are pinned by running `evaluate7` (the real evaluator, per
 * the project's own path — no naive oracle here, matching evaluate7.test.ts
 * convention) offline against hand-constructed 7-card hands and checking
 * the result against the documented class boundaries in category.ts.
 */
import { describe, it, expect } from "vitest";
import { evaluate7, handCategory } from "../src/index";
import { cards } from "./helpers";

/** Evaluate a space-separated 7-card string. */
function ev(s: string): number {
  const a = cards(s);
  if (a.length !== 7) throw new Error(`need 7 cards: "${s}"`);
  return evaluate7(a[0]!, a[1]!, a[2]!, a[3]!, a[4]!, a[5]!, a[6]!);
}

const RC = "23456789TJQKA"; // rank char by rank int 0..12
const SUITS = "cdhs";

/**
 * A rainbow straight with high card `hi` (rank int 4..12, i.e. 6-high
 * through A-high; wheel/broadway are covered by evaluate7.test.ts already).
 * The two extra cards duplicate the window's own two lowest ranks in unused
 * suits: this can never extend the straight (no new ranks introduced) and
 * can never risk a flush (no suit reaches 3 of the same rank, let alone 5
 * of the same suit).
 */
function straightHand(hi: number): string {
  const ranks = [hi - 4, hi - 3, hi - 2, hi - 1, hi];
  const suits = [0, 1, 2, 3, 0];
  const main = ranks.map((r, i) => RC[r]! + SUITS[suits[i]!]!);
  const blank1 = RC[ranks[0]!]! + SUITS[1]!;
  const blank2 = RC[ranks[1]!]! + SUITS[2]!;
  return [...main, blank1, blank2].join(" ");
}

describe("straight ladder — all ten class boundaries (1600..1609)", () => {
  it("6-high through A-high land on the exact expected class (broadway/wheel covered elsewhere)", () => {
    for (let hi = 4; hi <= 12; hi++) {
      const cls = ev(straightHand(hi));
      const expected = 1600 + (12 - hi);
      expect(cls, `${RC[hi]}-high straight`).toBe(expected);
      expect(handCategory(cls)).toBe("straight");
    }
  });

  it("is strictly monotone: a higher straight always beats a lower one", () => {
    let prev = -1;
    for (let hi = 4; hi <= 12; hi++) {
      const cls = ev(straightHand(hi));
      if (prev >= 0) expect(cls).toBeLessThan(prev);
      prev = cls;
    }
  });
});

describe("quads-over-quads — quad rank always dominates kicker", () => {
  /** Quad `r` (all four suits) plus a forced kicker of exactly `kickerRank` (three copies, so the 7th slot's max is pinned). */
  function quadHand(r: number, kickerRank: number): string {
    const quad = [0, 1, 2, 3].map((s) => RC[r]! + SUITS[s]!);
    const kick = [0, 1, 2].map((s) => RC[kickerRank]! + SUITS[s]!);
    return [...quad, ...kick].join(" ");
  }
  const worstKicker = (r: number): number => (r === 0 ? 1 : 0);
  const bestKicker = (r: number): number => (r === 12 ? 11 : 12);

  it("quad rank AAAA with its best kicker is the strongest quad class (11)", () => {
    expect(ev(quadHand(12, bestKicker(12)))).toBe(11);
  });

  it("quad rank 2222 with its worst kicker is the weakest quad class (166), still beating any full house", () => {
    const cls = ev(quadHand(0, worstKicker(0)));
    expect(cls).toBe(166);
    expect(handCategory(cls)).toBe("four-of-a-kind");
    expect(cls).toBeLessThan(167); // 167 = strongest full-house class boundary
  });

  it("every quad rank at its worst kicker still beats the next rank down at its best kicker", () => {
    // If kicker could ever outweigh quad rank, this chain would break somewhere.
    for (let r = 12; r >= 1; r--) {
      const higherWorst = ev(quadHand(r, worstKicker(r)));
      const lowerBest = ev(quadHand(r - 1, bestKicker(r - 1)));
      expect(higherWorst, `rank ${RC[r]} worst-kicker vs rank ${RC[r - 1]} best-kicker`).toBeLessThan(
        lowerBest,
      );
    }
  });
});

describe("board-plays chops — identical 7-card classes across different hole cards", () => {
  it("quads on board with a shared kicker: both hands chop", () => {
    // Board As Ah Ad Ac Kd: neither hole pair beats the board's own K kicker.
    const a = ev("2c 3d As Ah Ad Ac Kd");
    const b = ev("5h 6h As Ah Ad Ac Kd");
    expect(a).toBe(b);
    expect(handCategory(a)).toBe("four-of-a-kind");
  });

  it("wheel straight on board: both non-improving hands chop at class 1609", () => {
    const a = ev("Kh Qd 2c 3d 4h 5s Ac");
    const b = ev("Jc Tc 2c 3d 4h 5s Ac");
    expect(a).toBe(1609);
    expect(b).toBe(1609);
    expect(handCategory(a)).toBe("straight");
  });

  it("steel wheel (straight flush) on board: both non-improving hands chop at class 10", () => {
    const a = ev("Ks Qd Ah 2h 3h 4h 5h");
    const b = ev("Jc Td Ah 2h 3h 4h 5h");
    expect(a).toBe(10);
    expect(b).toBe(10);
    expect(handCategory(a)).toBe("straight-flush");
  });

  it("full house on board: kicker is irrelevant, both hands chop", () => {
    const a = ev("Kh Qd 7c 7d 7h 2c 2d");
    const b = ev("Jc Td 7c 7d 7h 2c 2d");
    expect(a).toBe(b);
    expect(handCategory(a)).toBe("full-house");
  });
});
