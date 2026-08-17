/**
 * initHand: config validation, posting, dealing conventions, and the opening
 * action pointer — including heads-up blind order (button posts the SB).
 */

import { describe, expect, it } from "vitest";
import { validateEvents } from "@poker/history";
import { auditChips, initHand, EngineError, legalActions } from "../src/index";
import { config, evaluate7Naive, lcg, ofType, seat, shuffledDeck } from "./helpers";

const deck = shuffledDeck(lcg(42));

describe("initHand config validation", () => {
  const base = () =>
    config({ seats: [{ seat: 0, stack: 10000 }, { seat: 1, stack: 10000 }], button: 0, deckOrder: [...deck] });

  it("rejects malformed decks", () => {
    expect(() => initHand({ ...base(), deckOrder: deck.slice(0, 51) })).toThrow(EngineError);
    const dup = [...deck];
    dup[5] = dup[6]!;
    expect(() => initHand({ ...base(), deckOrder: dup })).toThrow(/duplicate card/);
    const bad = [...deck];
    bad[0] = 52;
    expect(() => initHand({ ...base(), deckOrder: bad })).toThrow(/invalid card/);
  });

  it("rejects bad seat rosters", () => {
    const c = base();
    expect(() => initHand({ ...c, seats: [{ seat: 0, stack: 10000 }] })).toThrow(EngineError);
    expect(() =>
      initHand({ ...c, seats: [{ seat: 0, stack: 100 }, { seat: 0, stack: 100 }] }),
    ).toThrow(/duplicate seat/);
    expect(() =>
      initHand({ ...c, seats: [{ seat: 0, stack: 100 }, { seat: 1, stack: 0 }] }),
    ).toThrow(/stack for seat 1/);
    expect(() =>
      initHand({ ...c, seats: [{ seat: 0, stack: 100 }, { seat: 1, stack: 100.5 }] }),
    ).toThrow(EngineError);
    expect(() => initHand({ ...c, button: 7 })).toThrow(/button/);
  });

  it("rejects bad blinds and hand numbers", () => {
    const c = base();
    expect(() => initHand({ ...c, blinds: { sb: 50, bb: 0, ante: 0 } })).toThrow(/blinds.bb/);
    expect(() => initHand({ ...c, blinds: { sb: -1, bb: 100, ante: 0 } })).toThrow(EngineError);
    expect(() => initHand({ ...c, handNumber: 0 })).toThrow(/handNumber/);
  });
});

describe("initHand posting and dealing", () => {
  it("posts sb/bb, deals clockwise from left of the button, no burn offsets", () => {
    const seats = [
      { seat: 0, stack: 10000 },
      { seat: 1, stack: 10000 },
      { seat: 2, stack: 10000 },
      { seat: 3, stack: 10000 },
    ];
    const { state, events } = initHand(config({ seats, button: 0, deckOrder: [...deck] }));

    const posts = ofType(events, "post");
    expect(posts).toEqual([
      { t: "post", seat: 1, kind: "sb", amount: 50 },
      { t: "post", seat: 2, kind: "bb", amount: 100 },
    ]);

    // Deal order 1,2,3,0 — two consecutive cards each.
    const holes = ofType(events, "hole");
    expect(holes.map((h) => h.seat)).toEqual([1, 2, 3, 0]);
    expect(holes.map((h) => h.cards)).toEqual([
      [deck[0], deck[1]],
      [deck[2], deck[3]],
      [deck[4], deck[5]],
      [deck[6], deck[7]],
    ]);
    expect(state.deckCursor).toBe(8);

    // First decision: left of the big blind.
    expect(state.actionSeat).toBe(3);
    expect(state.currentBet).toBe(100);
    expect(state.minRaise).toBe(100);
    expect(seat(state, 1).committedStreet).toBe(50);
    expect(seat(state, 2).committedStreet).toBe(100);
    auditChips(state, 40000);
  });

  it("posts antes before blinds, clockwise from left of the button", () => {
    const seats = [
      { seat: 2, stack: 5000 },
      { seat: 5, stack: 5000 },
      { seat: 8, stack: 5000 },
    ];
    const { state, events } = initHand(
      config({ seats, button: 5, blinds: { sb: 50, bb: 100, ante: 25 }, deckOrder: [...deck] }),
    );
    const posts = ofType(events, "post");
    expect(posts).toEqual([
      { t: "post", seat: 8, kind: "ante", amount: 25 },
      { t: "post", seat: 2, kind: "ante", amount: 25 },
      { t: "post", seat: 5, kind: "ante", amount: 25 },
      { t: "post", seat: 8, kind: "sb", amount: 50 },
      { t: "post", seat: 2, kind: "bb", amount: 100 },
    ]);
    // Antes count toward the pot but not the street bet level.
    expect(seat(state, 8).committedStreet).toBe(50);
    expect(seat(state, 8).committedTotal).toBe(75);
    expect(seat(state, 2).committedStreet).toBe(100);
    expect(state.currentBet).toBe(100);
    auditChips(state, 15000);
  });

  it("heads-up: the button posts the small blind and acts first preflop", () => {
    const seats = [
      { seat: 2, stack: 10000 },
      { seat: 5, stack: 10000 },
    ];
    const { state, events } = initHand(config({ seats, button: 5, deckOrder: [...deck] }));
    const posts = ofType(events, "post");
    expect(posts).toEqual([
      { t: "post", seat: 5, kind: "sb", amount: 50 },
      { t: "post", seat: 2, kind: "bb", amount: 100 },
    ]);
    // Deal order: left of button (seat 2) first.
    const holes = ofType(events, "hole");
    expect(holes.map((h) => h.seat)).toEqual([2, 5]);
    expect(state.actionSeat).toBe(5);
    const menu = legalActions(state);
    expect(menu.call).toEqual({ amount: 50 });
    expect(menu.raise).toEqual({ minTo: 200, maxTo: 10000 });
  });

  it("short stacks post short (all-in) and never act", () => {
    const seats = [
      { seat: 0, stack: 10000 },
      { seat: 1, stack: 30 }, // sb short
      { seat: 2, stack: 60 }, // bb short
    ];
    const { state, events } = initHand(config({ seats, button: 0, deckOrder: [...deck] }));
    const posts = ofType(events, "post");
    expect(posts).toEqual([
      { t: "post", seat: 1, kind: "sb", amount: 30 },
      { t: "post", seat: 2, kind: "bb", amount: 60 },
    ]);
    expect(seat(state, 1).allIn).toBe(true);
    expect(seat(state, 2).allIn).toBe(true);
    // The bet to match stays the nominal big blind.
    expect(state.currentBet).toBe(100);
    expect(state.actionSeat).toBe(0);
    auditChips(state, 10090);
  });

  it("runs the hand out immediately when the posts leave no one to act", () => {
    // Heads-up, both exactly the blinds: no betting is possible.
    const seats = [
      { seat: 0, stack: 50 },
      { seat: 1, stack: 100 },
    ];
    const { state, events } = initHand(
      config({ seats, button: 0, deckOrder: [...deck], evaluate7: evaluate7Naive }),
    );
    expect(state.handOver).toBe(true);
    expect(ofType(events, "board")).toHaveLength(3);
    expect(ofType(events, "showdown")).toHaveLength(1);
    expect(state.board).toHaveLength(5);
    expect(validateEvents(events).ok).toBe(true);
    auditChips(state, 150);
    expect(legalActions(state)).toEqual({});
  });
});
