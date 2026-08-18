/**
 * Golden replay corpus (growth batch): committed `(config, actions)` →
 * event-log fixtures beyond the flagship 6-max hand in golden.test.ts.
 * Each hand below is driven through the real reducer (never hand-authored)
 * and pinned byte-identical against a committed JSON fixture. Every hand
 * also gets: `validateEvents` structural validity, `auditChips` chip
 * conservation, replay determinism (same config+script twice → identical
 * log), and an `@poker/history` compact-encoding round-trip once wrapped
 * in a `HandRecord` envelope.
 *
 * Regenerate only in reviewed commits: set GOLDEN_REGEN=1 and re-run this
 * file (same convention as golden.test.ts).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  decodeHand,
  encodeHand,
  validateEvents,
  type HandEvent,
  type HandRecord,
} from "@poker/history";
import { auditChips } from "../src/index";
import { config, lcg, ofType, play, riggedDeck, shuffledDeck, totalStacks, type Scripted } from "./helpers";
import type { HandConfig } from "../src/index";

function fixturePath(name: string): string {
  return fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url));
}

/** Compare against (and, under GOLDEN_REGEN=1, overwrite) a committed fixture. */
function goldenCheck(name: string, events: HandEvent[]): void {
  const path = fixturePath(name);
  if (process.env["GOLDEN_REGEN"] === "1") {
    writeFileSync(path, JSON.stringify(events, null, 2) + "\n");
  }
  const fixture = JSON.parse(readFileSync(path, "utf8")) as HandEvent[];
  expect(events).toEqual(fixture);
  expect(JSON.stringify(events)).toBe(JSON.stringify(fixture));
}

/** Wrap a played hand's event log in a minimal HandRecord and round-trip it
 * through @poker/history's compact codec (both directly and via JSON). */
function checkHistoryRoundTrip(id: string, cfg: HandConfig, events: HandEvent[]): void {
  const record: HandRecord = {
    v: 1,
    id,
    sessionId: "sess-golden-corpus",
    seed: `seed-${id}`,
    config: {
      variant: "nlhe",
      maxSeats: cfg.seats.length,
      sb: cfg.blinds.sb,
      bb: cfg.blinds.bb,
      ante: cfg.blinds.ante,
    },
    events,
  };
  expect(decodeHand(encodeHand(record))).toStrictEqual(record);
  const revived = JSON.parse(JSON.stringify(encodeHand(record))) as unknown;
  expect(decodeHand(revived)).toStrictEqual(record);
}

/** Same config + script replayed twice must emit byte-identical logs. */
function checkReplayDeterminism(cfg: HandConfig, script: readonly Scripted[]): void {
  const a = play(cfg, script);
  const b = play(cfg, script);
  expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events));
  expect(JSON.stringify({ ...a.state, evaluate7: undefined })).toBe(
    JSON.stringify({ ...b.state, evaluate7: undefined }),
  );
}

// ---------------------------------------------------------------------------
// 1. Three-way all-in: split main pot + two further pot layers.
// ---------------------------------------------------------------------------

describe("golden: 3-way all-in with a split main pot and two side layers", () => {
  // Button 0 (Z, 1200), sb 1 (X, 300 — shortest), bb 2 (Y, 800). Deal order
  // (left of button first): 1, 2, 0.
  //
  // X and Z are both dealt two of the four aces (Ah/Ad vs As/Ac) — with no
  // ace left for the board, and a paired, non-flushing, non-straightening
  // board, both make the exact same two pair (aces up sevens, 9 kicker) by
  // the naive evaluator: an exact tie forced by construction, not luck. Y
  // holds pocket kings, making the same shape one rank weaker.
  const DECK = riggedDeck([
    "Ah", "Ad", // seat 1 (sb) — X, ties for best hand
    "Kc", "Kd", // seat 2 (bb) — Y, second-best
    "As", "Ac", // seat 0 (button) — Z, ties for best hand, biggest stack
    "7c", "7d", "2h", // flop — pairs the board
    "5s", // turn
    "9h", // river — the kicker that both A-holders share
  ]);

  const seats = [
    { seat: 0, stack: 1200 },
    { seat: 1, stack: 300 },
    { seat: 2, stack: 800 },
  ];
  const cfg = config({ seats, button: 0, deckOrder: DECK });
  const SCRIPT: readonly Scripted[] = [
    [0, "raise", 1200], // Z shoves
    [1, "call"], // X all-in for 300 total (short call)
    [2, "call"], // Y all-in for 800 total (short call)
  ];

  it("re-emits the committed event log byte-identically", () => {
    const { state, events } = play(cfg, SCRIPT);
    goldenCheck("threeway-split-main.golden.json", events);
    expect(validateEvents(events).ok).toBe(true);
    auditChips(state, 2300);
    checkHistoryRoundTrip("threeway-split-main", cfg, events);
    checkReplayDeterminism(cfg, SCRIPT);
  });

  it("splits the main pot between the tied all-ins and awards both extra layers to the chip leader", () => {
    const { state, events } = play(cfg, SCRIPT);
    expect(state.handOver).toBe(true);
    expect(ofType(events, "board").map((b) => b.cards.length)).toEqual([3, 1, 1]);

    const pots = ofType(events, "pot");
    // main 300×3 = 900, split X/Z (even, no odd cent; X/seat 1 sits left of
    // the button so it lists first); side (800-300)×2 = 1000 to Z alone;
    // top (1200-800)×1 = 400 uncalled, returned to Z.
    expect(pots).toEqual([
      { t: "pot", potIndex: 0, seat: 1, amount: 450 },
      { t: "pot", potIndex: 0, seat: 0, amount: 450 },
      { t: "pot", potIndex: 1, seat: 0, amount: 1000 },
      { t: "pot", potIndex: 2, seat: 0, amount: 400 },
    ]);
    const end = ofType(events, "end")[0]!;
    expect(end.net).toEqual([
      { seat: 0, net: 650 }, // 1850 awarded - 1200 in
      { seat: 1, net: 150 }, // 450 awarded - 300 in
      { seat: 2, net: -800 }, // 0 awarded - 800 in
    ]);
    expect(totalStacks(state)).toBe(2300);
  });
});

// ---------------------------------------------------------------------------
// 2. A walk: SB folds, BB wins its own blind back uncontested, never acts.
// ---------------------------------------------------------------------------

describe("golden: a walk (SB folds preflop, BB never acts)", () => {
  const deck = shuffledDeck(lcg(2001));
  const seats = [
    { seat: 10, stack: 5000 },
    { seat: 20, stack: 5000 },
    { seat: 30, stack: 5000 },
  ];
  const cfg = config({ seats, button: 10, deckOrder: [...deck] });
  // 3-handed: button acts first preflop, then sb, then bb.
  const SCRIPT: readonly Scripted[] = [
    [10, "fold"],
    [20, "fold"],
  ];

  it("re-emits the committed event log byte-identically", () => {
    const { state, events } = play(cfg, SCRIPT);
    goldenCheck("walk.golden.json", events);
    expect(validateEvents(events).ok).toBe(true);
    auditChips(state, 15000);
    checkHistoryRoundTrip("walk", cfg, events);
    checkReplayDeterminism(cfg, SCRIPT);
  });

  it("ends with no board, no showdown; BB collects the SB's dead blind", () => {
    const { state, events } = play(cfg, SCRIPT);
    expect(state.handOver).toBe(true);
    expect(ofType(events, "board")).toHaveLength(0);
    expect(ofType(events, "showdown")).toHaveLength(0);
    expect(ofType(events, "pot")).toEqual([{ t: "pot", potIndex: 0, seat: 30, amount: 150 }]);
    const end = ofType(events, "end")[0]!;
    expect(end.net).toEqual([
      { seat: 10, net: 0 },
      { seat: 20, net: -50 },
      { seat: 30, net: 50 },
    ]);
  });
});

// ---------------------------------------------------------------------------
// 3-5. Hands ending uncontested on each postflop street (bet + fold, no
// showdown). The primary golden fixture already pins a river hand that
// reaches showdown; these pin the fold-before-showdown shape at each street.
// ---------------------------------------------------------------------------

describe("golden: uncontested fold ends the hand on the flop", () => {
  const deck = shuffledDeck(lcg(3001));
  const seats = [
    { seat: 0, stack: 10000 },
    { seat: 1, stack: 10000 },
  ];
  const cfg = config({ seats, button: 0, deckOrder: [...deck] });
  const SCRIPT: readonly Scripted[] = [
    [0, "call"], // button/sb completes
    [1, "check"], // bb option, to the flop
    [1, "check"],
    [0, "bet", 150],
    [1, "fold"],
  ];

  it("re-emits the committed event log byte-identically", () => {
    const { state, events } = play(cfg, SCRIPT);
    goldenCheck("ends-on-flop.golden.json", events);
    expect(validateEvents(events).ok).toBe(true);
    auditChips(state, 20000);
    checkHistoryRoundTrip("ends-on-flop", cfg, events);
    checkReplayDeterminism(cfg, SCRIPT);
  });

  it("deals only the flop, no showdown", () => {
    const { events } = play(cfg, SCRIPT);
    expect(ofType(events, "board").map((b) => b.street)).toEqual(["flop"]);
    expect(ofType(events, "showdown")).toHaveLength(0);
    expect(ofType(events, "pot")).toEqual([{ t: "pot", potIndex: 0, seat: 0, amount: 350 }]);
  });
});

describe("golden: uncontested fold ends the hand on the turn", () => {
  const deck = shuffledDeck(lcg(3002));
  const seats = [
    { seat: 0, stack: 10000 },
    { seat: 1, stack: 10000 },
  ];
  const cfg = config({ seats, button: 0, deckOrder: [...deck] });
  const SCRIPT: readonly Scripted[] = [
    [0, "call"],
    [1, "check"],
    [1, "check"],
    [0, "check"],
    [1, "check"],
    [0, "bet", 200],
    [1, "fold"],
  ];

  it("re-emits the committed event log byte-identically", () => {
    const { state, events } = play(cfg, SCRIPT);
    goldenCheck("ends-on-turn.golden.json", events);
    expect(validateEvents(events).ok).toBe(true);
    auditChips(state, 20000);
    checkHistoryRoundTrip("ends-on-turn", cfg, events);
    checkReplayDeterminism(cfg, SCRIPT);
  });

  it("deals flop and turn only, no showdown", () => {
    const { events } = play(cfg, SCRIPT);
    expect(ofType(events, "board").map((b) => b.street)).toEqual(["flop", "turn"]);
    expect(ofType(events, "showdown")).toHaveLength(0);
    expect(ofType(events, "pot")).toEqual([{ t: "pot", potIndex: 0, seat: 0, amount: 400 }]);
  });
});

describe("golden: uncontested fold ends the hand on the river (full board, no showdown)", () => {
  const deck = shuffledDeck(lcg(3003));
  const seats = [
    { seat: 0, stack: 10000 },
    { seat: 1, stack: 10000 },
  ];
  const cfg = config({ seats, button: 0, deckOrder: [...deck] });
  const SCRIPT: readonly Scripted[] = [
    [0, "call"],
    [1, "check"],
    [1, "check"],
    [0, "check"],
    [1, "check"],
    [0, "check"],
    [1, "check"],
    [0, "bet", 500],
    [1, "fold"],
  ];

  it("re-emits the committed event log byte-identically", () => {
    const { state, events } = play(cfg, SCRIPT);
    goldenCheck("ends-on-river.golden.json", events);
    expect(validateEvents(events).ok).toBe(true);
    auditChips(state, 20000);
    checkHistoryRoundTrip("ends-on-river", cfg, events);
    checkReplayDeterminism(cfg, SCRIPT);
  });

  it("deals the full board yet still ends without a showdown", () => {
    const { events } = play(cfg, SCRIPT);
    expect(ofType(events, "board").map((b) => b.street)).toEqual(["flop", "turn", "river"]);
    expect(ofType(events, "showdown")).toHaveLength(0);
    expect(ofType(events, "pot")).toEqual([{ t: "pot", potIndex: 0, seat: 0, amount: 700 }]);
  });
});

// ---------------------------------------------------------------------------
// 6. A min-raise war capped by a short all-in that fails to reopen action.
// ---------------------------------------------------------------------------

describe("golden: a min-raise war capped by a short all-in", () => {
  // Heads-up: button/sb 0 (deep), bb 1 (460 — just enough for three calls
  // of a min-raise ladder but not a fourth full re-raise).
  const deck = shuffledDeck(lcg(4001));
  const seats = [
    { seat: 0, stack: 5000 },
    { seat: 1, stack: 460 },
  ];
  const cfg = config({ seats, button: 0, deckOrder: [...deck] });
  const SCRIPT: readonly Scripted[] = [
    [0, "raise", 200], // open to 200 (min)
    [1, "raise", 300], // min re-raise to 300
    [0, "raise", 400], // min re-raise to 400
    [1, "raise", 460], // all-in for 460 — only a 60 increment, below the 100 minimum
    [0, "call"], // action does not reopen: call or fold only
  ];

  it("re-emits the committed event log byte-identically", () => {
    const { state, events } = play(cfg, SCRIPT);
    goldenCheck("min-raise-war-cap.golden.json", events);
    expect(validateEvents(events).ok).toBe(true);
    auditChips(state, 5460);
    checkHistoryRoundTrip("min-raise-war-cap", cfg, events);
    checkReplayDeterminism(cfg, SCRIPT);
  });

  it("denies seat 0 a re-raise after the short all-in, then runs the board out to showdown", () => {
    const { state, events } = play(cfg, SCRIPT);
    const raises = ofType(events, "act").filter((a) => a.kind === "raise");
    expect(raises.map((r) => r.toAmount)).toEqual([200, 300, 400, 460]);
    expect(ofType(events, "act").filter((a) => a.kind === "call")).toHaveLength(1);
    expect(ofType(events, "board").map((b) => b.cards.length)).toEqual([3, 1, 1]);
    // Reveal order starts at the short-all-in raiser even though its raise
    // never reopened action — it is still the last aggressor.
    expect(ofType(events, "showdown")[0]!.reveals.map((r) => r.seat)).toEqual([1, 0]);
    expect(state.handOver).toBe(true);
    expect(totalStacks(state)).toBe(5460);
  });
});

// ---------------------------------------------------------------------------
// 7. Ante hand: a stack shorter than the ante busts from the ante alone,
// posts nothing at all for its own (nominal) blind, and never acts.
// ---------------------------------------------------------------------------

describe("golden: an ante-crippled stack busts on the ante and skips its own blind", () => {
  // Button 3; ante posting order (left of button, button last) is 0,1,2,3.
  // Seat 0 lands as the nominal SB after posting the ante — but its stack
  // (5) is smaller than the ante (10), so it posts a short ante (5, all-in)
  // and then posts NO small blind at all (0-amount posts emit no event).
  const deck = shuffledDeck(lcg(5001));
  const seats = [
    { seat: 0, stack: 5 },
    { seat: 1, stack: 10000 },
    { seat: 2, stack: 10000 },
    { seat: 3, stack: 10000 },
  ];
  const cfg = config({
    seats,
    button: 3,
    blinds: { sb: 50, bb: 100, ante: 10 },
    deckOrder: [...deck],
  });
  const SCRIPT: readonly Scripted[] = [
    [2, "call"], // utg calls the bb
    [3, "call"], // button calls
    [1, "check"], // bb option (seat 0 is already all-in from the ante, skipped)
    [1, "check"],
    [2, "check"],
    [3, "check"],
    [1, "check"],
    [2, "check"],
    [3, "check"],
    [1, "check"],
    [2, "check"],
    [3, "check"],
  ];

  it("re-emits the committed event log byte-identically", () => {
    const { state, events } = play(cfg, SCRIPT);
    goldenCheck("ante-short-stack.golden.json", events);
    expect(validateEvents(events).ok).toBe(true);
    auditChips(state, 30005);
    checkHistoryRoundTrip("ante-short-stack", cfg, events);
    checkReplayDeterminism(cfg, SCRIPT);
  });

  it("posts the short ante, skips the small blind entirely, and never lets seat 0 act", () => {
    const { state, events } = play(cfg, SCRIPT);
    const posts = ofType(events, "post");
    expect(posts).toEqual([
      { t: "post", seat: 0, kind: "ante", amount: 5 },
      { t: "post", seat: 1, kind: "ante", amount: 10 },
      { t: "post", seat: 2, kind: "ante", amount: 10 },
      { t: "post", seat: 3, kind: "ante", amount: 10 },
      // No SB post for seat 0 — it has 0 chips left after the ante.
      { t: "post", seat: 1, kind: "bb", amount: 100 },
    ]);
    const acts = ofType(events, "act");
    expect(acts.every((a) => a.seat !== 0)).toBe(true);
    expect(state.handOver).toBe(true);
    expect(state.street).toBe("river");
    // Every dealt-in seat, including the crippled one, reaches showdown.
    expect(ofType(events, "showdown")[0]!.reveals.map((r) => r.seat).sort((a, b) => a - b)).toEqual([
      0, 1, 2, 3,
    ]);
    expect(totalStacks(state)).toBe(30005);
  });
});
