// @vitest-environment jsdom
/** PlayingCard — every rank and suit, every size, every state. */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { EmptySlot, PlayingCard } from "./PlayingCard";
import type { CardSize } from "./PlayingCard";
import { CARD_RANKS, CARD_SUITS } from "./cards";
import type { CardCode } from "./cards";

afterEach(cleanup);

const SIZES: readonly CardSize[] = ["hero", "table", "hud"];

const RANK_GLYPHS: Record<string, string> = {
  "2": "2",
  "3": "3",
  "4": "4",
  "5": "5",
  "6": "6",
  "7": "7",
  "8": "8",
  "9": "9",
  T: "10",
  J: "J",
  Q: "Q",
  K: "K",
  A: "A",
};

const RANK_WORDS: Record<string, string> = {
  "2": "two",
  "3": "three",
  "4": "four",
  "5": "five",
  "6": "six",
  "7": "seven",
  "8": "eight",
  "9": "nine",
  T: "ten",
  J: "jack",
  Q: "queen",
  K: "king",
  A: "ace",
};

const SUIT_GLYPHS: Record<string, string> = { c: "♣", d: "♦", h: "♥", s: "♠" };
const SUIT_WORDS: Record<string, string> = { c: "clubs", d: "diamonds", h: "hearts", s: "spades" };

describe("PlayingCard — the Reader face", () => {
  it("renders every rank and suit in the 52-card deck", () => {
    for (const rank of CARD_RANKS) {
      for (const suit of CARD_SUITS) {
        const { unmount } = render(<PlayingCard card={`${rank}${suit}`} />);
        const el = screen.getByRole("img", { name: `${RANK_WORDS[rank]} of ${SUIT_WORDS[suit]}` });

        expect(el.getAttribute("data-rank")).toBe(rank);
        expect(el.getAttribute("data-suit")).toBe(suit);
        expect(el.querySelector(".fr-card__rank")?.textContent).toBe(RANK_GLYPHS[rank]);
        expect(el.querySelector(".fr-card__suit")?.textContent).toBe(SUIT_GLYPHS[suit]);
        unmount();
      }
    }
  });

  it("prints ten as '10' but says 'ten'", () => {
    render(<PlayingCard card="Ts" />);
    expect(
      screen.getByRole("img", { name: "ten of spades" }).querySelector(".fr-card__rank")?.textContent,
    ).toBe("10");
  });

  it("puts the rank top-left and the suit bottom-right, and mirrors nothing", () => {
    const { container } = render(<PlayingCard card="As" />);
    const face = container.querySelector('[data-fr="card"]');
    expect(face?.querySelectorAll(".fr-card__rank")).toHaveLength(1);
    expect(face?.querySelectorAll(".fr-card__suit")).toHaveLength(1);
    expect(face?.children).toHaveLength(2);
  });

  it("renders at all three sizes", () => {
    for (const size of SIZES) {
      const { unmount } = render(<PlayingCard card="Qh" size={size} />);
      expect(screen.getByRole("img", { name: "queen of hearts" }).getAttribute("data-size")).toBe(size);
      unmount();
    }
  });

  it("defaults to the table size", () => {
    render(<PlayingCard card="2c" />);
    expect(screen.getByRole("img", { name: "two of clubs" }).getAttribute("data-size")).toBe("table");
  });

  it("renders a card back when face down, at every size, hiding the card", () => {
    for (const size of SIZES) {
      const { container, unmount } = render(<PlayingCard card="As" faceDown size={size} />);
      const el = screen.getByRole("img", { name: "face-down card" });
      expect(el.getAttribute("data-face")).toBe("down");
      expect(el.getAttribute("data-size")).toBe(size);
      expect(el.className).toContain("fr-card--back");
      expect(container.textContent).toBe("");
      unmount();
    }
  });

  it("renders a back with no card at all", () => {
    render(<PlayingCard />);
    expect(screen.getByRole("img", { name: "face-down card" }).getAttribute("data-face")).toBe("down");
  });

  it("falls back to a back for an unparseable card string, instead of throwing", () => {
    render(<PlayingCard card={"Zx" as CardCode} />);
    expect(screen.getByRole("img", { name: "face-down card" })).toBeTruthy();
  });

  it("marks mucked cards, face up and face down", () => {
    const { unmount } = render(<PlayingCard card="Js" mucked />);
    expect(screen.getByRole("img", { name: "jack of spades, mucked" }).getAttribute("data-mucked")).toBe(
      "true",
    );
    unmount();

    render(<PlayingCard faceDown mucked />);
    expect(screen.getByRole("img", { name: "face-down card, mucked" }).getAttribute("data-mucked")).toBe(
      "true",
    );
  });

  it("does not mark a live card as mucked", () => {
    render(<PlayingCard card="Js" />);
    expect(screen.getByRole("img", { name: "jack of spades" }).getAttribute("data-mucked")).toBeNull();
  });

  it("keeps the consumer's extra class alongside its own", () => {
    const { container } = render(<PlayingCard card="As" className="seat-slot-1" />);
    const el = container.querySelector('[data-fr="card"]');
    expect(el?.className).toContain("fr-card");
    expect(el?.className).toContain("seat-slot-1");
  });
});

describe("EmptySlot", () => {
  it("renders a silent slot at every size", () => {
    for (const size of SIZES) {
      const { container, unmount } = render(<EmptySlot size={size} />);
      const slot = container.querySelector('[data-fr="card-slot"]');
      expect(slot?.getAttribute("data-size")).toBe(size);
      expect(slot?.getAttribute("aria-hidden")).toBe("true");
      unmount();
    }
  });

  it("becomes an image with a name when one is given", () => {
    render(<EmptySlot label="river, not yet dealt" />);
    expect(screen.getByRole("img", { name: "river, not yet dealt" }).getAttribute("aria-hidden")).toBeNull();
  });
});
