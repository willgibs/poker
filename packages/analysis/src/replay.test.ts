import { decisionRefs } from "@poker/history";
import { describe, expect, it } from "vitest";
import {
  ReplayError,
  actionsOn,
  buildHandView,
  effectiveStack,
  preflopAggressor,
  publicEvents,
  seatView,
} from "./replay";
import { hand } from "./test-helpers";

/** A 6-max hand: BTN opens, BB 3-bets, BTN calls, then three streets. */
function sixMaxHand() {
  return hand({
    handNumber: 7,
    seats: [0, 1, 2, 3, 4, 5],
    button: 0,
    stack: 10_000,
    bb: 100,
    board: ["Qc", "7d", "2s", "Jh", "3c"],
  })
    .blinds()
    .dealTo(0, "Ah", "Kh")
    .dealTo(2, "Qs", "Qd")
    .deal()
    .fold(3)
    .fold(4)
    .fold(5)
    .raise(0, 250)
    .fold(1)
    .raise(2, 900)
    .call(0)
    .flop("Qc", "7d", "2s")
    .bet(2, 600)
    .call(0)
    .turn("Jh")
    .check(2)
    .check(0)
    .river("3c")
    .bet(2, 1500)
    .fold(0)
    .award(2)
    .build();
}

describe("buildHandView", () => {
  it("derives positions from the button and the dealt-in seats", () => {
    const view = buildHandView(sixMaxHand());
    expect(view.tableSize).toBe(6);
    expect(seatView(view, 0)?.position).toBe("BTN");
    expect(seatView(view, 1)?.position).toBe("SB");
    expect(seatView(view, 2)?.position).toBe("BB");
    expect(seatView(view, 3)?.position).toBe("UTG");
    expect(seatView(view, 5)?.position).toBe("CO");
  });

  it("labels heads-up seats with the button posting the small blind", () => {
    const record = hand({ seats: [0, 1], button: 0 }).blinds().deal().fold(0).award(1).build();
    const view = buildHandView(record);
    expect(seatView(view, 0)?.position).toBe("BTN");
    expect(seatView(view, 1)?.position).toBe("BB");
    expect(seatView(view, 0)?.posted).toBe(50);
    expect(seatView(view, 1)?.posted).toBe(100);
  });

  it("uses the same decisionIds as @poker/history", () => {
    const record = sixMaxHand();
    const view = buildHandView(record);
    const refs = decisionRefs(record.events);
    expect(view.actions.map((a) => a.decisionId)).toEqual(refs.map((r) => r.id));
    // The scheme itself: seat 2's flop bet is its first flop action.
    expect(view.actions.find((a) => a.street === "flop" && a.seat === 2)?.decisionId).toBe("flop:2:0");
  });

  it("tracks the pot as the sum of every commitment, including blinds", () => {
    const view = buildHandView(sixMaxHand());
    const open = view.actions.find((a) => a.seat === 0 && a.kind === "raise");
    // Only the blinds are in when the button opens.
    expect(open?.potBefore).toBe(150);
    const threeBet = view.actions.find((a) => a.seat === 2 && a.kind === "raise");
    // sb 50 + bb 100 + button's 250.
    expect(threeBet?.potBefore).toBe(400);
    const call = view.actions.find(
      (a) => a.seat === 0 && a.kind === "call" && a.street === "preflop",
    );
    expect(call?.potBefore).toBe(1200);
    expect(call?.toCall).toBe(650);
    expect(call?.invested).toBe(650);
  });

  it("resets street commitments on every board card", () => {
    const view = buildHandView(sixMaxHand());
    const flopBet = view.actions.find((a) => a.street === "flop" && a.kind === "bet");
    expect(flopBet?.committedStreetBefore).toBe(0);
    // 900 each from seats 0 and 2, plus the small blind's dead 50.
    expect(flopBet?.potBefore).toBe(1850);
    expect(flopBet?.toCall).toBe(0);
    const flopCall = view.actions.find((a) => a.street === "flop" && a.kind === "call");
    expect(flopCall?.toCall).toBe(600);
  });

  it("counts aggression per street", () => {
    const view = buildHandView(sixMaxHand());
    const preflop = actionsOn(view, "preflop");
    expect(preflop.find((a) => a.seat === 0 && a.kind === "raise")?.aggressionIndex).toBe(0);
    expect(preflop.find((a) => a.seat === 2 && a.kind === "raise")?.aggressionIndex).toBe(1);
    expect(actionsOn(view, "flop")[0]?.aggressionIndex).toBe(0);
  });

  it("tracks live players as seats fold out", () => {
    const view = buildHandView(sixMaxHand());
    expect(view.actions[0]?.livePlayers).toBe(6);
    expect(actionsOn(view, "flop")[0]?.livePlayers).toBe(2);
  });

  it("records who saw the flop and who reached showdown", () => {
    const view = buildHandView(sixMaxHand());
    expect(seatView(view, 0)?.sawFlop).toBe(true);
    expect(seatView(view, 3)?.sawFlop).toBe(false);
    // Seat 0 folded the river, so nobody reached showdown here.
    expect(view.showdown).toBe(false);
    expect(seatView(view, 2)?.wentToShowdown).toBe(false);
    expect(seatView(view, 2)?.awarded).toBe(view.potTotal);
  });

  it("counts a mucked showdown as reaching showdown", () => {
    const record = hand({ seats: [0, 1], button: 0, bb: 100, board: ["Qc", "7d", "2s", "Jh", "3c"] })
      .blinds()
      .dealTo(0, "Ah", "Kh")
      .dealTo(1, "2c", "3d")
      .call(0)
      .check(1)
      .flop("Qc", "7d", "2s")
      .check(1)
      .check(0)
      .turn("Jh")
      .check(1)
      .check(0)
      .river("3c")
      .check(1)
      .check(0)
      .showdown(1) // only seat 1 tables its hand; seat 0 mucks
      .award(1)
      .build();
    const view = buildHandView(record);
    expect(seatView(view, 0)?.revealed).toBeNull();
    expect(seatView(view, 0)?.wentToShowdown).toBe(true);
    expect(seatView(view, 1)?.wentToShowdown).toBe(true);
  });

  it("closes the books: nets sum to zero", () => {
    const view = buildHandView(sixMaxHand());
    expect(view.seats.reduce((sum, s) => sum + s.net, 0)).toBe(0);
  });

  it("finds the last preflop raiser", () => {
    expect(preflopAggressor(buildHandView(sixMaxHand()))).toBe(2);
    const limped = hand({ seats: [0, 1, 2], button: 0, board: ["Qc", "7d", "2s"] })
      .blinds()
      .deal()
      .call(0)
      .call(1)
      .check(2)
      .flop("Qc", "7d", "2s")
      .check(1)
      .check(2)
      .check(0)
      .award(2)
      .build();
    expect(preflopAggressor(buildHandView(limped))).toBeUndefined();
  });

  it("reports effective stack against the deepest opponent", () => {
    const record = hand({
      seats: [0, 1, 2],
      button: 0,
      stacks: { 0: 5000, 1: 12_000, 2: 800 },
      bb: 100,
    })
      .blinds()
      .deal()
      .fold(0)
      .fold(1)
      .award(2)
      .build();
    const view = buildHandView(record);
    expect(effectiveStack(view, 0)).toBe(5000);
    expect(effectiveStack(view, 1)).toBe(5000);
    expect(effectiveStack(view, 2)).toBe(800);
  });

  it("rejects a log it cannot reconstruct", () => {
    const record = sixMaxHand();
    expect(() => buildHandView({ ...record, events: record.events.filter((e) => e.t !== "start") })).toThrow(
      ReplayError,
    );
  });
});

describe("publicEvents", () => {
  it("strips every hole event except the hero's", () => {
    const record = sixMaxHand();
    const projected = publicEvents(record.events, 0);
    const holes = projected.filter((e) => e.t === "hole");
    expect(holes).toHaveLength(1);
    expect(holes[0]).toMatchObject({ seat: 0 });
    // Nothing else is touched.
    expect(projected.filter((e) => e.t !== "hole")).toEqual(
      record.events.filter((e) => e.t !== "hole"),
    );
  });

  it("strips them all for a spectator projection", () => {
    const record = sixMaxHand();
    expect(publicEvents(record.events, null).filter((e) => e.t === "hole")).toHaveLength(0);
  });

  it("keeps showdown reveals, which everyone saw", () => {
    const record = hand({ seats: [0, 1], button: 0, board: ["Qc", "7d", "2s", "Jh", "3c"] })
      .blinds()
      .dealTo(0, "Ah", "Kh")
      .dealTo(1, "2c", "3d")
      .call(0)
      .check(1)
      .flop("Qc", "7d", "2s")
      .check(1)
      .check(0)
      .turn("Jh")
      .check(1)
      .check(0)
      .river("3c")
      .check(1)
      .check(0)
      .showdown(1, 0)
      .award(0)
      .build();
    const view = buildHandView(record, publicEvents(record.events, 0));
    expect(seatView(view, 1)?.holeCards).toBeNull();
    expect(seatView(view, 1)?.revealed).not.toBeNull();
  });
});
