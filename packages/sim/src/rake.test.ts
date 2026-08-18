/**
 * Rake arithmetic and the session's chip ledger.
 *
 * The headline property is conservation: chips on the table plus chips raked
 * equals chips bought in, exactly, in integer cents, at every hand boundary of
 * a long seeded session. If that ever drifts, either the engine leaked a chip
 * or the rake ledger double-counted one.
 */

import { describe, expect, it } from "vitest";
import { createSession } from "./session";
import { computeRake, rakeOf, uncalledPortion } from "./rake";
import type { RakeLedger, SessionConfig } from "./types";

function ledgerSum(l: RakeLedger): number {
  return Object.values(l.bySeat).reduce((a, b) => a + b, 0);
}

describe("uncalledPortion", () => {
  it("is the gap between the largest and second-largest commitment", () => {
    expect(uncalledPortion([100, 50, 0, 0])).toBe(50);
    expect(uncalledPortion([300, 300, 100])).toBe(0);
    expect(uncalledPortion([500])).toBe(500);
    expect(uncalledPortion([])).toBe(0);
  });
});

describe("computeRake", () => {
  const contested = {
    committedBySeat: new Map([
      [0, 2_000],
      [1, 2_000],
    ]),
    awardedBySeat: new Map([[0, 4_000]]),
    sawBoard: true,
  };

  it("takes nothing when no rake is configured", () => {
    const l = computeRake(undefined, contested);
    expect(l.applied).toBe(false);
    expect(l.totalCents).toBe(0);
    expect(l.reason).toMatch(/no rake/);
  });

  it("takes pct of the base, floored to whole cents", () => {
    const l = computeRake({ pct: 0.05, capCents: 100_000 }, contested);
    expect(l.baseCents).toBe(4_000);
    expect(l.uncalledCents).toBe(0);
    expect(l.totalCents).toBe(200);
    expect(l.bySeat).toEqual({ "0": 200 });
  });

  it("caps the drop", () => {
    const l = computeRake({ pct: 0.5, capCents: 300 }, contested);
    expect(l.totalCents).toBe(300);
  });

  it("excludes the uncalled portion from the base", () => {
    const l = computeRake(
      { pct: 0.1, capCents: 100_000 },
      {
        committedBySeat: new Map([
          [0, 5_000],
          [1, 1_000],
        ]),
        awardedBySeat: new Map([[0, 6_000]]),
        sawBoard: true,
      },
    );
    expect(l.potCents).toBe(6_000);
    expect(l.uncalledCents).toBe(4_000);
    expect(l.baseCents).toBe(2_000);
    expect(l.totalCents).toBe(200);
  });

  it("drops nothing when the hand never saw a flop", () => {
    const l = computeRake({ pct: 0.05, capCents: 300 }, { ...contested, sawBoard: false });
    expect(l.applied).toBe(false);
    expect(l.reason).toBe("no-flop-no-drop");
    expect(l.totalCents).toBe(0);
  });

  it("drops preflop when no-flop-no-drop is switched off", () => {
    const l = computeRake({ pct: 0.05, capCents: 300, noFlopNoDrop: false }, { ...contested, sawBoard: false });
    expect(l.applied).toBe(true);
    expect(l.totalCents).toBe(200);
  });

  it("splits pro-rata across winners, with an exact integer remainder rule", () => {
    // total = floor(0.05 * 3001) = 150; awards 1000/2001 split.
    const l = computeRake(
      { pct: 0.05, capCents: 100_000 },
      {
        committedBySeat: new Map([
          [0, 1_000],
          [1, 1_000],
          [2, 1_001],
        ]),
        awardedBySeat: new Map([
          [1, 1_000],
          [2, 2_001],
        ]),
        sawBoard: true,
      },
    );
    expect(ledgerSum(l)).toBe(l.totalCents);
    expect(l.totalCents).toBe(Math.floor(0.05 * l.baseCents));
    // Larger award pays the larger share; the odd cent goes to the larger award.
    expect(l.bySeat["2"]).toBeGreaterThan(l.bySeat["1"] as number);
  });

  it("never charges a seat more than it won", () => {
    const l = computeRake(
      { pct: 1, capCents: 100_000 },
      {
        committedBySeat: new Map([
          [0, 1_000],
          [1, 1_000],
        ]),
        awardedBySeat: new Map([[0, 2_000]]),
        sawBoard: true,
      },
    );
    expect(l.totalCents).toBeLessThanOrEqual(2_000);
    expect(ledgerSum(l)).toBe(l.totalCents);
  });

  it("rejects a nonsense configuration", () => {
    expect(() => computeRake({ pct: 1.5, capCents: 100 }, contested)).toThrow(/fraction/);
    expect(() => computeRake({ pct: 0.05, capCents: -1 }, contested)).toThrow(/integer/);
  });
});

// ---------------------------------------------------------------------------

function conservationConfig(overrides: Partial<SessionConfig> = {}): SessionConfig {
  return {
    sessionSeed: "conservation",
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
    annotations: { traces: false, grades: false },
    ...overrides,
  };
}

describe("chip conservation across a seeded session", () => {
  it("stacks + rake === chips bought in, at every one of 200 hand boundaries", () => {
    const session = createSession(conservationConfig());
    let rakeSeen = 0;
    for (let hand = 1; hand <= 200; hand++) {
      const step = session.nextHand();
      if (step.awaitingHero) throw new Error("unexpected hero pause");
      const { outcome } = step;

      // The event log itself conserves chips (rake lives outside it).
      const end = outcome.record.events.at(-1);
      if (end?.t !== "end") throw new Error("last event must be end");
      expect(end.net.reduce((a, e) => a + e.net, 0)).toBe(0);

      // The rake ledger is internally consistent and integral.
      const ledger = rakeOf(outcome.record);
      if (ledger === null) throw new Error("missing rake ledger");
      expect(Object.values(ledger.bySeat).reduce((a, b) => a + b, 0)).toBe(ledger.totalCents);
      expect(Number.isSafeInteger(ledger.totalCents)).toBe(true);
      expect(ledger.totalCents).toBeLessThanOrEqual(ledger.capCents);
      expect(ledger.totalCents).toBeLessThanOrEqual(ledger.baseCents);
      rakeSeen += ledger.totalCents;

      // Net-after-rake is exactly net minus the seat's share.
      for (const seat of outcome.seats) {
        const key = String(seat);
        const paid = ledger.bySeat[key] ?? 0;
        expect(outcome.netAfterRakeBySeat[key]).toBe((outcome.netBySeat[key] as number) - paid);
      }

      const view = session.view();
      expect(view.rakeTotalCents).toBe(rakeSeen);
      const onTable = view.stacks.reduce((a, b) => a + b, 0);
      expect(onTable + view.rakeTotalCents).toBe(view.buyInTotalCents);
      for (const s of view.stacks) expect(Number.isSafeInteger(s)).toBe(true);
      expect(view.handsPlayed).toBe(hand);
    }
    expect(rakeSeen).toBeGreaterThan(0);
  }, 60_000);

  it("without a rake configuration nothing leaves the table", () => {
    const session = createSession(conservationConfig({ sessionSeed: "rakefree", rake: undefined }));
    for (let i = 0; i < 40; i++) session.nextHand();
    const view = session.view();
    expect(view.rakeTotalCents).toBe(0);
    expect(view.stacks.reduce((a, b) => a + b, 0)).toBe(view.buyInTotalCents);
  }, 30_000);
});
