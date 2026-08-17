import { describe, it, expect } from "vitest";
import { evaluate7, handCategory, type HandCategory } from "../src/index";
import { cards, makeLcg, randomBoard, shuffle7 } from "./helpers";

/** Evaluate a space-separated 7-card string. */
function ev(s: string): number {
  const a = cards(s);
  if (a.length !== 7) throw new Error(`need 7 cards: "${s}"`);
  return evaluate7(a[0]!, a[1]!, a[2]!, a[3]!, a[4]!, a[5]!, a[6]!);
}

describe("spot vectors", () => {
  it("royal flush is class 1", () => {
    expect(ev("Ah Kh Qh Jh Th 2c 3d")).toBe(1);
    expect(handCategory(1)).toBe("straight-flush");
  });

  it("steel wheel (A-5 straight flush) is class 10", () => {
    expect(ev("Ah 2h 3h 4h 5h 9c Kd")).toBe(10);
    expect(handCategory(10)).toBe("straight-flush");
  });

  it("wheel straight (A-5) is class 1609, the weakest straight", () => {
    const r = ev("Ah 2c 3d 4s 5h 9c Kd");
    expect(r).toBe(1609);
    expect(handCategory(r)).toBe("straight");
    // 6-high straight beats the wheel
    expect(ev("2c 3d 4s 5h 6c 9c Kd")).toBeLessThan(r);
  });

  it("broadway straight is class 1600, the strongest straight", () => {
    expect(ev("Ah Kc Qd Js Th 2c 3d")).toBe(1600);
  });

  it("board plays: different hole cards, same board straight, same rank", () => {
    const boardPlays1 = ev("2c 3d Ah Kh Qs Jd Tc"); // hole 2c 3d
    const boardPlays2 = ev("7s 8s Ah Kh Qs Jd Tc"); // hole 7s 8s
    expect(boardPlays1).toBe(1600);
    expect(boardPlays2).toBe(1600);
  });

  it("quads with kicker battle: K kicker beats Q kicker", () => {
    const heroK = ev("Kc 2c As Ah Ad Ac 7d");
    const villQ = ev("Qc 2d As Ah Ad Ac 7d");
    expect(handCategory(heroK)).toBe("four-of-a-kind");
    expect(handCategory(villQ)).toBe("four-of-a-kind");
    expect(heroK).toBe(11); // AAAA+K is the strongest quads class
    expect(villQ).toBe(12);
    expect(heroK).toBeLessThan(villQ);
  });

  it("6-card flush picks the best 5", () => {
    const sixHearts = ev("Qh Th 8h 6h 4h 2h As"); // best 5: Q T 8 6 4 of hearts
    const exactFive = ev("Qh Th 8h 6h 4h As 2c");
    expect(handCategory(sixHearts)).toBe("flush");
    expect(sixHearts).toBe(exactFive);
  });

  it("7-card flush picks the best 5", () => {
    const sevenHearts = ev("Kh Jh 9h 7h 5h 3h 2h"); // best 5: K J 9 7 5
    const exactFive = ev("Kh Jh 9h 7h 5h 2c 4d");
    expect(handCategory(sevenHearts)).toBe("flush");
    expect(sevenHearts).toBe(exactFive);
    // upgrading a low heart to the ace strictly improves the flush
    expect(ev("Kh Jh 9h 7h 5h 3h Ah")).toBeLessThan(sevenHearts);
  });

  it("straight flush found inside a 7-card same-suit hand", () => {
    // 9h 8h 7h 6h 5h present among 7 hearts -> 9-high straight flush, class 6
    expect(ev("9h 8h 7h 6h 5h Kh 2h")).toBe(6);
  });

  it("full house beats any flush", () => {
    const weakestFullHouse = ev("2c 2d 2h 3c 3d 9s Ks"); // 2s full of 3s
    const bestAceFlush = ev("Ah Kh 9h 5h 3h Qc Jd");
    expect(handCategory(weakestFullHouse)).toBe("full-house");
    expect(weakestFullHouse).toBe(322); // weakest full-house class
    expect(handCategory(bestAceFlush)).toBe("flush");
    expect(weakestFullHouse).toBeLessThan(bestAceFlush);
  });

  it("flush beats any straight", () => {
    const worstFlush = ev("7h 5h 4h 3h 2h Kc Qd");
    expect(handCategory(worstFlush)).toBe("flush");
    expect(worstFlush).toBe(1599); // weakest flush class
    expect(worstFlush).toBeLessThan(1600); // strongest straight class
  });

  it("full house uses best trips then best pair from 7 cards", () => {
    // Two sets of trips: KKK + 999 -> KKK99, not 999KK
    const doubleTrips = ev("Kc Kd Kh 9c 9d 9h 2s");
    const explicit = ev("Kc Kd Kh 9c 9d 2s 3s");
    expect(handCategory(doubleTrips)).toBe("full-house");
    expect(doubleTrips).toBe(explicit);
  });
});

describe("permutation invariance", () => {
  it("evaluate7 is invariant under card order (1000 hands x 10 shuffles)", () => {
    const next = makeLcg(0xdecafbad);
    const board = new Uint8Array(7);
    const deck = new Uint8Array(52);
    for (let n = 0; n < 1000; n++) {
      randomBoard(next, board, deck);
      const a = [board[0]!, board[1]!, board[2]!, board[3]!, board[4]!, board[5]!, board[6]!];
      const base = evaluate7(a[0]!, a[1]!, a[2]!, a[3]!, a[4]!, a[5]!, a[6]!);
      for (let s = 0; s < 10; s++) {
        shuffle7(a, next);
        const r = evaluate7(a[0]!, a[1]!, a[2]!, a[3]!, a[4]!, a[5]!, a[6]!);
        if (r !== base) {
          expect.fail(`permutation changed rank: [${a.join(",")}] ${r} !== ${base}`);
        }
      }
    }
  });
});

describe("7-card category frequencies (seeded 2,000,000-board sample)", () => {
  it("matches published proportions within 0.1% absolute", () => {
    // Published exact 7-card counts over C(52,7) = 133,784,560.
    const expected: Record<HandCategory, number> = {
      "straight-flush": 41584,
      "four-of-a-kind": 224848,
      "full-house": 3473184,
      flush: 4047644,
      straight: 6180020,
      "three-of-a-kind": 6461620,
      "two-pair": 31433400,
      pair: 58627800,
      "high-card": 23294460,
    };
    const TOTAL = 133784560;
    const SAMPLES = 2_000_000;

    const next = makeLcg(0x5eed);
    const board = new Uint8Array(7);
    const deck = new Uint8Array(52);
    const byClass = new Uint32Array(7463);
    for (let n = 0; n < SAMPLES; n++) {
      randomBoard(next, board, deck);
      const cls = evaluate7(
        board[0]!,
        board[1]!,
        board[2]!,
        board[3]!,
        board[4]!,
        board[5]!,
        board[6]!,
      );
      byClass[cls] = byClass[cls]! + 1;
    }
    const observed: Record<string, number> = {};
    for (let cls = 1; cls <= 7462; cls++) {
      const cat = handCategory(cls);
      observed[cat] = (observed[cat] ?? 0) + byClass[cls]!;
    }
    let seen = 0;
    for (const [cat, count] of Object.entries(expected)) {
      const want = count / TOTAL;
      const got = (observed[cat] ?? 0) / SAMPLES;
      seen += observed[cat] ?? 0;
      expect(
        Math.abs(got - want),
        `${cat}: got ${(got * 100).toFixed(4)}%, want ${(want * 100).toFixed(4)}%`,
      ).toBeLessThan(0.001);
    }
    expect(seen).toBe(SAMPLES);
  }, 120_000);
});
