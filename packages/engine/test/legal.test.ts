/**
 * legalActions precision, rejection of every class of illegal input, and
 * reducer purity (input state is never mutated).
 */

import { describe, expect, it } from "vitest";
import { applyAction, initHand, legalActions, EngineError } from "../src/index";
import type { TableState } from "../src/index";
import { config, lcg, play, shuffledDeck } from "./helpers";

const deck = shuffledDeck(lcg(2024));

function threeHanded(stacks: [number, number, number] = [10000, 10000, 10000]) {
  return config({
    seats: [
      { seat: 0, stack: stacks[0] },
      { seat: 1, stack: stacks[1] },
      { seat: 2, stack: stacks[2] },
    ],
    button: 0,
    deckOrder: [...deck],
  });
}

/** Deterministic structural snapshot of a state (evaluate7 excluded). */
function snapshot(state: TableState): string {
  return JSON.stringify({ ...state, evaluate7: undefined });
}

describe("legalActions menus", () => {
  it("opening menu: fold / call / raise, never check or bet", () => {
    const { state } = initHand(threeHanded());
    expect(state.actionSeat).toBe(0);
    expect(legalActions(state)).toEqual({
      fold: true,
      call: { amount: 100 },
      raise: { minTo: 200, maxTo: 10000 },
    });
  });

  it("postflop opening menu: fold / check / bet, never call or raise", () => {
    const { state } = play(threeHanded(), [
      [0, "call"],
      [1, "call"],
      [2, "check"],
    ]);
    expect(state.actionSeat).toBe(1);
    expect(legalActions(state)).toEqual({
      fold: true,
      check: true,
      bet: { min: 100, max: 9900 },
    });
  });

  it("caps the call at the stack (all-in call for less)", () => {
    const { state } = play(threeHanded([10000, 10000, 300]), [[0, "raise", 5000], [1, "fold"]]);
    expect(state.actionSeat).toBe(2);
    expect(legalActions(state).call).toEqual({ amount: 200 });
  });

  it("returns {} once the hand is over", () => {
    const { state } = play(threeHanded(), [
      [0, "fold"],
      [1, "fold"],
    ]);
    expect(state.handOver).toBe(true);
    expect(legalActions(state)).toEqual({});
  });
});

describe("illegal inputs are rejected (state untouched)", () => {
  it("rejects out-of-turn, unknown seats, and acting after the hand", () => {
    const { state } = initHand(threeHanded());
    const before = snapshot(state);
    expect(() => applyAction(state, { seat: 1, kind: "call" })).toThrow(/out of turn/);
    expect(() => applyAction(state, { seat: 9, kind: "fold" })).toThrow(/not dealt in/);
    expect(snapshot(state)).toBe(before);

    const done = play(threeHanded(), [
      [0, "fold"],
      [1, "fold"],
    ]).state;
    expect(() => applyAction(done, { seat: 2, kind: "check" })).toThrow(/hand is over/);
  });

  it("rejects wrong kinds for the spot", () => {
    const { state } = initHand(threeHanded());
    const before = snapshot(state);
    expect(() => applyAction(state, { seat: 0, kind: "check" })).toThrow(EngineError); // facing bb
    expect(() => applyAction(state, { seat: 0, kind: "bet", amount: 300 })).toThrow(
      /facing a bet/,
    );
    expect(snapshot(state)).toBe(before);
  });

  it("rejects bad sizings", () => {
    const { state } = initHand(threeHanded());
    const before = snapshot(state);
    // Below min raise-to (and not an all-in).
    expect(() => applyAction(state, { seat: 0, kind: "raise", amount: 150 })).toThrow(
      /raise must be to between/,
    );
    // Above stack.
    expect(() => applyAction(state, { seat: 0, kind: "raise", amount: 10001 })).toThrow(
      EngineError,
    );
    // Missing / non-integer / non-positive amounts.
    expect(() => applyAction(state, { seat: 0, kind: "raise" })).toThrow(/positive integer/);
    expect(() => applyAction(state, { seat: 0, kind: "raise", amount: 200.5 })).toThrow(
      /positive integer/,
    );
    expect(() => applyAction(state, { seat: 0, kind: "raise", amount: -5 })).toThrow(
      /positive integer/,
    );
    // Stray amounts on fold/check, wrong call amount.
    expect(() => applyAction(state, { seat: 0, kind: "fold", amount: 1 })).toThrow(
      /must not carry/,
    );
    expect(() => applyAction(state, { seat: 0, kind: "call", amount: 99 })).toThrow(
      /call amount must be/,
    );
    expect(snapshot(state)).toBe(before);
  });

  it("accepts an explicit correct call amount", () => {
    const { state } = initHand(threeHanded());
    const r = applyAction(state, { seat: 0, kind: "call", amount: 100 });
    expect(r.state.actionSeat).toBe(1);
  });
});

describe("reducer purity", () => {
  it("applyAction leaves its input state byte-identical", () => {
    let { state } = initHand(threeHanded());
    const steps: Array<Parameters<typeof applyAction>[1]> = [
      { seat: 0, kind: "raise", amount: 250 },
      { seat: 1, kind: "call" },
      { seat: 2, kind: "call" },
      { seat: 1, kind: "check" },
      { seat: 2, kind: "bet", amount: 400 },
    ];
    for (const input of steps) {
      const before = snapshot(state);
      const r = applyAction(state, input);
      expect(snapshot(state)).toBe(before);
      state = r.state;
    }
  });

  it("initHand does not mutate the caller's deckOrder or seats", () => {
    const deckCopy = [...deck];
    const seats = [
      { seat: 0, stack: 10000 },
      { seat: 1, stack: 10000 },
      { seat: 2, stack: 10000 },
    ];
    const seatsCopy = JSON.parse(JSON.stringify(seats)) as typeof seats;
    initHand(config({ seats, button: 0, deckOrder: deckCopy }));
    expect(deckCopy).toEqual(deck);
    expect(seats).toEqual(seatsCopy);
  });
});
