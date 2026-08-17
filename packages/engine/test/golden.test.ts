/**
 * Golden replay: one full scripted 6-max hand (antes, a preflop raise, a
 * multiway flop, barrels, a river bluff picked off at showdown) whose exact
 * event log is pinned as a committed JSON fixture. Regenerate only in
 * reviewed commits: set GOLDEN_REGEN=1 and re-run this file.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateEvents, type HandEvent } from "@poker/history";
import { auditChips } from "../src/index";
import { config, ofType, play, riggedDeck, type Scripted } from "./helpers";

const FIXTURE = fileURLToPath(new URL("./fixtures/hand6max.golden.json", import.meta.url));

// Seats 1-6, button 3 → sb 4, bb 5. Deal order: 4, 5, 6, 1, 2, 3.
const DECK = riggedDeck([
  "2c", "3c", // seat 4 (sb) — folds
  "7d", "8d", // seat 5 (bb) — calls, folds flop
  "2d", "3d", // seat 6 — folds
  "Ah", "Ad", // seat 1 — the winner (top set on the flop)
  "Ks", "Qs", // seat 2 — royal draw, bluffs river, loses
  "4c", "5c", // seat 3 (btn) — folds
  "As", "Ts", "2h", // flop
  "6h", // turn
  "3h", // river
]);

const SCRIPT: readonly Scripted[] = [
  // Preflop (utg = seat 6)
  [6, "fold"],
  [1, "raise", 250],
  [2, "call"],
  [3, "fold"],
  [4, "fold"],
  [5, "call"],
  // Flop As Ts 2h (first to act: seat 5)
  [5, "check"],
  [1, "bet", 300],
  [2, "call"],
  [5, "fold"],
  // Turn 6h
  [1, "bet", 700],
  [2, "call"],
  // River 3h
  [1, "check"],
  [2, "bet", 1500],
  [1, "call"],
];

function playGolden() {
  return play(
    config({
      handNumber: 42,
      seats: [1, 2, 3, 4, 5, 6].map((s) => ({ seat: s, stack: 10000 })),
      button: 3,
      blinds: { sb: 50, bb: 100, ante: 10 },
      deckOrder: DECK,
    }),
    SCRIPT,
  );
}

describe("golden 6-max hand", () => {
  it("re-emits the committed event log byte-identically", () => {
    const { state, events } = playGolden();

    if (process.env["GOLDEN_REGEN"] === "1") {
      writeFileSync(FIXTURE, JSON.stringify(events, null, 2) + "\n");
    }
    const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as HandEvent[];

    expect(events).toEqual(fixture);
    // Byte-identical serialization, not merely deep-equal.
    expect(JSON.stringify(events)).toBe(JSON.stringify(fixture));

    expect(validateEvents(events).ok).toBe(true);
    auditChips(state, 60000);
  });

  it("settles the hand as scripted: aggressor reveals first, set beats the bluff", () => {
    const { state, events } = playGolden();
    const showdown = ofType(events, "showdown")[0]!;
    expect(showdown.reveals.map((r) => r.seat)).toEqual([2, 1]);
    const pots = ofType(events, "pot");
    expect(pots).toHaveLength(1);
    expect(pots[0]!.seat).toBe(1);
    // Pot: antes 60 + preflop 250×3 + sb 50 + flop 300×2 + turn 700×2 + river 1500×2.
    expect(pots[0]!.amount).toBe(60 + 750 + 50 + 600 + 1400 + 3000);
    expect(state.handOver).toBe(true);
  });
});
