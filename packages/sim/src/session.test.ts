/**
 * Session orchestrator tests.
 *
 * The load-bearing claims: byte-identical replays from the same seed and hero
 * script, a hero pause/resume loop a scripted driver can steer from
 * `legalActions` alone, records that pass `validateEvents`, annotations that
 * carry a trace for every bot decision and a grade for every hero decision, and
 * bot memory (tilt, opponent models) that survives hand boundaries.
 */

import { describe, expect, it } from "vitest";
import { CAST_BY_ID } from "@poker/bots";
import type { LegalActions } from "@poker/engine";
import {
  type HandEvent,
  type HandRecord,
  decisionRefs,
  encodeHand,
  validateEvents,
} from "@poker/history";
import { createSession } from "./session";
import type { DecisionAnnotation, HandOutcome, HeroAction, SessionConfig } from "./types";
import { RAKE_ANNOTATION_KEY, rakeOf } from "./rake";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SIX_MAX = ["barry", "doris", "hank", "rocco", "silas", "vera"] as const;

function selfPlayConfig(overrides: Partial<SessionConfig> = {}): SessionConfig {
  return {
    sessionSeed: "session-test",
    format: "cash",
    stakes: { sbCents: 50, bbCents: 100 },
    seats: SIX_MAX.map((personaId) => ({ personaId })),
    stackCents: 20_000,
    dealerOptions: { rebuy: "top-up" },
    annotations: { traces: false, grades: false },
    ...overrides,
  };
}

function heroConfig(overrides: Partial<SessionConfig> = {}): SessionConfig {
  return {
    sessionSeed: "hero-test",
    format: "cash",
    stakes: { sbCents: 50, bbCents: 100 },
    seats: [{ hero: true }, { personaId: "barry" }, { personaId: "doris" }],
    stackCents: 20_000,
    dealerOptions: { rebuy: "top-up" },
    ...overrides,
  };
}

/** A deterministic scripted hero that only ever reads the legal menu. */
type HeroScript = (legal: LegalActions, index: number) => HeroAction;

/** Calls when it can, otherwise checks; never folds — maximum action. */
const callingStation: HeroScript = (legal) => {
  if (legal.call !== undefined) return { kind: "call", amount: legal.call.amount, thinkTimeMs: 700 };
  if (legal.check !== undefined) return { kind: "check", thinkTimeMs: 300 };
  return { kind: "fold" };
};

/** Rotates through the menu so every action kind gets exercised. */
const rotating: HeroScript = (legal, index) => {
  switch (index % 4) {
    case 0:
      if (legal.check !== undefined) return { kind: "check" };
      if (legal.call !== undefined) return { kind: "call", amount: legal.call.amount };
      return { kind: "fold" };
    case 1:
      if (legal.bet !== undefined) return { kind: "bet", amount: legal.bet.min };
      if (legal.call !== undefined) return { kind: "call", amount: legal.call.amount };
      if (legal.check !== undefined) return { kind: "check" };
      return { kind: "fold" };
    case 2:
      if (legal.raise !== undefined) return { kind: "raise", amount: legal.raise.minTo };
      if (legal.check !== undefined) return { kind: "check" };
      if (legal.call !== undefined) return { kind: "call", amount: legal.call.amount };
      return { kind: "fold" };
    default:
      if (legal.check !== undefined) return { kind: "check" };
      return { kind: "fold" };
  }
};

interface RunResult {
  outcomes: HandOutcome[];
  records: HandRecord[];
  heroDecisions: number;
}

function play(config: SessionConfig, hands: number, script?: HeroScript): RunResult {
  const session = createSession(config);
  const outcomes: HandOutcome[] = [];
  let heroDecisions = 0;
  for (let i = 0; i < hands; i++) {
    let step = session.nextHand();
    let guard = 0;
    while (step.awaitingHero) {
      if (guard++ > 200) throw new Error("hero loop did not terminate");
      const action = (script ?? callingStation)(step.legalActions, heroDecisions);
      heroDecisions += 1;
      step = session.act(action);
    }
    outcomes.push(step.outcome);
  }
  return { outcomes, records: outcomes.map((o) => o.record), heroDecisions };
}

function logOf(records: readonly HandRecord[]): string {
  return JSON.stringify(records.map((r) => [r.id, r.seed, encodeHand({ ...r, annotations: undefined })]));
}

// ---------------------------------------------------------------------------

describe("createSession — configuration", () => {
  it("rejects a lineup with two heroes", () => {
    expect(() =>
      createSession(heroConfig({ seats: [{ hero: true }, { hero: true }, { personaId: "barry" }] })),
    ).toThrow(/at most one hero/);
  });

  it("rejects an unknown persona id", () => {
    expect(() => createSession(selfPlayConfig({ seats: [{ personaId: "nobody" }, { personaId: "barry" }] }))).toThrow(
      /unknown persona/,
    );
  });

  it("rejects non-integer chip amounts", () => {
    expect(() => createSession(selfPlayConfig({ stackCents: 20_000.5 }))).toThrow(/integer/);
  });

  it("derives a deterministic session id from the seed", () => {
    const a = createSession(selfPlayConfig());
    const b = createSession(selfPlayConfig());
    const c = createSession(selfPlayConfig({ sessionSeed: "other" }));
    expect(a.sessionId).toBe(b.sessionId);
    expect(a.sessionId).not.toBe(c.sessionId);
  });
});

describe("determinism", () => {
  it("self-play: the same config + seed replays byte-identically", () => {
    const first = play(selfPlayConfig(), 15);
    const second = play(selfPlayConfig(), 15);
    expect(logOf(second.records)).toBe(logOf(first.records));
  });

  it("hero play: the same config + seed + hero script replays byte-identically", () => {
    const first = play(heroConfig(), 12, rotating);
    const second = play(heroConfig(), 12, rotating);
    expect(second.heroDecisions).toBe(first.heroDecisions);
    expect(logOf(second.records)).toBe(logOf(first.records));
  });

  it("a different session seed produces a different session", () => {
    const a = play(selfPlayConfig(), 6);
    const b = play(selfPlayConfig({ sessionSeed: "different" }), 6);
    expect(logOf(b.records)).not.toBe(logOf(a.records));
  });

  it("the deck is a pure function of the session seed and hand number", () => {
    // Hand 3 of one session and hand 3 of an identically seeded session deal
    // the same cards even though the lineups differ in stack size.
    const a = play(selfPlayConfig(), 3).records[2] as HandRecord;
    const b = play(selfPlayConfig({ stackCents: 50_000 }), 3).records[2] as HandRecord;
    const holes = (r: HandRecord): number[] =>
      r.events.flatMap((e: HandEvent) => (e.t === "hole" ? e.cards : []));
    expect(holes(b)).toEqual(holes(a));
  });
});

describe("hero pause / act", () => {
  it("pauses on every hero decision and resumes from the legal menu", () => {
    const session = createSession(heroConfig());
    let step = session.nextHand();
    let pauses = 0;
    while (step.awaitingHero) {
      pauses += 1;
      expect(session.status()).toBe("awaiting-hero");
      expect(step.snapshot.seat).toBe(0);
      expect(step.snapshot.decisionId.endsWith(":0:0") || step.snapshot.decisionId.includes(":0:")).toBe(true);
      // The menu is never empty at a decision point.
      const menu = step.legalActions;
      expect(Object.keys(menu).length).toBeGreaterThan(0);
      step = session.act(callingStation(menu, pauses));
    }
    expect(pauses).toBeGreaterThan(0);
    expect(step.outcome.record.events.at(-1)?.t).toBe("end");
    expect(session.status()).toBe("ready");
  });

  it("refuses to deal while a hero decision is pending", () => {
    const session = createSession(heroConfig());
    const step = session.nextHand();
    expect(step.awaitingHero).toBe(true);
    expect(() => session.nextHand()).toThrow(/pending/);
  });

  it("refuses act() when nothing is pending", () => {
    const session = createSession(selfPlayConfig());
    expect(() => session.act({ kind: "fold" })).toThrow(/no hero decision/);
  });

  it("an illegal hero action leaves the pause intact", () => {
    const session = createSession(heroConfig());
    const step = session.nextHand();
    if (!step.awaitingHero) throw new Error("expected a hero pause");
    expect(() => session.act({ kind: "bet", amount: 999_999_999 })).toThrow();
    expect(session.status()).toBe("awaiting-hero");
    expect(session.pending()?.snapshot.decisionId).toBe(step.snapshot.decisionId);
    const resumed = session.act(callingStation(step.legalActions, 0));
    expect(resumed).toBeDefined();
  });

  it("hero-less lineups run straight through", () => {
    const session = createSession(selfPlayConfig());
    const step = session.nextHand();
    expect(step.awaitingHero).toBe(false);
  });

  it("records the hero's observed think time on the act event", () => {
    const { records } = play(heroConfig(), 4, callingStation);
    const heroActs = records
      .flatMap((r) => r.events)
      .filter((e): e is Extract<HandEvent, { t: "act" }> => e.t === "act" && e.seat === 0);
    expect(heroActs.length).toBeGreaterThan(0);
    for (const a of heroActs) expect(a.thinkTimeMs).toBeGreaterThan(0);
  });
});

describe("the hand record", () => {
  it("validates via @poker/history validateEvents", () => {
    const { records } = play(selfPlayConfig(), 25);
    for (const record of records) {
      const result = validateEvents(record.events);
      expect(result.errors).toEqual([]);
      expect(result.ok).toBe(true);
    }
  });

  it("carries a v1 envelope with deterministic ids and the table config", () => {
    const { records } = play(selfPlayConfig(), 3);
    const first = records[0] as HandRecord;
    expect(first.v).toBe(1);
    expect(first.sessionId).toBe(createSession(selfPlayConfig()).sessionId);
    expect(first.seed).toBe("session-test/hand/1");
    expect(first.config).toEqual({ variant: "nlhe", maxSeats: 6, sb: 50, bb: 100, ante: 0 });
    expect(new Set(records.map((r) => r.id)).size).toBe(records.length);
  });

  it("survives the compact codec round-trip", () => {
    const { records } = play(selfPlayConfig(), 5);
    for (const record of records) {
      const round = JSON.parse(JSON.stringify(encodeHand(record))) as unknown;
      expect(round).toEqual(encodeHand(record));
    }
  });

  it("annotates every bot decision with a trace", () => {
    const { records } = play(selfPlayConfig({ annotations: { traces: true, grades: false } }), 6);
    let traced = 0;
    for (const record of records) {
      for (const ref of decisionRefs(record.events)) {
        const note = record.annotations?.[ref.id] as DecisionAnnotation | undefined;
        expect(note?.trace, `missing trace for ${record.id} ${ref.id}`).toBeDefined();
        expect(note?.trace?.stagesCompleted).toHaveLength(9);
        expect(note?.trace?.personaId).toBe(SIX_MAX[ref.seat]);
        traced += 1;
      }
    }
    expect(traced).toBeGreaterThan(20);
  });

  it("annotates every hero decision with a grade and every bot decision with a trace", () => {
    const { records } = play(heroConfig({ annotations: { traces: true, grades: true } }), 4, rotating);
    let heroGraded = 0;
    let botTraced = 0;
    for (const record of records) {
      for (const ref of decisionRefs(record.events)) {
        const note = record.annotations?.[ref.id] as DecisionAnnotation | undefined;
        if (ref.seat === 0) {
          expect(note?.grade, `missing grade for ${record.id} ${ref.id}`).toBeDefined();
          expect(note?.grade?.decisionId).toBe(ref.id);
          expect(note?.grade?.confidence).toBeDefined();
          expect(note?.grade?.note.length).toBeGreaterThan(0);
          heroGraded += 1;
        } else {
          expect(note?.trace, `missing trace for ${record.id} ${ref.id}`).toBeDefined();
          expect(CAST_BY_ID.has(note?.trace?.personaId ?? "")).toBe(true);
          botTraced += 1;
        }
      }
    }
    expect(heroGraded).toBeGreaterThan(0);
    expect(botTraced).toBeGreaterThan(0);
  });

  it("omits traces and grades when annotations are switched off", () => {
    const { records } = play(heroConfig({ annotations: { traces: false, grades: false } }), 2);
    for (const record of records) {
      expect(Object.keys(record.annotations ?? {})).toEqual([RAKE_ANNOTATION_KEY]);
    }
  });
});

describe("session bookkeeping", () => {
  it("rotates the button one seat per hand", () => {
    const { outcomes } = play(selfPlayConfig(), 8);
    expect(outcomes.map((o) => o.button)).toEqual([0, 1, 2, 3, 4, 5, 0, 1]);
  });

  it("keeps the button fixed when rotation is off", () => {
    const { outcomes } = play(selfPlayConfig({ dealerOptions: { rotateButton: false, button: 2, rebuy: "top-up" } }), 4);
    expect(outcomes.map((o) => o.button)).toEqual([2, 2, 2, 2]);
  });

  it("numbers hands 1..N and reports them on the start event", () => {
    const { outcomes, records } = play(selfPlayConfig(), 5);
    expect(outcomes.map((o) => o.handNumber)).toEqual([1, 2, 3, 4, 5]);
    for (const record of records) {
      const start = record.events[0];
      if (start?.t !== "start") throw new Error("first event must be start");
      expect(start.handNumber).toBe(Number(record.seed.split("/").at(-1)));
    }
  });

  it("stops dealing when fewer than two seats are funded", () => {
    const session = createSession({
      sessionSeed: "bustout",
      format: "cash",
      stakes: { sbCents: 50, bbCents: 100 },
      seats: [{ personaId: "barry" }, { personaId: "vera" }],
      stackCents: [100, 20_000],
      dealerOptions: { rebuy: "off" },
      annotations: { traces: false, grades: false },
    });
    let guard = 0;
    while (session.status() === "ready" && guard++ < 200) session.nextHand();
    expect(session.status()).toBe("finished");
    expect(() => session.nextHand()).toThrow(/session is over/);
  });

  it("honours maxHands", () => {
    const session = createSession(selfPlayConfig({ dealerOptions: { rebuy: "top-up", maxHands: 3 } }));
    session.nextHand();
    session.nextHand();
    session.nextHand();
    expect(session.status()).toBe("finished");
    expect(() => session.nextHand()).toThrow(/limit/);
  });
});

describe("bot memory across hands", () => {
  it("threads BotState so hands observed accumulate", () => {
    const session = createSession(selfPlayConfig());
    for (let i = 0; i < 12; i++) session.nextHand();
    for (const [, state] of session.botStates()) {
      expect(state.handsObserved).toBe(12);
      expect(Object.keys(state.opponents).length).toBeGreaterThan(0);
    }
  });

  it("carries tilt across hand boundaries rather than resetting it", () => {
    // Over a long session at least one character must accumulate tilt, and the
    // reported per-hand tilt must match the bot's live state.
    const session = createSession(selfPlayConfig({ sessionSeed: "tilt-carryover" }));
    let tiltEvents = 0;
    let sawNonZeroTilt = false;
    for (let i = 0; i < 40; i++) {
      const step = session.nextHand();
      if (step.awaitingHero) throw new Error("unexpected hero");
      tiltEvents += step.outcome.tiltEvents.length;
      for (const [seat, tilt] of Object.entries(step.outcome.tiltBySeat)) {
        if (tilt > 0) sawNonZeroTilt = true;
        expect(session.botStates().get(Number(seat))?.tilt).toBe(tilt);
      }
    }
    expect(tiltEvents).toBeGreaterThan(0);
    expect(sawNonZeroTilt).toBe(true);
  });

  it("hands a fresh session no memory at all", () => {
    const session = createSession(selfPlayConfig());
    for (const [, state] of session.botStates()) {
      expect(state.handsObserved).toBe(0);
      expect(state.tilt).toBe(0);
    }
  });
});

describe("rake in the record", () => {
  it("attaches the ledger under a namespaced annotation key", () => {
    const { records } = play(selfPlayConfig({ rake: { pct: 0.05, capCents: 300 } }), 10);
    for (const record of records) {
      const ledger = rakeOf(record);
      expect(ledger).not.toBeNull();
      expect(ledger?.v).toBe(1);
      // The key can never collide with a decisionId (`street:seat:n`).
      expect(RAKE_ANNOTATION_KEY.includes(":")).toBe(false);
    }
  });

  it("leaves the event log rake-free: nets always sum to zero", () => {
    const { records } = play(selfPlayConfig({ rake: { pct: 0.1, capCents: 10_000 } }), 12);
    for (const record of records) {
      const end = record.events.at(-1);
      if (end?.t !== "end") throw new Error("last event must be end");
      expect(end.net.reduce((a, e) => a + e.net, 0)).toBe(0);
    }
  });
});

describe("table variations", () => {
  it("posts antes and still produces a valid, conserving log", () => {
    const { records } = play(
      selfPlayConfig({
        sessionSeed: "antes",
        stakes: { sbCents: 50, bbCents: 100, anteCents: 10 },
      }),
      6,
    );
    for (const record of records) {
      expect(validateEvents(record.events).errors).toEqual([]);
      expect(record.config.ante).toBe(10);
      const antes = record.events.filter((e) => e.t === "post" && e.kind === "ante");
      expect(antes).toHaveLength(6);
      const end = record.events.at(-1);
      if (end?.t !== "end") throw new Error("last event must be end");
      expect(end.net.reduce((a, e) => a + e.net, 0)).toBe(0);
    }
  });

  it("accepts per-seat buy-ins and rebuys only the busted seat", () => {
    const session = createSession({
      sessionSeed: "per-seat-stacks",
      format: "cash",
      stakes: { sbCents: 50, bbCents: 100 },
      seats: [{ personaId: "barry" }, { personaId: "vera" }, { personaId: "silas" }],
      stackCents: [1_000, 40_000, 40_000],
      dealerOptions: { rebuy: "rebuy-on-bust" },
      annotations: { traces: false, grades: false },
    });
    const first = session.nextHand();
    if (first.awaitingHero) throw new Error("unexpected hero pause");
    expect(first.outcome.record.events[0]).toMatchObject({
      t: "start",
      seats: [
        { seat: 0, stack: 1_000 },
        { seat: 1, stack: 40_000 },
        { seat: 2, stack: 40_000 },
      ],
    });
    for (let i = 0; i < 30; i++) session.nextHand();
    const view = session.view();
    // Nothing is raked, so every chip is either on the table or was bought in.
    expect(view.stacks.reduce((a, b) => a + b, 0)).toBe(view.buyInTotalCents);
    expect(view.buyInTotalCents).toBeGreaterThanOrEqual(81_000);
    for (const s of view.stacks) expect(s).toBeGreaterThan(0);
  }, 30_000);

  it("plays heads-up, where the button posts the small blind", () => {
    const { records } = play(
      selfPlayConfig({ sessionSeed: "hu", seats: [{ personaId: "vera" }, { personaId: "silas" }] }),
      4,
    );
    for (const record of records) {
      expect(validateEvents(record.events).errors).toEqual([]);
      const start = record.events[0];
      const sb = record.events.find((e) => e.t === "post" && e.kind === "sb");
      if (start?.t !== "start" || sb?.t !== "post") throw new Error("malformed hand");
      expect(sb.seat).toBe(start.button);
    }
  });
});
