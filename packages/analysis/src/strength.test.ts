import { evaluate7 } from "@poker/eval";
import { streamFor } from "@poker/rng";
import { describe, expect, it } from "vitest";
import { HAND_CATEGORY, categoryOf, comboStrengths, createStrengthCache, handRank } from "./strength";
import { cards } from "./test-helpers";

function rank(...names: string[]): number {
  return handRank(cards(...names));
}

describe("handRank", () => {
  it("orders the categories correctly", () => {
    const straightFlush = rank("9h", "8h", "7h", "6h", "5h");
    const quads = rank("9h", "9s", "9d", "9c", "5h");
    const boat = rank("9h", "9s", "9d", "5c", "5h");
    const flush = rank("Ah", "Jh", "8h", "5h", "2h");
    const straight = rank("9h", "8s", "7d", "6c", "5h");
    const trips = rank("9h", "9s", "9d", "Kc", "5h");
    const twoPair = rank("9h", "9s", "5d", "5c", "Kh");
    const pair = rank("9h", "9s", "Kd", "7c", "5h");
    const high = rank("Ah", "Js", "8d", "5c", "2h");
    const ordered = [high, pair, twoPair, trips, straight, flush, boat, quads, straightFlush];
    for (let i = 1; i < ordered.length; i++) {
      expect(ordered[i]).toBeGreaterThan(ordered[i - 1] as number);
    }
  });

  it("labels categories", () => {
    expect(categoryOf(rank("9h", "8h", "7h", "6h", "5h"))).toBe(HAND_CATEGORY.STRAIGHT_FLUSH);
    expect(categoryOf(rank("Ah", "Jh", "8h", "5h", "2h"))).toBe(HAND_CATEGORY.FLUSH);
    expect(categoryOf(rank("9h", "9s", "Kd", "7c", "5h"))).toBe(HAND_CATEGORY.PAIR);
  });

  it("reads the wheel as a five-high straight", () => {
    const wheel = rank("Ah", "2s", "3d", "4c", "5h");
    const sixHigh = rank("2s", "3d", "4c", "5h", "6d");
    expect(categoryOf(wheel)).toBe(HAND_CATEGORY.STRAIGHT);
    expect(wheel).toBeLessThan(sixHigh);
    // ...and below any pair-or-better it should still beat ace-high.
    expect(wheel).toBeGreaterThan(rank("Ah", "Ks", "9d", "7c", "3h"));
  });

  it("picks the best five from six and seven cards", () => {
    // The sixth and seventh cards are irrelevant: same best five, same rank.
    const five = rank("Ah", "Ad", "Kh", "Ks", "Qc");
    const seven = rank("Ah", "Ad", "Kh", "Ks", "Qc", "3d", "2s");
    expect(seven).toBe(five);
    // A seventh card that improves the hand must raise the rank.
    expect(rank("Ah", "Ad", "Kh", "Ks", "Qc", "3d", "As")).toBeGreaterThan(five);
  });

  it("prefers the straight flush over the flush inside seven cards", () => {
    const r = rank("9h", "8h", "7h", "6h", "5h", "Ah", "Kh");
    expect(categoryOf(r)).toBe(HAND_CATEGORY.STRAIGHT_FLUSH);
  });

  it("rejects hands outside 5-7 cards", () => {
    expect(() => handRank(cards("Ah", "Kh", "Qh", "Jh"))).toThrow(RangeError);
    expect(() => handRank([0, 1, 2, 3, 4, 5, 6, 7])).toThrow(RangeError);
  });

  it("agrees with @poker/eval's ordering on random 7-card hands", () => {
    // The two evaluators use opposite conventions (eval: lower = stronger),
    // so agreement means the comparison flips consistently.
    const stream = streamFor("analysis/strength/agreement", "v1");
    const deck: number[] = [];
    for (let i = 0; i < 52; i++) deck.push(i);
    let compared = 0;
    for (let trial = 0; trial < 400; trial++) {
      stream.shuffle(deck);
      const a = deck.slice(0, 7);
      const b = deck.slice(7, 14);
      const evalA = evaluate7(a[0]!, a[1]!, a[2]!, a[3]!, a[4]!, a[5]!, a[6]!);
      const evalB = evaluate7(b[0]!, b[1]!, b[2]!, b[3]!, b[4]!, b[5]!, b[6]!);
      const mineA = handRank(a);
      const mineB = handRank(b);
      expect(Math.sign(mineA - mineB)).toBe(Math.sign(evalB - evalA));
      compared++;
    }
    expect(compared).toBe(400);
  });
});

describe("comboStrengths", () => {
  const board = cards("Ah", "Kd", "7c");

  it("scores every unblocked combo in [0, 1] and blocks board cards", () => {
    const table = comboStrengths(board);
    let live = 0;
    for (let i = 0; i < table.length; i++) {
      const v = table[i] as number;
      if (v < 0) continue;
      live++;
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    // C(49,2) combos survive a three-card board.
    expect(live).toBe((49 * 48) / 2);
  });

  it("ranks a set above two pair above top pair above air", () => {
    const table = comboStrengths(board);
    const at = (a: string, b: string): number => {
      const [x, y] = cards(a, b);
      const lo = Math.min(x as number, y as number);
      const hi = Math.max(x as number, y as number);
      let index = 0;
      for (let p = 0; p < lo; p++) index += 51 - p;
      return table[index + (hi - lo - 1)] as number;
    };
    const set = at("7h", "7s");
    const twoPair = at("As", "Ks");
    const topPair = at("Ac", "Qd");
    const air = at("5s", "3d");
    expect(set).toBeGreaterThan(twoPair);
    expect(twoPair).toBeGreaterThan(topPair);
    expect(topPair).toBeGreaterThan(air);
  });

  it("honours extra dead cards", () => {
    const withHero = comboStrengths(board, cards("Qs", "Jh"));
    const heroCombo = comboStrengths(board);
    expect(withHero.length).toBe(heroCombo.length);
    let blockedExtra = 0;
    for (let i = 0; i < withHero.length; i++) {
      if ((withHero[i] as number) < 0 && (heroCombo[i] as number) >= 0) blockedExtra++;
    }
    // C(49,2) live combos become C(47,2) once two more cards are dead.
    expect(blockedExtra).toBe((49 * 48) / 2 - (47 * 46) / 2);
  });

  it("rejects boards outside 3-5 cards", () => {
    expect(() => comboStrengths(cards("Ah", "Kd"))).toThrow(RangeError);
  });

  it("memoizes by board through the cache", () => {
    const cache = createStrengthCache();
    const first = cache(board);
    const second = cache([...board]);
    expect(second).toBe(first);
    expect(cache(cards("Ah", "Kd", "7c", "2s"))).not.toBe(first);
  });
});
