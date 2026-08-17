import { describe, expect, it } from "vitest";
import {
  DECK_SIZE,
  RANK,
  SUIT,
  cardFromString,
  cardToString,
  freshDeck,
  isCard,
  makeCard,
  rankOf,
  suitOf,
} from "./cards";

describe("card encoding", () => {
  it("round-trips all 52 cards through string form", () => {
    const seen = new Set<string>();
    for (let c = 0; c < DECK_SIZE; c++) {
      const s = cardToString(c);
      expect(s).toHaveLength(2);
      expect(cardFromString(s)).toBe(c);
      seen.add(s);
    }
    expect(seen.size).toBe(DECK_SIZE);
  });

  it("matches the documented encoding on known cards", () => {
    expect(cardToString(0)).toBe("2c");
    expect(cardToString(33)).toBe("Td");
    expect(cardToString(51)).toBe("As");
    expect(cardFromString("As")).toBe(51);
    expect(cardFromString("2c")).toBe(0);
    expect(makeCard(RANK.ACE, SUIT.SPADE)).toBe(51);
    expect(makeCard(RANK.TEN, SUIT.DIAMOND)).toBe(33);
    expect(rankOf(51)).toBe(RANK.ACE);
    expect(suitOf(51)).toBe(SUIT.SPADE);
    expect(rankOf(0)).toBe(RANK.TWO);
    expect(suitOf(0)).toBe(SUIT.CLUB);
  });

  it("makeCard inverts rankOf/suitOf for every card", () => {
    for (let c = 0; c < DECK_SIZE; c++) {
      expect(makeCard(rankOf(c), suitOf(c))).toBe(c);
    }
  });

  it("rejects invalid card strings", () => {
    for (const bad of ["", "A", "AsK", "Ax", "1c", "as", "aS", "AS", "A♠", "Xx", "T "]) {
      expect(() => cardFromString(bad), bad).toThrow(RangeError);
    }
  });

  it("rejects invalid makeCard / cardToString inputs", () => {
    expect(() => makeCard(13, 0)).toThrow(RangeError);
    expect(() => makeCard(-1, 0)).toThrow(RangeError);
    expect(() => makeCard(0, 4)).toThrow(RangeError);
    expect(() => makeCard(0, -1)).toThrow(RangeError);
    expect(() => makeCard(1.5, 0)).toThrow(RangeError);
    expect(() => cardToString(-1)).toThrow(RangeError);
    expect(() => cardToString(52)).toThrow(RangeError);
    expect(() => cardToString(3.5)).toThrow(RangeError);
    expect(isCard(NaN)).toBe(false);
    expect(isCard(51)).toBe(true);
  });
});

describe("freshDeck", () => {
  it("returns 0..51 ascending", () => {
    const deck = freshDeck();
    expect(deck).toHaveLength(DECK_SIZE);
    for (let i = 0; i < DECK_SIZE; i++) expect(deck[i]).toBe(i);
  });

  it("returns a fresh array each call", () => {
    const a = freshDeck();
    const b = freshDeck();
    expect(a).not.toBe(b);
    a[0] = 99;
    expect(b[0]).toBe(0);
  });
});
