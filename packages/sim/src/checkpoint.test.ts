/**
 * Checkpoint tests.
 *
 * The bar is exactness, not approximation: a session checkpointed mid-run,
 * JSON round-tripped, and restored must continue byte-identically to the run
 * that was never interrupted — including the bots' tilt and opponent models,
 * which is the part a naive "just re-seed it" resume gets wrong.
 */

import { describe, expect, it } from "vitest";
import type { LegalActions } from "@poker/engine";
import { type HandRecord, encodeHand } from "@poker/history";
import { restoreSession, serializeSession } from "./checkpoint";
import { createSession, type Session } from "./session";
import type { HeroAction, SessionConfig } from "./types";

function selfPlay(overrides: Partial<SessionConfig> = {}): SessionConfig {
  return {
    sessionSeed: "checkpoint-test",
    format: "cash",
    stakes: { sbCents: 50, bbCents: 100 },
    seats: [
      { personaId: "barry" },
      { personaId: "doris" },
      { personaId: "hank" },
      { personaId: "rocco" },
    ],
    stackCents: 20_000,
    rake: { pct: 0.05, capCents: 300 },
    dealerOptions: { rebuy: "top-up" },
    annotations: { traces: false, grades: false },
    ...overrides,
  };
}

function logOf(records: readonly HandRecord[]): string {
  return JSON.stringify(records.map((r) => [r.id, r.seed, encodeHand({ ...r, annotations: undefined })]));
}

function runSelfPlay(session: Session, hands: number): HandRecord[] {
  const out: HandRecord[] = [];
  for (let i = 0; i < hands; i++) {
    const step = session.nextHand();
    if (step.awaitingHero) throw new Error("unexpected hero pause");
    out.push(step.outcome.record);
  }
  return out;
}

describe("serializeSession / restoreSession", () => {
  it("is JSON-safe and round-trips unchanged", () => {
    const session = createSession(selfPlay());
    runSelfPlay(session, 7);
    const blob = serializeSession(session);
    const round = JSON.parse(JSON.stringify(blob)) as unknown;
    expect(round).toEqual(blob);
  });

  it("resuming mid-session reproduces the uninterrupted run exactly", () => {
    const straight = logOf(runSelfPlay(createSession(selfPlay()), 24));

    const interrupted = createSession(selfPlay());
    const firstHalf = runSelfPlay(interrupted, 10);
    const blob = JSON.parse(JSON.stringify(serializeSession(interrupted))) as unknown;
    const resumed = restoreSession(blob);
    const secondHalf = runSelfPlay(resumed, 14);

    expect(logOf([...firstHalf, ...secondHalf])).toBe(straight);
  }, 30_000);

  it("carries the bots' memory, not just the chips", () => {
    const session = createSession(selfPlay({ sessionSeed: "memory-carry" }));
    runSelfPlay(session, 30);
    const before = session.botStates();
    const resumed = restoreSession(JSON.parse(JSON.stringify(serializeSession(session))) as unknown);
    const after = resumed.botStates();
    expect(after.size).toBe(before.size);
    for (const [seat, state] of before) {
      expect(after.get(seat)).toEqual(state);
      expect(state.handsObserved).toBe(30);
    }
  }, 30_000);

  it("preserves the ledger: stacks, rake total and buy-ins", () => {
    const session = createSession(selfPlay({ sessionSeed: "ledger-carry" }));
    runSelfPlay(session, 15);
    const before = session.view();
    const resumed = restoreSession(serializeSession(session));
    const after = resumed.view();
    expect(after.stacks).toEqual(before.stacks);
    expect(after.rakeTotalCents).toBe(before.rakeTotalCents);
    expect(after.buyInTotalCents).toBe(before.buyInTotalCents);
    expect(after.handsPlayed).toBe(before.handsPlayed);
    expect(after.nextHandNumber).toBe(before.nextHandNumber);
    expect(after.sessionId).toBe(before.sessionId);
  });

  it("resumes the button rotation where it left off", () => {
    const session = createSession(selfPlay({ sessionSeed: "button-carry" }));
    runSelfPlay(session, 5);
    const resumed = restoreSession(serializeSession(session));
    const step = resumed.nextHand();
    if (step.awaitingHero) throw new Error("unexpected hero pause");
    expect(step.outcome.button).toBe(1); // 4 seats: hands 1-5 used buttons 0,1,2,3,0
  });

  it("refuses to checkpoint while a hero decision is pending", () => {
    const session = createSession({
      ...selfPlay(),
      seats: [{ hero: true }, { personaId: "barry" }, { personaId: "doris" }],
    });
    const step = session.nextHand();
    expect(step.awaitingHero).toBe(true);
    expect(() => serializeSession(session)).toThrow(/mid-hand/);
  });

  it("checkpoints a hero session at a hand boundary and resumes it", () => {
    const config: SessionConfig = {
      ...selfPlay({ sessionSeed: "hero-checkpoint" }),
      seats: [{ hero: true }, { personaId: "barry" }, { personaId: "doris" }],
      annotations: { traces: false, grades: false },
    };
    const script = (legal: LegalActions): HeroAction => {
      if (legal.call !== undefined) return { kind: "call", amount: legal.call.amount };
      if (legal.check !== undefined) return { kind: "check" };
      return { kind: "fold" };
    };
    const drive = (session: Session, hands: number): HandRecord[] => {
      const out: HandRecord[] = [];
      for (let i = 0; i < hands; i++) {
        let step = session.nextHand();
        while (step.awaitingHero) step = session.act(script(step.legalActions));
        out.push(step.outcome.record);
      }
      return out;
    };

    const straight = logOf(drive(createSession(config), 12));
    const interrupted = createSession(config);
    const a = drive(interrupted, 5);
    const b = drive(restoreSession(JSON.parse(JSON.stringify(serializeSession(interrupted))) as unknown), 7);
    expect(logOf([...a, ...b])).toBe(straight);
  }, 30_000);

  it("rejects malformed blobs with every problem listed", () => {
    expect(() => restoreSession(null)).toThrow(/must be an object/);
    expect(() => restoreSession({ v: 2 })).toThrow(/unsupported/);
    expect(() => restoreSession({ v: 1 })).toThrow(/missing its config/);

    const good = serializeSession(createSession(selfPlay()));
    expect(() => restoreSession({ ...good, stacks: [1.5, 2, 3, 4] })).toThrow(/stacks\[0\]/);
    expect(() => restoreSession({ ...good, handsPlayed: -1 })).toThrow(/handsPlayed/);
    expect(() => restoreSession({ ...good, botStates: { "0": { v: 9 } } })).toThrow(/botStates\[0\]/);
  });

  it("rejects a blob whose sessionId contradicts its config", () => {
    const good = serializeSession(createSession(selfPlay()));
    expect(() => restoreSession({ ...good, sessionId: "tampered" })).toThrow(/does not match/);
  });

  it("rejects a blob whose stack count contradicts its seat count", () => {
    const good = serializeSession(createSession(selfPlay()));
    expect(() => restoreSession({ ...good, stacks: [100, 200] })).toThrow(/2 stacks for 4 seats/);
  });
});
