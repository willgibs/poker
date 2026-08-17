/**
 * Scripted unit hands: limped pot, raise/3-bet/fold, BB walk, check-down to
 * showdown, split pot with an odd cent. Every full log must satisfy
 * @poker/history's structural validator.
 */

import { describe, expect, it } from "vitest";
import { validateEvents } from "@poker/history";
import { cardFromString } from "@poker/core";
import { auditChips, legalActions, potsOf } from "../src/index";
import { config, lcg, ofType, play, riggedDeck, seat, shuffledDeck, totalStacks } from "./helpers";

const deck = shuffledDeck(lcg(7));

describe("limped pot", () => {
  it("advances streets after limps, dealing the board sequentially (no burns)", () => {
    const seats = [0, 1, 2, 3].map((s) => ({ seat: s, stack: 10000 }));
    const cfg = config({ seats, button: 0, deckOrder: [...deck] });
    const { state, events } = play(cfg, [
      [3, "call"], // UTG limps
      [0, "call"],
      [1, "call"], // SB completes (50 more)
      [2, "check"], // BB option
    ]);

    expect(state.street).toBe("flop");
    // 4 seats × 2 hole cards = 8; flop is deck[8..10] — no burn.
    expect([...state.board]).toEqual([deck[8], deck[9], deck[10]]);
    expect(state.currentBet).toBe(0);
    expect(state.minRaise).toBe(100);
    // Postflop action starts left of the button.
    expect(state.actionSeat).toBe(1);
    for (const s of state.seats) {
      expect(s.committedStreet).toBe(0);
      expect(s.committedTotal).toBe(100);
    }
    const calls = ofType(events, "act").filter((a) => a.kind === "call");
    expect(calls.map((a) => a.amount)).toEqual([100, 100, 50]);
    // Live pot view mid-hand: one 400¢ pot everyone contests.
    expect(potsOf(state)).toEqual([{ amount: 400, eligible: [0, 1, 2, 3] }]);
    auditChips(state, 40000);
  });

  it("gives the big blind its option (raise) after limps", () => {
    const seats = [0, 1, 2].map((s) => ({ seat: s, stack: 10000 }));
    const cfg = config({ seats, button: 0, deckOrder: [...deck] });
    const { state } = play(cfg, [
      [0, "call"],
      [1, "call"],
    ]);
    expect(state.actionSeat).toBe(2);
    const menu = legalActions(state);
    expect(menu.check).toBe(true);
    expect(menu.call).toBeUndefined();
    expect(menu.raise).toEqual({ minTo: 200, maxTo: 10000 });
  });
});

describe("raise / 3-bet / fold", () => {
  it("awards the pot uncontested with no showdown and correct nets", () => {
    const seats = [1, 4, 7].map((s) => ({ seat: s, stack: 20000 }));
    // button 1 → sb 4, bb 7; first to act preflop is the button (3-handed).
    const cfg = config({ seats, button: 1, deckOrder: [...deck] });
    const { state, events } = play(cfg, [
      [1, "raise", 300],
      [4, "raise", 1000], // 3-bet
      [7, "fold"],
      [1, "fold"],
    ]);

    expect(state.handOver).toBe(true);
    expect(ofType(events, "showdown")).toHaveLength(0);
    expect(ofType(events, "board")).toHaveLength(0);
    expect(ofType(events, "pot")).toEqual([{ t: "pot", potIndex: 0, seat: 4, amount: 1400 }]);
    const end = ofType(events, "end")[0]!;
    expect(end.net).toEqual([
      { seat: 1, net: -300 },
      { seat: 4, net: 400 },
      { seat: 7, net: -100 },
    ]);
    expect(totalStacks(state)).toBe(60000);
    expect(validateEvents(events).ok).toBe(true);
    auditChips(state, 60000);
  });

  it("enforces min-raise sizing on the 3-bet", () => {
    const seats = [1, 4, 7].map((s) => ({ seat: s, stack: 20000 }));
    const cfg = config({ seats, button: 1, deckOrder: [...deck] });
    const { state } = play(cfg, [[1, "raise", 300]]);
    expect(state.actionSeat).toBe(4);
    // Raise was 200 on top → next min raise-to is 500.
    expect(legalActions(state).raise).toEqual({ minTo: 500, maxTo: 20000 });
  });
});

describe("BB walk", () => {
  it("ends the hand the moment the SB folds; the BB never acts", () => {
    const seats = [3, 6, 9].map((s) => ({ seat: s, stack: 5000 }));
    const cfg = config({ seats, button: 3, deckOrder: [...deck] });
    const { state, events } = play(cfg, [
      [3, "fold"],
      [6, "fold"],
    ]);
    expect(state.handOver).toBe(true);
    expect(ofType(events, "showdown")).toHaveLength(0);
    // BB wins its own blind back plus the SB's 50.
    expect(ofType(events, "pot")).toEqual([{ t: "pot", potIndex: 0, seat: 9, amount: 150 }]);
    expect(seat(state, 9).stack).toBe(5050);
    const end = ofType(events, "end")[0]!;
    expect(end.net).toEqual([
      { seat: 3, net: 0 },
      { seat: 6, net: -50 },
      { seat: 9, net: 50 },
    ]);
    expect(validateEvents(events).ok).toBe(true);
    auditChips(state, 15000);
  });
});

describe("check-down to showdown", () => {
  // Deal order (button 0): seat 1 first. Rig seat 1 with aces, seat 2 with a
  // dominated hand; board bricks. Seat 1 (SB) wins.
  const rigged = riggedDeck([
    "Ah", "Ad", // seat 1 (sb)
    "Kc", "Qd", // seat 2 (bb)
    "2c", "7d", // seat 0 (button)
    "9s", "5h", "3c", // flop
    "8d", // turn
    "2h", // river
  ]);

  it("checks down, reveals first left of the button (no aggressor), awards the best hand", () => {
    const seats = [0, 1, 2].map((s) => ({ seat: s, stack: 10000 }));
    const cfg = config({ seats, button: 0, deckOrder: rigged });
    const { state, events } = play(cfg, [
      [0, "call"],
      [1, "call"],
      [2, "check"],
      // flop
      [1, "check"],
      [2, "check"],
      [0, "check"],
      // turn
      [1, "check"],
      [2, "check"],
      [0, "check"],
      // river
      [1, "check"],
      [2, "check"],
      [0, "check"],
    ]);

    expect(state.handOver).toBe(true);
    expect(state.street).toBe("river");
    const showdown = ofType(events, "showdown")[0]!;
    // No aggression on the river → reveal order starts left of the button.
    expect(showdown.reveals.map((r) => r.seat)).toEqual([1, 2, 0]);
    expect(showdown.reveals[0]!.cards).toEqual([cardFromString("Ah"), cardFromString("Ad")]);
    expect(ofType(events, "pot")).toEqual([{ t: "pot", potIndex: 0, seat: 1, amount: 300 }]);
    expect(seat(state, 1).stack).toBe(10200);
    expect(validateEvents(events).ok).toBe(true);
    auditChips(state, 30000);
  });
});

describe("split pot with an odd cent", () => {
  // Board is a ten-high straight that plays for both showdown seats; suits
  // chosen so no flush is possible for either.
  const rigged = riggedDeck([
    "2c", "2d", // seat 1 (sb) — folds preflop
    "Ah", "Kd", // seat 2 (bb)
    "As", "Kh", // seat 0 (button)
    "6c", "7d", "8h", // flop
    "9s", // turn
    "Tc", // river
  ]);

  it("gives the odd cent to the first winner left of the button, per pot", () => {
    const seats = [0, 1, 2].map((s) => ({ seat: s, stack: 10000 }));
    // sb 25 / bb 75: button calls 75, SB folds (25 dead) → pot 175 (odd).
    const cfg = config({
      seats,
      button: 0,
      blinds: { sb: 25, bb: 75, ante: 0 },
      deckOrder: rigged,
    });
    const { state, events } = play(cfg, [
      [0, "call"],
      [1, "fold"],
      [2, "check"],
      [2, "check"],
      [0, "check"],
      [2, "check"],
      [0, "check"],
      [2, "check"],
      [0, "check"],
    ]);

    expect(state.handOver).toBe(true);
    // Seat 2 sits left of the button (order 1→2→0; 1 folded) → gets the 88.
    expect(ofType(events, "pot")).toEqual([
      { t: "pot", potIndex: 0, seat: 2, amount: 88 },
      { t: "pot", potIndex: 0, seat: 0, amount: 87 },
    ]);
    expect(seat(state, 2).stack).toBe(10013);
    expect(seat(state, 0).stack).toBe(10012);
    expect(seat(state, 1).stack).toBe(9975);
    expect(totalStacks(state)).toBe(30000);
    expect(validateEvents(events).ok).toBe(true);
    auditChips(state, 30000);
  });
});
