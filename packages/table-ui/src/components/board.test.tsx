// @vitest-environment jsdom
/** Board — five slots, always: the dealt cards plus the promise of the rest. */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BOARD_SLOTS, Board } from "./Board";
import type { CardCode } from "./cards";

afterEach(cleanup);

const FLOP: readonly CardCode[] = ["Qh", "7d", "2c"];
const TURN: readonly CardCode[] = [...FLOP, "Kd"];
const RIVER: readonly CardCode[] = [...TURN, "As"];

function board(): HTMLElement {
  const el = document.querySelector<HTMLElement>('[data-fr="board"]');
  if (el === null) throw new Error("no board rendered");
  return el;
}

function counts(): { cards: number; slots: number } {
  return {
    cards: board().querySelectorAll('[data-fr="board-card"]').length,
    slots: board().querySelectorAll('[data-fr="card-slot"]').length,
  };
}

describe("Board — slot math", () => {
  it("is five cells wide at every street", () => {
    for (const cards of [[], FLOP, TURN, RIVER]) {
      const { unmount } = render(<Board cards={cards} />);
      const { cards: dealt, slots } = counts();
      expect(dealt + slots).toBe(BOARD_SLOTS);
      unmount();
    }
  });

  it("renders 3 dealt cards and 2 empty slots on the flop", () => {
    render(<Board cards={FLOP} />);
    expect(counts()).toEqual({ cards: 3, slots: 2 });
  });

  it("renders 4 and 1 on the turn, 5 and 0 on the river", () => {
    const { unmount } = render(<Board cards={TURN} />);
    expect(counts()).toEqual({ cards: 4, slots: 1 });
    unmount();

    render(<Board cards={RIVER} />);
    expect(counts()).toEqual({ cards: 5, slots: 0 });
  });

  it("is five empty slots preflop", () => {
    render(<Board />);
    expect(counts()).toEqual({ cards: 0, slots: 5 });
  });

  it("ignores cards past the river rather than growing the board", () => {
    render(<Board cards={[...RIVER, "3h"]} />);
    expect(counts()).toEqual({ cards: 5, slots: 0 });
    expect(board().getAttribute("data-dealt")).toBe("5");
  });
});

describe("Board — the cards it shows", () => {
  it("renders each dealt card, in order, with its index for beat targeting", () => {
    render(<Board cards={TURN} />);
    const cells = Array.from(board().querySelectorAll('[data-fr="board-card"]'));
    expect(cells.map((cell) => cell.getAttribute("data-index"))).toEqual(["0", "1", "2", "3"]);
    expect(cells.map((cell) => cell.querySelector('[data-fr="card"]')?.getAttribute("aria-label"))).toEqual([
      "queen of hearts",
      "seven of diamonds",
      "two of clubs",
      "king of diamonds",
    ]);
  });

  it("passes its size down to every card and slot", () => {
    render(<Board cards={FLOP} size="hero" />);
    expect(board().getAttribute("data-size")).toBe("hero");
    for (const el of board().querySelectorAll("[data-size]")) {
      expect(el.getAttribute("data-size")).toBe("hero");
    }
  });
});

describe("Board — a11y", () => {
  it("names itself with the cards on the felt", () => {
    render(<Board cards={FLOP} />);
    expect(
      screen.getByRole("group", { name: "board: queen of hearts, seven of diamonds, two of clubs" }),
    ).toBeTruthy();
  });

  it("says so when nothing is dealt", () => {
    render(<Board />);
    expect(screen.getByRole("group", { name: "board, no cards dealt" })).toBeTruthy();
  });

  it("takes an explicit label", () => {
    render(<Board cards={RIVER} label="final board" />);
    expect(screen.getByRole("group", { name: "final board" })).toBeTruthy();
  });

  it("keeps empty slots silent", () => {
    render(<Board cards={FLOP} />);
    for (const slot of board().querySelectorAll('[data-fr="card-slot"]')) {
      expect(slot.getAttribute("aria-hidden")).toBe("true");
    }
  });
});
