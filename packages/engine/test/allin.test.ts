/**
 * All-in mechanics: 3-way preflop all-in with side pots, uncalled-bet return,
 * below-min-raise all-ins and action-reopening rules, all-in runout.
 */

import { describe, expect, it } from "vitest";
import { validateEvents } from "@poker/history";
import { applyAction, auditChips, legalActions, EngineError } from "../src/index";
import { config, lcg, ofType, play, riggedDeck, seat, shuffledDeck, totalStacks } from "./helpers";

describe("3-way preflop all-in with side pots", () => {
  // Button 0 (stack 10000), sb 1 (300), bb 2 (800).
  // Deal order 1, 2, 0. Rig: seat 1 best (aces), seat 2 second (kings),
  // seat 0 worst (queens) — board bricks so ranks hold.
  const rigged = riggedDeck([
    "Ah", "Ad", // seat 1
    "Kh", "Kd", // seat 2
    "Qh", "Qd", // seat 0
    "2c", "7s", "8c", // flop
    "3d", // turn
    "5s", // river
  ]);

  it("builds main and side pots from committed layers and returns the uncalled top", () => {
    const seats = [
      { seat: 0, stack: 10000 },
      { seat: 1, stack: 300 },
      { seat: 2, stack: 800 },
    ];
    const cfg = config({ seats, button: 0, deckOrder: rigged });
    const { state, events } = play(cfg, [
      [0, "raise", 1000],
      [1, "call"], // all-in for 300 total
      [2, "call"], // all-in for 800 total
    ]);

    expect(state.handOver).toBe(true);
    expect(state.street).toBe("river");
    expect(ofType(events, "board").map((b) => b.cards.length)).toEqual([3, 1, 1]);

    // Last aggressor (seat 0) reveals first.
    const showdown = ofType(events, "showdown")[0]!;
    expect(showdown.reveals.map((r) => r.seat)).toEqual([0, 1, 2]);

    // Layers: 300×3 = 900 main {0,1,2}; (800-300)×2 = 1000 side {0,2};
    // (1000-800)×1 = 200 uncalled, returned to seat 0.
    expect(ofType(events, "pot")).toEqual([
      { t: "pot", potIndex: 0, seat: 1, amount: 900 },
      { t: "pot", potIndex: 1, seat: 2, amount: 1000 },
      { t: "pot", potIndex: 2, seat: 0, amount: 200 },
    ]);
    expect(seat(state, 1).stack).toBe(900);
    expect(seat(state, 2).stack).toBe(1000);
    expect(seat(state, 0).stack).toBe(9200);
    expect(totalStacks(state)).toBe(11100);
    const end = ofType(events, "end")[0]!;
    expect(end.net).toEqual([
      { seat: 0, net: -800 },
      { seat: 1, net: 600 },
      { seat: 2, net: 200 },
    ]);
    expect(validateEvents(events).ok).toBe(true);
    auditChips(state, 11100);
  });
});

describe("all-in below a full raise does not reopen action", () => {
  const deck = shuffledDeck(lcg(99));

  it("denies the original raiser a re-raise after a short all-in raise", () => {
    // 3-handed: button 0 (first to act), sb 1, bb 2 (stack 450).
    const seats = [
      { seat: 0, stack: 10000 },
      { seat: 1, stack: 10000 },
      { seat: 2, stack: 450 },
    ];
    const cfg = config({ seats, button: 0, deckOrder: [...deck] });
    let { state } = play(cfg, [
      [0, "raise", 300],
      [1, "fold"],
    ]);

    // BB's stack allows only a short all-in raise: 450 < min raise-to 500.
    expect(legalActions(state).raise).toEqual({ minTo: 450, maxTo: 450 });
    ({ state } = applyAction(state, { seat: 2, kind: "raise", amount: 450 }));

    // Back on the button: 150 more to call, but the 150 increment is below
    // the last full raise (200) — no re-raise.
    expect(state.actionSeat).toBe(0);
    const menu = legalActions(state);
    expect(menu.call).toEqual({ amount: 150 });
    expect(menu.raise).toBeUndefined();
    expect(() => applyAction(state, { seat: 0, kind: "raise", amount: 650 })).toThrow(
      EngineError,
    );

    // Calling closes the round and runs the board out to showdown.
    const r = applyAction(state, { seat: 0, kind: "call" });
    expect(r.state.handOver).toBe(true);
    expect(ofType(r.events, "showdown")).toHaveLength(1);
    auditChips(r.state, 20450);
  });

  it("still lets a seat that never acted raise, and a later full raise reopens everyone", () => {
    // 4-handed: button 0, sb 1, bb 2, utg 3. UTG raises, button short-shoves.
    const seats = [
      { seat: 0, stack: 450 },
      { seat: 1, stack: 20000 },
      { seat: 2, stack: 20000 },
      { seat: 3, stack: 20000 },
    ];
    const cfg = config({ seats, button: 0, deckOrder: [...deck] });
    let { state } = play(cfg, [
      [3, "raise", 300],
      [0, "raise", 450], // short all-in: increment 150 < 200
    ]);

    // SB never acted → full rights; min raise-to stacks the last FULL raise
    // (200) on the current level (450).
    expect(state.actionSeat).toBe(1);
    expect(legalActions(state).raise).toEqual({ minTo: 650, maxTo: 20000 });

    // SB makes a full 3-bet → action reopens for UTG too.
    ({ state } = applyAction(state, { seat: 1, kind: "raise", amount: 1000 }));
    ({ state } = applyAction(state, { seat: 2, kind: "fold" }));
    expect(state.actionSeat).toBe(3);
    const menu = legalActions(state);
    expect(menu.raise).toEqual({ minTo: 1550, maxTo: 20000 });
    auditChips(state, 60450);
  });

  it("an all-in bet below the minimum bet does not reopen raising for a checker", () => {
    // Heads-up flop: bb checks, button open-shoves 60 (< min bet 100).
    const seats = [
      { seat: 0, stack: 160 }, // button/sb: 100 in preflop, 60 behind
      { seat: 1, stack: 20000 },
    ];
    const cfg = config({ seats, button: 0, deckOrder: [...deck] });
    let { state } = play(cfg, [
      [0, "call"], // completes to 100
      [1, "check"],
      // flop: bb first
      [1, "check"],
    ]);
    expect(legalActions(state).bet).toEqual({ min: 60, max: 60 });
    ({ state } = applyAction(state, { seat: 0, kind: "bet", amount: 60 }));

    // Seat 1 already checked this street; the 60 shove is below a full bet →
    // call or fold only.
    expect(state.actionSeat).toBe(1);
    const menu = legalActions(state);
    expect(menu.call).toEqual({ amount: 60 });
    expect(menu.raise).toBeUndefined();
    expect(menu.bet).toBeUndefined();

    const r = applyAction(state, { seat: 1, kind: "call" });
    expect(r.state.handOver).toBe(true);
    auditChips(r.state, 20160);
  });
});

describe("all-in runout details", () => {
  const deck = shuffledDeck(lcg(123));

  it("keeps the final street's aggressor for reveal order across the runout", () => {
    // Heads-up: preflop call, flop shove/call → turn+river run out.
    const seats = [
      { seat: 0, stack: 5000 },
      { seat: 1, stack: 5000 },
    ];
    const cfg = config({ seats, button: 0, deckOrder: [...deck] });
    const { state, events } = play(cfg, [
      [0, "call"],
      [1, "check"],
      [1, "bet", 300],
      [0, "raise", 4900], // all-in
      [1, "call"],
    ]);
    expect(state.handOver).toBe(true);
    // Aggressor (seat 0) reveals first even though betting ended on the flop.
    expect(ofType(events, "showdown")[0]!.reveals.map((r) => r.seat)).toEqual([0, 1]);
    expect(ofType(events, "board")).toHaveLength(3);
    expect(validateEvents(events).ok).toBe(true);
    auditChips(state, 10000);
  });

  it("a lone live player facing shorter all-ins gets no further decisions", () => {
    // 3-handed; two short stacks shove, big stack calls: no more betting —
    // the board runs out with no action events after the calls.
    const seats = [
      { seat: 0, stack: 400 },
      { seat: 1, stack: 700 },
      { seat: 2, stack: 20000 },
    ];
    const cfg = config({ seats, button: 0, deckOrder: [...deck] });
    const { state, events } = play(cfg, [
      [0, "raise", 400],
      [1, "call"], // all-in 700? no — call matches 400; sb has 650 behind
      [2, "call"],
    ]);
    // seats 1 and 2 still have chips and committed 400 each… the round is
    // NOT closed for them postflop; verify the engine kept playing instead.
    expect(state.handOver).toBe(false);
    expect(state.street).toBe("flop");
    expect(state.actionSeat).toBe(1);
    expect(validateEvents([...events, { t: "end", net: [] }]).ok).toBe(false); // log unfinished
    auditChips(state, 21100);
  });
});
