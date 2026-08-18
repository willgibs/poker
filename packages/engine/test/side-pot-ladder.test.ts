/**
 * Multi-way all-in ladder fuzz + classic side-pot traps.
 *
 * Complements pots-oracle.test.ts (which fuzzes `buildPots` directly against
 * synthetic committed/folded rows) by driving *real* multi-street NLHE play
 * through `initHand`/`applyAction` — random seat counts, stacks (including
 * forced ties), antes, and short ("dead") blind posts — biased heavily
 * toward all-in so the ladder actually forms multiple side-pot layers. After
 * each fuzzed hand, the layering implied by the final committed totals is
 * recomputed independently (not by calling `buildPots`) and checked against
 * the emitted `pot` events for: exact-cent conservation, strictly-shrinking
 * eligibility per layer, and that no seat is ever paid from a layer it
 * didn't cover.
 *
 * The known-vector section below pins classic traps by hand: an ante alone
 * busting a stack before blinds are even posted (which turns what looks
 * like a walk into a genuine all-in runout), a blind posted short of a full
 * stack, ties across independent all-ins merging into one pot layer, and a
 * folds-to-the-bb walk with antes in play.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { validateEvents } from "@poker/history";
import {
  applyAction,
  auditChips,
  initHand,
  legalActions,
  potsOf,
  type ActionInput,
  type TableState,
} from "../src/index";
import { config, evaluate7Naive, lcg, ofType, play, riggedDeck, shuffledDeck, totalStacks, type Lcg } from "./helpers";

const MAX_STEPS = 300;

// --- ladder scenario generation ---------------------------------------------

interface LadderSetup {
  seatCount: number;
  stacks: number[];
  button: number;
  ante: number;
  sb: number;
  bb: number;
  deck: number[];
}

// A mix of tiny, mid, and deep stacks so antes/blinds land on both sides of
// "covers it" for different seats in the same hand.
const STACK_POOL = [1, 5, 20, 50, 80, 100, 150, 200, 300, 500, 800, 1500, 4000, 12000];

function setupLadder(seed: number): LadderSetup {
  const rng = lcg(seed);
  const seatCount = 3 + rng.int(4); // 3..6, per the brief
  const stacks: number[] = [];
  for (let i = 0; i < seatCount; i++) {
    // Force a tie with an earlier seat ~40% of the time so equal-all-in
    // layers show up often, not just incidentally.
    if (i > 0 && rng.int(5) < 2) {
      stacks.push(stacks[rng.int(stacks.length)]!);
    } else {
      stacks.push(STACK_POOL[rng.int(STACK_POOL.length)]!);
    }
  }
  const button = rng.int(seatCount);
  const ante = rng.int(4) === 0 ? 0 : 5 + rng.int(60);
  const sb = 10 + rng.int(60);
  const bb = sb * 2 + rng.int(40);
  return { seatCount, stacks, button, ante, sb, bb, deck: shuffledDeck(rng) };
}

/** Weighted toward shoving: builds an all-in ladder rather than a flat game. */
function chooseLadderAction(state: TableState, rng: Lcg): ActionInput {
  const menu = legalActions(state);
  const seatNo = state.actionSeat!;

  if (rng.int(100) < 8) return { seat: seatNo, kind: "fold" };

  if (menu.raise !== undefined) {
    const { minTo, maxTo } = menu.raise;
    return rng.int(100) < 75
      ? { seat: seatNo, kind: "raise", amount: maxTo } // shove
      : { seat: seatNo, kind: "raise", amount: minTo }; // min-raise (reopen stress)
  }
  if (menu.bet !== undefined) {
    const { min, max } = menu.bet;
    return rng.int(100) < 75
      ? { seat: seatNo, kind: "bet", amount: max } // shove
      : { seat: seatNo, kind: "bet", amount: min };
  }
  if (menu.call !== undefined) return { seat: seatNo, kind: "call" };
  if (menu.check !== undefined) return { seat: seatNo, kind: "check" };
  return { seat: seatNo, kind: "fold" };
}

function runLadder(seed: number): void {
  const { stacks, button, ante, sb, bb, deck } = setupLadder(seed);
  const rng = lcg(seed ^ 0x5bd1e995);
  const initialTotal = stacks.reduce((a, c) => a + c, 0);

  const init = initHand({
    handNumber: 1,
    button,
    seats: stacks.map((stack, seatNo) => ({ seat: seatNo, stack })),
    blinds: { sb, bb, ante },
    deckOrder: deck,
    evaluate7: evaluate7Naive,
  });
  let state = init.state;
  const events = [...init.events];
  auditChips(state, initialTotal);

  let steps = 0;
  while (!state.handOver) {
    expect(steps).toBeLessThan(MAX_STEPS);
    steps++;
    const input = chooseLadderAction(state, rng);
    const r = applyAction(state, input);
    state = r.state;
    events.push(...r.events);
    auditChips(state, initialTotal); // conservation after every step
  }

  expect(totalStacks(state)).toBe(initialTotal);
  expect(validateEvents(events).ok).toBe(true);

  // Independently rebuild the layering the hand's final committed totals
  // imply (mirrors buildPots' rule, but computed here rather than imported,
  // so this checks the reducer's bookkeeping rather than re-testing
  // buildPots itself).
  const committed = state.seats.map((s) => ({ seat: s.seat, committed: s.committedTotal, folded: s.folded }));
  const active = committed.filter((c) => !c.folded && c.committed > 0);
  const levels = [...new Set(active.map((c) => c.committed))].sort((a, b) => a - b);

  const potEvents = ofType(events, "pot");
  const byIndex = new Map<number, typeof potEvents>();
  for (const e of potEvents) {
    const arr = byIndex.get(e.potIndex) ?? [];
    arr.push(e);
    byIndex.set(e.potIndex, arr);
  }
  expect(byIndex.size).toBe(levels.length);

  let prevLevel = 0;
  const top = levels[levels.length - 1];
  levels.forEach((level, i) => {
    const evs = byIndex.get(i) ?? [];
    expect(evs.length).toBeGreaterThan(0);

    const eligible = new Set(active.filter((c) => c.committed >= level).map((c) => c.seat));
    for (const e of evs) {
      // Award eligibility: never win from a pot this seat's commitment
      // didn't reach.
      expect(eligible.has(e.seat)).toBe(true);
      const c = committed.find((row) => row.seat === e.seat)!;
      expect(c.committed).toBeGreaterThanOrEqual(level);
    }

    // Exact-cent pot conservation, layer by layer.
    let amount = 0;
    for (const c of committed) amount += Math.max(0, Math.min(c.committed, level) - prevLevel);
    if (level === top) {
      for (const c of committed) amount += Math.max(0, c.committed - level);
    }
    const gotAmount = evs.reduce((a, e) => a + e.amount, 0);
    expect(gotAmount).toBe(amount);

    prevLevel = level;
  });

  // Side-pot layering monotonicity: eligibility strictly shrinks up the
  // ladder, and each layer's eligible set is a subset of the one below it.
  for (let i = 1; i < levels.length; i++) {
    const prevEligible = new Set(active.filter((c) => c.committed >= levels[i - 1]!).map((c) => c.seat));
    const curEligible = new Set(active.filter((c) => c.committed >= levels[i]!).map((c) => c.seat));
    expect(curEligible.size).toBeLessThan(prevEligible.size);
    for (const s of curEligible) expect(prevEligible.has(s)).toBe(true);
  }

  // Global exact-cent conservation: every committed cent is awarded exactly once.
  const totalCommitted = committed.reduce((a, c) => a + c.committed, 0);
  const totalAwarded = potEvents.reduce((a, e) => a + e.amount, 0);
  expect(totalAwarded).toBe(totalCommitted);
}

describe("fuzzed multi-way all-in ladders", () => {
  it("conserve chips exactly, layer pots monotonically, and never pay an ineligible seat", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 0x7fffffff }), (seed) => {
        runLadder(seed);
      }),
      { numRuns: Number(process.env["FC_RUNS"] ?? 300) },
    );
  });
});

// --- classic traps, pinned by hand ------------------------------------------

describe("classic side-pot traps", () => {
  it("merges independent equal all-ins into a single shared pot layer (no fragmentation)", () => {
    // 3-way tie: button, sb, bb all have exactly 500 and all go all-in.
    // Board is a made 9-high straight; all three hole-card pairs are inert
    // (no flush/higher-straight/pair-beats-straight risk), so all three tie
    // exactly on the naive evaluator's straight score (kickers don't enter).
    const rigged = riggedDeck([
      "2h", "3d", // seat 1 (sb)
      "2s", "4h", // seat 2 (bb)
      "3s", "4d", // seat 0 (button)
      "5c", "6d", "7h", // flop
      "8s", // turn
      "9c", // river
    ]);
    const seats = [0, 1, 2].map((s) => ({ seat: s, stack: 500 }));
    const cfg = config({ seats, button: 0, blinds: { sb: 50, bb: 100, ante: 0 }, deckOrder: rigged });
    const { state, events } = play(cfg, [
      [0, "raise", 500], // button shoves
      [1, "call"], // sb all-in call
      [2, "call"], // bb all-in call
    ]);

    expect(state.handOver).toBe(true);
    // One merged layer, not three fragments.
    expect(potsOf(state)).toEqual([{ amount: 1500, eligible: [0, 1, 2] }]);
    expect(ofType(events, "pot")).toEqual([
      { t: "pot", potIndex: 0, seat: 1, amount: 500 },
      { t: "pot", potIndex: 0, seat: 2, amount: 500 },
      { t: "pot", potIndex: 0, seat: 0, amount: 500 },
    ]);
    for (const s of [0, 1, 2]) {
      const seatState = state.seats.find((x) => x.seat === s)!;
      expect(seatState.stack).toBe(500);
    }
    expect(totalStacks(state)).toBe(1500);
    expect(validateEvents(events).ok).toBe(true);
    auditChips(state, 1500);
  });

  it("an ante alone can bust a stack before blinds post, collapsing a would-be walk into an all-in runout that caps the short stack's win", () => {
    // Button's stack (15) is smaller than the ante (20): it posts all-in
    // from the ante round itself, before any blind or bet. SB then folds —
    // normally that would be an uncontested BB walk, but the button is
    // still LIVE (all-in, not folded), so the hand must run to showdown
    // between button and bb instead of ending immediately.
    const rigged = riggedDeck([
      "2c", "3d", // seat 1 (sb) — folds, cards never matter
      "Ks", "Kd", // seat 2 (bb) — pair kings
      "As", "Ad", // seat 0 (button) — pair aces: the BEST hand at the table
      "4c", "9d", "Jh", // flop
      "6s", // turn
      "2h", // river
    ]);
    const seats = [
      { seat: 0, stack: 15 },
      { seat: 1, stack: 10000 },
      { seat: 2, stack: 10000 },
    ];
    const cfg = config({ seats, button: 0, blinds: { sb: 50, bb: 100, ante: 20 }, deckOrder: rigged });
    const init = initHand(cfg);
    expect(ofType(init.events, "post")).toEqual([
      { t: "post", seat: 1, kind: "ante", amount: 20 },
      { t: "post", seat: 2, kind: "ante", amount: 20 },
      { t: "post", seat: 0, kind: "ante", amount: 15 }, // short: whole stack
      { t: "post", seat: 1, kind: "sb", amount: 50 },
      { t: "post", seat: 2, kind: "bb", amount: 100 },
    ]);
    expect(init.state.seats.find((s) => s.seat === 0)!.allIn).toBe(true);
    expect(init.state.actionSeat).toBe(1); // sb still owes a decision

    const { state, events } = play(cfg, [[1, "fold"]]);

    expect(state.handOver).toBe(true);
    expect(state.street).toBe("river"); // ran out despite only one fold
    // Only button (all-in) and bb reveal; the folded sb never shows.
    expect(ofType(events, "showdown")[0]!.reveals.map((r) => r.seat)).toEqual([2, 0]);

    // Committed: seat0=15 (allin), seat1=70 (folded, dead), seat2=120.
    // Layer 1 @15: 15+15+15 = 45, eligible {0,2}. Layer 2 @120 (top):
    // (70-15)+(120-15) = 55+105 = 160, eligible {2} only.
    expect(ofType(events, "pot")).toEqual([
      { t: "pot", potIndex: 0, seat: 0, amount: 45 }, // button wins ONLY the layer it covered
      { t: "pot", potIndex: 1, seat: 2, amount: 160 }, // despite button's better hand
    ]);
    expect(state.seats.find((s) => s.seat === 0)!.stack).toBe(45);
    expect(state.seats.find((s) => s.seat === 2)!.stack).toBe(10040);
    const end = ofType(events, "end")[0]!;
    expect(end.net).toEqual([
      { seat: 0, net: 30 },
      { seat: 1, net: -70 },
      { seat: 2, net: 40 },
    ]);
    expect(totalStacks(state)).toBe(20015);
    expect(validateEvents(events).ok).toBe(true);
    auditChips(state, 20015);
  });

  it("a blind posted short of a full stack forms its own low side-pot layer", () => {
    // SB's stack (30) is less than the sb amount (50): posts short, all-in.
    // Everyone checks it down; the resulting side pot layers are {30} main
    // (all three) and {100} side (button + bb only, sb is not covered).
    const rigged = riggedDeck([
      "As", "Ad", // seat 1 (sb) — pair aces: best hand, wins the layer it covers
      "3c", "7d", // seat 2 (bb) — high card, worst
      "Ks", "Kd", // seat 0 (button) — pair kings
      "4c", "9d", "Jh", // flop
      "6s", // turn
      "2h", // river
    ]);
    const seats = [
      { seat: 0, stack: 10000 },
      { seat: 1, stack: 30 },
      { seat: 2, stack: 10000 },
    ];
    const cfg = config({ seats, button: 0, blinds: { sb: 50, bb: 100, ante: 0 }, deckOrder: rigged });
    const init = initHand(cfg);
    expect(ofType(init.events, "post")).toEqual([
      { t: "post", seat: 1, kind: "sb", amount: 30 }, // short: whole stack
      { t: "post", seat: 2, kind: "bb", amount: 100 },
    ]);
    expect(init.state.seats.find((s) => s.seat === 1)!.allIn).toBe(true);
    expect(init.state.currentBet).toBe(100); // nominal bb, unaffected by the short sb

    const { state, events } = play(cfg, [
      [0, "call"],
      [2, "check"],
      [2, "check"],
      [0, "check"],
      [2, "check"],
      [0, "check"],
      [2, "check"],
      [0, "check"],
    ]);

    expect(state.handOver).toBe(true);
    expect(state.street).toBe("river");
    // Layer 1 @30: 30*3 = 90, eligible {0,1,2} — sb (best hand) wins it all.
    // Layer 2 @100 (top): (100-30)*2 = 140, eligible {0,2} — button (kings) beats bb.
    expect(ofType(events, "pot")).toEqual([
      { t: "pot", potIndex: 0, seat: 1, amount: 90 },
      { t: "pot", potIndex: 1, seat: 0, amount: 140 },
    ]);
    const end = ofType(events, "end")[0]!;
    expect(end.net).toEqual([
      { seat: 0, net: 40 },
      { seat: 1, net: 60 },
      { seat: 2, net: -100 },
    ]);
    expect(totalStacks(state)).toBe(20030);
    expect(validateEvents(events).ok).toBe(true);
    auditChips(state, 20030);
  });

  it("folds-to-the-bb walk still sweeps every seat's ante, not just the blinds", () => {
    // 4-handed, everyone antes and no one is short; utg/button/sb all fold
    // preflop → immediate uncontested award, no board dealt, no showdown —
    // but the pot must include all four antes, not just sb+bb.
    const seats = [0, 1, 2, 3].map((s) => ({ seat: s, stack: 10000 }));
    const deck = shuffledDeck(lcg(31337));
    const cfg = config({ seats, button: 0, blinds: { sb: 50, bb: 100, ante: 25 }, deckOrder: deck });
    const init = initHand(cfg);
    expect(ofType(init.events, "post")).toEqual([
      { t: "post", seat: 1, kind: "ante", amount: 25 },
      { t: "post", seat: 2, kind: "ante", amount: 25 },
      { t: "post", seat: 3, kind: "ante", amount: 25 },
      { t: "post", seat: 0, kind: "ante", amount: 25 },
      { t: "post", seat: 1, kind: "sb", amount: 50 },
      { t: "post", seat: 2, kind: "bb", amount: 100 },
    ]);

    const { state, events } = play(cfg, [
      [3, "fold"], // utg
      [0, "fold"], // button
      [1, "fold"], // sb — bb wins uncontested
    ]);

    expect(state.handOver).toBe(true);
    expect(ofType(events, "board")).toHaveLength(0);
    expect(ofType(events, "showdown")).toHaveLength(0);
    // 4 antes (100) + sb (50) + bb (100) = 250, all to the bb.
    expect(ofType(events, "pot")).toEqual([{ t: "pot", potIndex: 0, seat: 2, amount: 250 }]);
    const end = ofType(events, "end")[0]!;
    expect(end.net).toEqual([
      { seat: 0, net: -25 },
      { seat: 1, net: -75 },
      { seat: 2, net: 125 },
      { seat: 3, net: -25 },
    ]);
    expect(totalStacks(state)).toBe(40000);
    expect(validateEvents(events).ok).toBe(true);
    auditChips(state, 40000);
  });
});
