import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { applyAction, legalActions } from "@poker/engine";
import { validateEvents } from "@poker/history";
import { CAST, personaById } from "./cast/index";
import { decide } from "./pipeline";
import { initialBotState } from "./state";
import { STAGE_NAMES } from "./trace";
import { playHand, startHand, streamsFor } from "./test-helpers";
import type { DecisionSnapshot } from "./types";

const SEATS_6MAX = [20000, 20000, 20000, 20000, 20000, 20000];

/** Cycle the whole cast across the seats so every tier is exercised. */
function personaForSeat(seat: number): (typeof CAST)[number] {
  const p = CAST[seat % CAST.length];
  if (p === undefined) throw new Error("cast is empty");
  return p;
}

describe("decide — determinism", () => {
  it("returns byte-identical decisions for identical inputs and seeds", () => {
    const { state, events } = startHand({ seed: "determinism", stacks: SEATS_6MAX });
    const persona = personaById("rocco");
    const seat = state.actionSeat;
    expect(seat).not.toBeNull();
    const snapshot: DecisionSnapshot = { state, seat: seat as number, persona, events };
    const botState = initialBotState(persona);

    const a = decide(snapshot, botState, streamsFor("determinism", seat as number, "preflop", 0));
    const b = decide(snapshot, botState, streamsFor("determinism", seat as number, "preflop", 0));

    expect(a.action).toBe(b.action);
    expect(a.amount).toBe(b.amount);
    expect(a.thinkTimeMs).toBe(b.thinkTimeMs);
    expect(JSON.stringify(a.trace)).toBe(JSON.stringify(b.trace));
    expect(JSON.stringify(a.nextBotState)).toBe(JSON.stringify(b.nextBotState));
  });

  it("replays a whole hand identically", () => {
    const first = playHand({ seed: "replay", stacks: SEATS_6MAX }, personaForSeat);
    const second = playHand({ seed: "replay", stacks: SEATS_6MAX }, personaForSeat);
    expect(JSON.stringify(second.events)).toBe(JSON.stringify(first.events));
    expect(second.decisions.map((d) => d.decision.thinkTimeMs)).toEqual(
      first.decisions.map((d) => d.decision.thinkTimeMs),
    );
  });

  it("does not mutate the bot state it was given", () => {
    const { state, events } = startHand({ seed: "purity", stacks: SEATS_6MAX });
    const persona = personaById("vera");
    const seat = state.actionSeat as number;
    const botState = initialBotState(persona);
    const before = JSON.stringify(botState);
    decide({ state, seat, persona, events }, botState, streamsFor("purity", seat, "preflop", 0));
    expect(JSON.stringify(botState)).toBe(before);
  });

  it("never reads a clock: decisions are pure functions of their inputs", () => {
    // Two calls separated by real work must agree; anything time-derived would
    // drift here (and `no-restricted-properties` bans Date.now outright).
    const { state, events } = startHand({ seed: "no-clock", stacks: SEATS_6MAX });
    const persona = personaById("silas");
    const seat = state.actionSeat as number;
    const snapshot: DecisionSnapshot = { state, seat, persona, events };
    const a = decide(snapshot, initialBotState(persona), streamsFor("no-clock", seat, "preflop", 0));
    let churn = 0;
    for (let i = 0; i < 200000; i++) churn += i % 7;
    expect(churn).toBeGreaterThan(0);
    const b = decide(snapshot, initialBotState(persona), streamsFor("no-clock", seat, "preflop", 0));
    expect(a.thinkTimeMs).toBe(b.thinkTimeMs);
  });
});

describe("decide — legal-action conformance", () => {
  it("never proposes an action the engine did not offer (property, seeded states)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 5000 }), fc.integer({ min: 0, max: 5 }), (seedN, button) => {
        const seed = `conformance-${seedN}`;
        const { state: initial, events } = startHand({ seed, stacks: SEATS_6MAX, button });
        let state = initial;
        const log = [...events];
        const counters = new Map<string, number>();
        let guard = 0;
        while (!state.handOver && state.actionSeat !== null) {
          if (guard++ > 200) throw new Error("hand did not terminate");
          const seat = state.actionSeat;
          const persona = personaForSeat(seat);
          const legal = legalActions(state);
          const key = `${state.street}:${seat}`;
          const n = counters.get(key) ?? 0;
          counters.set(key, n + 1);
          const decision = decide(
            { state, seat, persona, events: log, legal },
            initialBotState(persona),
            streamsFor(seed, seat, state.street, n),
          );

          // 1. the kind is on the menu
          const kinds = Object.keys(legal);
          expect(kinds).toContain(decision.action);

          // 2. the amount is inside the menu's interval
          if (decision.action === "bet") {
            expect(decision.amount).toBeGreaterThanOrEqual(legal.bet?.min ?? Infinity);
            expect(decision.amount).toBeLessThanOrEqual(legal.bet?.max ?? -Infinity);
          }
          if (decision.action === "raise") {
            expect(decision.amount).toBeGreaterThanOrEqual(legal.raise?.minTo ?? Infinity);
            expect(decision.amount).toBeLessThanOrEqual(legal.raise?.maxTo ?? -Infinity);
          }
          if (decision.action === "call") expect(decision.amount).toBe(legal.call?.amount);
          if (decision.action === "fold" || decision.action === "check") {
            expect(decision.amount).toBeUndefined();
          }
          if (decision.amount !== undefined) expect(Number.isSafeInteger(decision.amount)).toBe(true);

          // 3. the engine itself accepts it
          const input: { seat: number; kind: typeof decision.action; amount?: number } = {
            seat,
            kind: decision.action,
          };
          if (decision.amount !== undefined) input.amount = decision.amount;
          const result = applyAction(state, input);
          state = result.state;
          for (const ev of result.events) log.push(ev);
        }
        expect(validateEvents(log).ok).toBe(true);
        return true;
      }),
      { numRuns: 40, seed: 20250817 },
    );
  });

  it("drives short-stacked all-in tables to completion", () => {
    for (let i = 0; i < 25; i++) {
      const played = playHand(
        { seed: `shortstack-${i}`, stacks: [400, 250, 900, 1200], blinds: { sb: 50, bb: 100, ante: 10 } },
        personaForSeat,
      );
      expect(played.finalState.handOver).toBe(true);
      expect(validateEvents(played.events).ok).toBe(true);
    }
  });

  it("plays heads-up tables (where the Nash charts apply)", () => {
    for (let i = 0; i < 15; i++) {
      const played = playHand({ seed: `hu-${i}`, stacks: [1500, 1500] }, () => personaById("the-professor"));
      expect(played.finalState.handOver).toBe(true);
      expect(validateEvents(played.events).ok).toBe(true);
    }
  });
});

describe("decide — trace completeness", () => {
  it("emits every one of the nine stages on every decision", () => {
    const played = playHand({ seed: "trace", stacks: SEATS_6MAX }, personaForSeat);
    expect(played.decisions.length).toBeGreaterThan(0);
    for (const { decision } of played.decisions) {
      const t = decision.trace;
      expect(t.stagesCompleted).toEqual(STAGE_NAMES);
      expect(t.v).toBe(1);
      expect(t.context).toBeDefined();
      expect(t.context.texture).toBeDefined();
      expect(t.context.line).toBeDefined();
      expect(t.rangeState).toBeDefined();
      expect(t.strength).toBeDefined();
      expect(t.candidates.rows.length).toBeGreaterThan(0);
      expect(t.shaping.bluffGate).toBeDefined();
      expect(t.tiltError).toBeDefined();
      expect(t.adaptation).toBeDefined();
      expect(t.timing).toBeDefined();
      expect(t.tells).toBeDefined();
      expect(t.chosen.kind).toBe(decision.action);
    }
  });

  it("carries a complete candidate EV table — the bot-mind reveal payload", () => {
    const played = playHand({ seed: "ev-table", stacks: SEATS_6MAX }, personaForSeat);
    for (const { decision } of played.decisions) {
      const rows = decision.trace.candidates.rows;
      // The chosen action always appears as a row.
      expect(rows.some((r) => r.kind === decision.action)).toBe(true);
      for (const row of rows) {
        expect(Number.isFinite(row.ev)).toBe(true);
        expect(Number.isFinite(row.shapedEv)).toBe(true);
        expect(row.probability).toBeGreaterThanOrEqual(0);
        expect(row.probability).toBeLessThanOrEqual(1);
        expect(row.foldFreq).toBeGreaterThanOrEqual(0);
        expect(row.foldFreq).toBeLessThanOrEqual(1);
      }
      const total = rows.reduce((acc, r) => acc + r.probability, 0);
      expect(total).toBeGreaterThan(0.99);
      expect(total).toBeLessThan(1.01);
    }
  });

  it("is JSON-safe end to end (it is persisted and shipped to the UI)", () => {
    const played = playHand({ seed: "json", stacks: SEATS_6MAX }, personaForSeat);
    for (const { decision } of played.decisions) {
      const round = JSON.parse(JSON.stringify(decision.trace)) as unknown;
      expect(round).toBeTruthy();
    }
  });

  it("records the tier's strength method, matching the capability ladder", () => {
    const expectations: Array<[string, string]> = [
      ["barry", "raw-vs-random"],
      ["chip", "raw-vs-random"],
      ["hank", "mc-vs-range"],
      ["rocco", "mc-vs-range"],
      ["silas", "mc-vs-range-blockers"],
      ["vera", "mc-vs-range-blockers"],
    ];
    for (const [id, method] of expectations) {
      const persona = personaById(id);
      const { state, events } = startHand({ seed: `method-${id}`, stacks: SEATS_6MAX });
      const seat = state.actionSeat as number;
      const decision = decide(
        { state, seat, persona, events },
        initialBotState(persona),
        streamsFor(`method-${id}`, seat, "preflop", 0),
      );
      expect(decision.trace.strength.method).toBe(method);
      expect(decision.trace.rangeState.filtered).toBe(persona.tier >= 3);
    }
  });
});

describe("decide — think time", () => {
  it("returns raw integer milliseconds at or above the persona floor", () => {
    const played = playHand({ seed: "timing", stacks: SEATS_6MAX }, personaForSeat);
    for (const { seat, decision } of played.decisions) {
      const persona = personaForSeat(seat);
      expect(Number.isInteger(decision.thinkTimeMs)).toBe(true);
      expect(decision.thinkTimeMs).toBeGreaterThanOrEqual(persona.timing.floorMs);
      // Raw ms, not presenter-scaled: nothing here may exceed the slowest
      // authored band (Vera's 14s false tell is the cast maximum).
      expect(decision.thinkTimeMs).toBeLessThanOrEqual(14000);
    }
  });

  it("is speed-independent: no speed input exists and values stay in authored bands", () => {
    // Doris's metronome: every call and check lands in 2.2-3.2s at 1x. If the
    // pipeline were applying a speed multiplier, this band would move.
    const doris = personaById("doris");
    let sampled = 0;
    for (let i = 0; i < 40 && sampled < 6; i++) {
      const played = playHand({ seed: `doris-${i}`, stacks: SEATS_6MAX }, () => doris);
      for (const { decision } of played.decisions) {
        if (decision.action !== "call" && decision.action !== "check") continue;
        sampled++;
        expect(decision.thinkTimeMs).toBeGreaterThanOrEqual(2200);
        expect(decision.thinkTimeMs).toBeLessThanOrEqual(3200);
      }
    }
    expect(sampled).toBeGreaterThan(0);
  });

  it("gives closer decisions longer bands than trivial ones", () => {
    const persona = personaById("priya");
    const { state, events } = startHand({ seed: "closeness", stacks: SEATS_6MAX });
    const seat = state.actionSeat as number;
    const decision = decide(
      { state, seat, persona, events },
      initialBotState(persona),
      streamsFor("closeness", seat, "preflop", 0),
    );
    const t = decision.trace.timing;
    expect(t.closeness).toBeGreaterThanOrEqual(0);
    expect(t.closeness).toBeLessThanOrEqual(1);
    expect(t.baseBand.minMs).toBeGreaterThanOrEqual(persona.timing.trivial.minMs);
    expect(t.baseBand.maxMs).toBeLessThanOrEqual(persona.timing.close.maxMs);
  });
});
