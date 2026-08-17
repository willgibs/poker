import { describe, expect, it } from "vitest";
import { decisionId, decisionRefs } from "../src/index";
import { fixtureHand } from "./fixtures/hand001";

describe("decisionId", () => {
  it("formats as street:seat:n", () => {
    expect(decisionId("preflop", 5, 0)).toBe("preflop:5:0");
    expect(decisionId("river", 3, 1)).toBe("river:3:1");
  });
});

describe("decisionRefs", () => {
  it("derives one ref per act event with per-street per-seat counters", () => {
    const ids = decisionRefs(fixtureHand.events).map((r) => r.id);
    expect(ids).toStrictEqual([
      "preflop:4:0",
      "preflop:5:0",
      "preflop:6:0",
      "preflop:1:0",
      "preflop:2:0",
      "preflop:3:0",
      "flop:3:0",
      "flop:5:0",
      "flop:3:1",
      "turn:3:0",
      "turn:5:0",
      "river:3:0",
      "river:5:0",
      "river:3:1",
    ]);
  });

  it("points each ref at its act event", () => {
    for (const ref of decisionRefs(fixtureHand.events)) {
      const e = fixtureHand.events[ref.eventIndex];
      expect(e?.t).toBe("act");
      if (e?.t === "act") expect(e.seat).toBe(ref.seat);
    }
  });

  it("fixture annotation keys are valid decision ids", () => {
    const ids = new Set(decisionRefs(fixtureHand.events).map((r) => r.id));
    for (const key of Object.keys(fixtureHand.annotations ?? {})) {
      expect(ids.has(key)).toBe(true);
    }
  });
});
