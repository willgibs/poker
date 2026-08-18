/**
 * Headless self-play smoke: 500 hands, 6-max, mixed tiers, under 60 seconds.
 *
 * This is the budget that makes the arena usable (a 10k-hand persona study has
 * to finish while you are still interested) and the one that catches an
 * accidental O(hands²) in the session — a growing event array re-scanned per
 * decision, an annotation map never released, a bot state cloned per action.
 * It also re-asserts, on a much longer run than the unit tests, that the whole
 * pipeline stays legal, conserving and structurally valid.
 */

import { describe, expect, it } from "vitest";
import { validateEvents } from "@poker/history";
import { createSession } from "./session";
import type { SessionConfig } from "./types";

const HANDS = 500;
const BUDGET_MS = 60_000;

const SIX_MAX: SessionConfig = {
  sessionSeed: "smoke-6max",
  format: "cash",
  stakes: { sbCents: 50, bbCents: 100 },
  seats: [
    { personaId: "barry" },
    { personaId: "doris" },
    { personaId: "hank" },
    { personaId: "rocco" },
    { personaId: "silas" },
    { personaId: "vera" },
  ],
  stackCents: 20_000,
  rake: { pct: 0.05, capCents: 300 },
  dealerOptions: { rebuy: "top-up" },
  // Traces are the memory hog in bulk self-play; the arena runs without them.
  annotations: { traces: false, grades: false },
};

describe("500-hand 6-max self-play smoke", () => {
  it(`plays ${HANDS} hands in under ${BUDGET_MS / 1000}s, valid and conserving throughout`, () => {
    const started = performance.now();
    const session = createSession(SIX_MAX);

    let decisions = 0;
    let showdowns = 0;
    let boards = 0;
    for (let i = 0; i < HANDS; i++) {
      const step = session.nextHand();
      if (step.awaitingHero) throw new Error("self-play must never pause");
      const { outcome } = step;
      decisions += outcome.decisionCount;
      const result = validateEvents(outcome.record.events);
      if (!result.ok) throw new Error(`hand ${outcome.handNumber}: ${result.errors.join("; ")}`);
      for (const ev of outcome.record.events) {
        if (ev.t === "showdown") showdowns += 1;
        if (ev.t === "board" && ev.street === "flop") boards += 1;
      }
    }
    const elapsed = performance.now() - started;

    const view = session.view();
    expect(view.handsPlayed).toBe(HANDS);
    expect(view.stacks.reduce((a, b) => a + b, 0) + view.rakeTotalCents).toBe(view.buyInTotalCents);

    // The run has to be poker, not a fold-fest: sanity floors on activity.
    expect(decisions).toBeGreaterThan(HANDS * 4);
    expect(boards).toBeGreaterThan(HANDS * 0.15);
    expect(showdowns).toBeGreaterThan(HANDS * 0.05);
    expect(view.rakeTotalCents).toBeGreaterThan(0);

    expect(elapsed).toBeLessThan(BUDGET_MS);
  }, BUDGET_MS + 30_000);
});
