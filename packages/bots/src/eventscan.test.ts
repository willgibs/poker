import { describe, expect, it } from "vitest";
import type { HandEvent } from "@poker/history";
import { validateEvents } from "@poker/history";
import { lineFeatures, scanHand } from "./eventscan";
import { playHand } from "./test-helpers";
import { CAST } from "./cast/index";

const HAND: HandEvent[] = [
  {
    t: "start",
    handNumber: 12,
    button: 0,
    seats: [
      { seat: 0, stack: 20000 },
      { seat: 1, stack: 20000 },
      { seat: 2, stack: 20000 },
    ],
    blinds: { sb: 50, bb: 100, ante: 0 },
  },
  { t: "post", seat: 1, kind: "sb", amount: 50 },
  { t: "post", seat: 2, kind: "bb", amount: 100 },
  { t: "hole", seat: 0, cards: [51, 47] },
  { t: "act", seat: 0, kind: "raise", toAmount: 300 },
  { t: "act", seat: 1, kind: "fold" },
  { t: "act", seat: 2, kind: "call", amount: 200 },
  { t: "board", street: "flop", cards: [10, 22, 35] },
  { t: "act", seat: 2, kind: "check" },
  { t: "act", seat: 0, kind: "bet", amount: 400 },
  { t: "act", seat: 2, kind: "call", amount: 400 },
  { t: "board", street: "turn", cards: [7] },
  { t: "act", seat: 2, kind: "check" },
  { t: "act", seat: 0, kind: "check" },
  { t: "board", street: "river", cards: [3] },
  { t: "act", seat: 2, kind: "check" },
  { t: "act", seat: 0, kind: "bet", amount: 900 },
  { t: "act", seat: 2, kind: "fold" },
  { t: "pot", potIndex: 0, seat: 0, amount: 1400 },
  {
    t: "end",
    net: [
      { seat: 0, net: 750 },
      { seat: 1, net: -50 },
      { seat: 2, net: -700 },
    ],
  },
];

describe("scanHand", () => {
  it("reads a structurally valid log", () => {
    expect(validateEvents(HAND).ok).toBe(true);
  });

  it("groups actions by street and tracks the running pot", () => {
    const scan = scanHand(HAND);
    expect(scan.byStreet.preflop).toHaveLength(3);
    expect(scan.byStreet.flop).toHaveLength(3);
    expect(scan.byStreet.turn).toHaveLength(2);
    expect(scan.byStreet.river).toHaveLength(3);
    expect(scan.street).toBe("river");
    expect(scan.board).toEqual([10, 22, 35, 7, 3]);
    const flopBet = scan.byStreet.flop[1];
    expect(flopBet?.kind).toBe("bet");
    // 50 (dead sb) + 300 (seat 0 raise) + 300 (seat 2: 100 bb + 200 call)
    expect(flopBet?.potBefore).toBe(650);
    expect(flopBet?.sizeFraction).toBeCloseTo(400 / 650, 6);
  });

  it("records what each action faced", () => {
    const scan = scanHand(HAND);
    const preflopFold = scan.byStreet.preflop[1];
    expect(preflopFold?.kind).toBe("fold");
    expect(preflopFold?.facing).toBe(250); // 300 to match, 50 already posted
    const flopCheck = scan.byStreet.flop[0];
    expect(flopCheck?.facing).toBe(0);
  });

  it("derives VPIP, PFR and folds", () => {
    const scan = scanHand(HAND);
    expect([...scan.vpipSeats].sort()).toEqual([0, 2]);
    expect([...scan.pfrSeats]).toEqual([0]);
    expect([...scan.foldedSeats].sort()).toEqual([1, 2]);
    expect(scan.sawFlop).toBe(true);
    expect(scan.bb).toBe(100);
    expect(scan.handNumber).toBe(12);
  });

  it("collects results and hole cards", () => {
    const scan = scanHand(HAND);
    expect(scan.netBySeat.get(0)).toBe(750);
    expect(scan.awardedBySeat.get(0)).toBe(1400);
    expect(scan.holeBySeat.get(0)).toEqual([51, 47]);
  });

  it("tolerates a hand still in progress", () => {
    const partial = HAND.slice(0, 8);
    const scan = scanHand(partial);
    expect(scan.netBySeat.size).toBe(0);
    expect(scan.street).toBe("flop");
    expect(scan.acts).toHaveLength(3);
  });
});

describe("lineFeatures", () => {
  it("identifies the preflop raiser and the current street's aggressor", () => {
    const scan = scanHand(HAND);
    const line = lineFeatures(scan, 0);
    expect(line.preflopRaiser).toBe(0);
    expect(line.isPreflopAggressor).toBe(true);
    expect(line.streetAggressor).toBe(0);
    expect(line.preflopRaises).toBe(1);
  });

  it("counts barrels across streets", () => {
    const line = lineFeatures(scanHand(HAND), 0);
    expect(line.barrelIndex).toBe(2); // flop bet + river bet, not the turn check
  });

  it("spots a street where everyone checked to the bot", () => {
    const throughTurnCheck = HAND.slice(0, 13); // up to seat 2's turn check
    const line = lineFeatures(scanHand(throughTurnCheck), 0);
    expect(line.checkedTo).toBe(true);
  });

  it("counts consecutive checks per opponent (Maxine's huntress trigger)", () => {
    const line = lineFeatures(scanHand(HAND), 0);
    expect(line.consecutiveChecksBySeat.get(2)).toBeGreaterThanOrEqual(2);
  });

  it("agrees with a real engine-driven hand", () => {
    const played = playHand({ seed: "scan-real", stacks: [20000, 20000, 20000] }, (s) => CAST[s % CAST.length] as never);
    const scan = scanHand(played.events);
    expect(validateEvents(played.events).ok).toBe(true);
    expect(scan.acts.length).toBe(played.decisions.length);
    for (let i = 0; i < scan.acts.length; i++) {
      expect(scan.acts[i]?.seat).toBe(played.decisions[i]?.seat);
    }
  });
});
