import { describe, expect, it } from "vitest";
import { personaById } from "./cast/index";
import {
  adaptationRamp,
  cloneBotState,
  initialBotState,
  initialOpponentStats,
  opponentOf,
  restoreBotState,
  snapshotBotState,
} from "./state";

const rocco = personaById("rocco");

describe("BotState", () => {
  it("starts blank and stamped with its persona", () => {
    const state = initialBotState(rocco);
    expect(state.v).toBe(1);
    expect(state.personaId).toBe("rocco");
    expect(state.tilt).toBe(0);
    expect(state.handsObserved).toBe(0);
    expect(Object.keys(state.opponents)).toHaveLength(0);
  });

  it("hands out a neutral model for an unseen opponent without recording it", () => {
    const state = initialBotState(rocco);
    const stats = opponentOf(state, 4);
    expect(stats).toEqual(initialOpponentStats());
    expect(state.opponents["4"]).toBeUndefined();
  });

  it("clones deeply enough that opponent models are not shared", () => {
    const state = initialBotState(rocco);
    state.opponents["2"] = initialOpponentStats();
    const copy = cloneBotState(state);
    const opponent = copy.opponents["2"];
    expect(opponent).toBeDefined();
    if (opponent !== undefined) opponent.foldToBet = 0.9;
    expect(state.opponents["2"]?.foldToBet).toBe(0.5);
  });

  it("ramps adaptation confidence from 0 to 1 over ~60 hands", () => {
    expect(adaptationRamp({ ...initialOpponentStats(), hands: 0 })).toBe(0);
    expect(adaptationRamp({ ...initialOpponentStats(), hands: 30 })).toBeCloseTo(0.5, 6);
    expect(adaptationRamp({ ...initialOpponentStats(), hands: 200 })).toBe(1);
  });
});

describe("persistence", () => {
  function populated() {
    const state = initialBotState(rocco);
    state.tilt = 0.42;
    state.handsObserved = 137;
    state.handsSinceFlop = 3;
    state.lastTiltHand = 129;
    state.recentBigLosses = 2;
    state.netVsHeroBb = -18.5;
    state.opponents["3"] = { ...initialOpponentStats(), hands: 90, foldToBet: 0.71 };
    state.tellLastFired["tilt-throttle"] = 130;
    return state;
  }

  it("round-trips through JSON exactly", () => {
    const state = populated();
    const restored = restoreBotState(JSON.parse(JSON.stringify(snapshotBotState(state))) as unknown);
    expect(restored).toEqual(state);
  });

  it("returns a detached snapshot, not a live reference", () => {
    const state = populated();
    const snap = snapshotBotState(state);
    state.tilt = 1;
    const opponent = state.opponents["3"];
    if (opponent !== undefined) opponent.foldToBet = 0.99;
    expect(snap.tilt).toBe(0.42);
    expect(snap.opponents["3"]?.foldToBet).toBeCloseTo(0.71, 10);
  });

  it("rejects a non-object, a bad version, and impossible values", () => {
    expect(() => restoreBotState(null)).toThrow(/must be an object/);
    expect(() => restoreBotState({ ...populated(), v: 2 })).toThrow(/unsupported bot state version/);
    expect(() => restoreBotState({ ...populated(), tilt: 4 })).toThrow(/tilt/);
    expect(() => restoreBotState({ ...populated(), personaId: "" })).toThrow(/personaId/);
    expect(() => restoreBotState({ ...populated(), opponents: { "3": { hands: -1 } } })).toThrow(/hands/);
  });

  it("tolerates a snapshot with no opponents or tells recorded yet", () => {
    const bare = { ...initialBotState(rocco) } as Record<string, unknown>;
    delete bare["opponents"];
    delete bare["tellLastFired"];
    const restored = restoreBotState(bare);
    expect(restored.opponents).toEqual({});
    expect(restored.tellLastFired).toEqual({});
  });

  it("lists every problem at once", () => {
    let message = "";
    try {
      restoreBotState({ ...populated(), tilt: -1, handsObserved: "many" });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toMatch(/tilt/);
    expect(message).toMatch(/handsObserved/);
  });
});
