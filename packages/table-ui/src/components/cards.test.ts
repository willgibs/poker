import { describe, expect, it } from "vitest";
import { RANK_CHARS, SUIT_CHARS } from "@poker/core";
import { CARD_RANKS, CARD_SUITS, cardLabel, readCard } from "./cards";

describe("the card alphabet", () => {
  it("is character-identical to @poker/core — the renderer never invents a card", () => {
    expect(CARD_RANKS.join("")).toBe(RANK_CHARS);
    expect(CARD_SUITS.join("")).toBe(SUIT_CHARS);
  });

  it("covers the whole 52-card deck", () => {
    expect(CARD_RANKS.length * CARD_SUITS.length).toBe(52);
  });
});

describe("readCard", () => {
  it("reads rank, suit, glyphs and label", () => {
    expect(readCard("As")).toEqual({
      rank: "A",
      suit: "s",
      rankGlyph: "A",
      suitGlyph: "♠",
      label: "ace of spades",
    });
  });

  it("prints ten as 10 and speaks it as ten", () => {
    const ten = readCard("Td");
    expect(ten?.rankGlyph).toBe("10");
    expect(ten?.label).toBe("ten of diamonds");
  });

  it("rejects anything that is not exactly rank + suit", () => {
    for (const bad of ["", "A", "Ass", "sA", "Zs", "Ax", "10s", " As"]) {
      expect(readCard(bad)).toBeUndefined();
    }
  });

  it("is case sensitive — the canonical form is the only form", () => {
    expect(readCard("as")).toBeUndefined();
    expect(readCard("AS")).toBeUndefined();
  });
});

describe("cardLabel", () => {
  it("names every card in the deck exactly once", () => {
    const labels = new Set<string>();
    for (const rank of CARD_RANKS) {
      for (const suit of CARD_SUITS) {
        const label = cardLabel(`${rank}${suit}`);
        expect(label).toBeDefined();
        labels.add(label ?? "");
      }
    }
    expect(labels.size).toBe(52);
  });

  it("returns undefined for a non-card", () => {
    expect(cardLabel("nope")).toBeUndefined();
  });
});
