/**
 * Tell determinism across repeated calls.
 *
 * `tellFires`/`applyBehaviorTells`/`applySizingTells`/`applyTimingTells`
 * (`tells.ts`) are all pure functions of facts that are themselves computed
 * upstream in the pipeline — nothing in the tell layer rolls dice. What this
 * guards against is not the tell layer itself but the PIPELINE around it:
 * that calling `decide` again with an equivalent (freshly re-derived, per
 * the architecture's seed hierarchy — `streamsFor` — rather than a reused
 * stream instance) snapshot and streams cannot, through some hidden mutation
 * or stream-ordering bug, cause a DIFFERENT tell to fire, or the same tell to
 * fire with a different effect, the second or third time around.
 *
 * `pipeline.test.ts`'s own determinism suite already covers two calls on
 * plain, tell-free opening states. This exercises 3 repeated calls (per the
 * task) on two spots chosen specifically because a tell is known to fire —
 * Barry's `snap-call-draw` and Luna's `suits-are-destiny` (both load-bearing
 * enough that `tells.test.ts` already keys assertions off them) — so the
 * assertion is not vacuous over an empty `trace.tells` array.
 */

import { describe, expect, it } from "vitest";
import { applyAction, type ActionInput } from "@poker/engine";
import type { HandEvent } from "@poker/history";
import { decide } from "./pipeline";
import { personaById } from "./cast/index";
import { cards, hole, startHand, stackedDeck, streamsFor } from "./test-helpers";
import { initialBotState } from "./state";
import type { BotDecision, DecisionSnapshot } from "./types";

/** Barry, on the turn, facing a bet with a flush draw — `snap-call-draw` fires. */
function barryDrawSnapshot(): DecisionSnapshot {
  const deckOrder = stackedDeck({
    seats: [0, 1],
    button: 0,
    holes: { 0: hole("Th 8h"), 1: hole("Kc Qd") },
    board: cards("Ah 5h 2c 9s"),
  });
  const started = startHand({ seed: "barry-draw-determinism", stacks: [20000, 20000], button: 0, deckOrder });
  let state = started.state;
  const events: HandEvent[] = [...started.events];
  const step = (input: ActionInput): void => {
    const r = applyAction(state, input);
    state = r.state;
    for (const ev of r.events) events.push(ev);
  };
  step({ seat: 0, kind: "raise", amount: 300 });
  step({ seat: 1, kind: "call", amount: 200 });
  step({ seat: 1, kind: "check" });
  step({ seat: 0, kind: "check" });
  step({ seat: 1, kind: "bet", amount: 300 });
  return { state, seat: 0, persona: personaById("barry"), events };
}

/** Luna, dealt two suited cards preflop — `suits-are-destiny` disables the fold branch. */
function lunaSuitedSnapshot(): DecisionSnapshot {
  const deckOrder = stackedDeck({ seats: [0, 1], button: 0, holes: { 0: hole("7h 2h"), 1: hole("Ac Ad") } });
  const { state, events } = startHand({ seed: "luna-suited-determinism", stacks: [20000, 20000], button: 0, deckOrder });
  return { state, seat: 0, persona: personaById("luna"), events };
}

function threeRuns(snapshot: DecisionSnapshot, seedLabel: string): [BotDecision, BotDecision, BotDecision] {
  const persona = snapshot.persona;
  const run = (): BotDecision =>
    decide(snapshot, initialBotState(persona), streamsFor(seedLabel, snapshot.seat, snapshot.state.street, 0));
  return [run(), run(), run()];
}

describe("tell determinism — same snapshot and streams, 3 repeated calls", () => {
  it("fires Barry's snap-call-draw identically across 3 runs", () => {
    const snapshot = barryDrawSnapshot();
    const [a, b, c] = threeRuns(snapshot, "barry-draw-determinism");

    for (const d of [a, b, c]) {
      expect(d.trace.tells.map((t) => t.id)).toContain("snap-call-draw");
    }
    expect(a.action).toBe("call");
    expect(a.action).toBe(b.action);
    expect(a.action).toBe(c.action);
    expect(a.amount).toBe(b.amount);
    expect(a.amount).toBe(c.amount);
    expect(a.thinkTimeMs).toBe(b.thinkTimeMs);
    expect(a.thinkTimeMs).toBe(c.thinkTimeMs);
    expect(JSON.stringify(a.trace.tells)).toBe(JSON.stringify(b.trace.tells));
    expect(JSON.stringify(a.trace.tells)).toBe(JSON.stringify(c.trace.tells));
    expect(JSON.stringify(a.trace)).toBe(JSON.stringify(b.trace));
    expect(JSON.stringify(a.trace)).toBe(JSON.stringify(c.trace));
    expect(JSON.stringify(a.nextBotState)).toBe(JSON.stringify(b.nextBotState));
    expect(JSON.stringify(a.nextBotState)).toBe(JSON.stringify(c.nextBotState));
  });

  it("fires Luna's suits-are-destiny identically across 3 runs", () => {
    const snapshot = lunaSuitedSnapshot();
    const [a, b, c] = threeRuns(snapshot, "luna-suited-determinism");

    for (const d of [a, b, c]) {
      expect(d.trace.tells.map((t) => t.id)).toContain("suits-are-destiny");
      expect(d.action).not.toBe("fold");
    }
    expect(a.action).toBe(b.action);
    expect(a.action).toBe(c.action);
    expect(JSON.stringify(a.trace.tells)).toBe(JSON.stringify(b.trace.tells));
    expect(JSON.stringify(a.trace.tells)).toBe(JSON.stringify(c.trace.tells));
    expect(JSON.stringify(a.trace)).toBe(JSON.stringify(b.trace));
    expect(JSON.stringify(a.trace)).toBe(JSON.stringify(c.trace));
  });
});
