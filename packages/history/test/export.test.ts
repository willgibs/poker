import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { exportHandText } from "../src/index";
import { fixtureHand } from "./fixtures/hand001";

const golden = readFileSync(new URL("./fixtures/hand001.golden.txt", import.meta.url), "utf8");

describe("exportHandText", () => {
  it("matches the committed golden fixture exactly (hero seat 5)", () => {
    expect(exportHandText(fixtureHand, { heroSeat: 5 })).toBe(golden);
  });

  it("hides all hole cards when no hero is given", () => {
    const text = exportHandText(fixtureHand);
    expect(text).not.toContain("Dealt to");
    // Folded seats' hole cards must never leak.
    expect(text).not.toContain("4c 5c");
    expect(text).not.toContain("9c 8c");
    expect(text).not.toContain("Jh Th");
    expect(text).not.toContain("2d 3c");
    // Showdown reveals remain visible.
    expect(text).toContain("Player 5: shows [As Ks]");
    expect(text).toContain("Player 3: shows [Ad Qd]");
  });

  it("hides non-hero, non-showdown hole cards even with a hero set", () => {
    const text = exportHandText(fixtureHand, { heroSeat: 5 });
    expect(text).toContain("Dealt to Player 5 [As Ks]");
    expect(text).not.toContain("4c 5c");
    expect(text).not.toContain("9c 8c");
  });

  it("labels main and side pots when a hand has multiple pots", () => {
    const record = structuredClone(fixtureHand);
    const potAt = record.events.findIndex((e) => e.t === "pot");
    expect(potAt).toBeGreaterThan(0);
    record.events.splice(
      potAt,
      1,
      { t: "pot", potIndex: 0, seat: 5, amount: 3000 },
      { t: "pot", potIndex: 1, seat: 3, amount: 50 },
    );
    const text = exportHandText(record, { heroSeat: 5 });
    expect(text).toContain("Player 5 collected $30.00 from main pot");
    expect(text).toContain("Player 3 collected $0.50 from side pot");
    expect(text).toContain("Total pot $30.50");
  });

  it("throws on a record with no start event", () => {
    const record = structuredClone(fixtureHand);
    record.events = record.events.slice(1);
    expect(() => exportHandText(record)).toThrow(/no start event/);
  });
});
