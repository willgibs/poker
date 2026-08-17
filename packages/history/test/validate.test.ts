import { describe, expect, it } from "vitest";
import { validateEvents } from "../src/index";
import type { HandEvent } from "../src/index";
import { fixtureHand } from "./fixtures/hand001";

/** Clone the fixture's events (deep enough for mutation in tests). */
function cloneEvents(): HandEvent[] {
  return structuredClone(fixtureHand.events);
}

function expectInvalid(events: readonly HandEvent[], pattern: RegExp): void {
  const result = validateEvents(events);
  expect(result.ok).toBe(false);
  expect(result.errors.join("\n")).toMatch(pattern);
}

describe("validateEvents", () => {
  it("accepts the fixture hand", () => {
    const result = validateEvents(fixtureHand.events);
    expect(result.errors).toStrictEqual([]);
    expect(result.ok).toBe(true);
  });

  it("rejects an empty event list", () => {
    expectInvalid([], /empty/);
  });

  it("rejects a sequence that does not start with HandStart", () => {
    const events = cloneEvents();
    events.shift();
    expectInvalid(events, /exactly one start/);
  });

  it("rejects start not in first position", () => {
    const events = cloneEvents();
    const start = events.shift();
    if (start === undefined) throw new Error("fixture missing start");
    events.splice(1, 0, start);
    expectInvalid(events, /start must be the first event/);
  });

  it("rejects duplicate start events", () => {
    const events = cloneEvents();
    const start = events[0];
    if (start === undefined) throw new Error("fixture missing start");
    events.splice(1, 0, structuredClone(start));
    expectInvalid(events, /exactly one start/);
  });

  it("rejects a sequence that does not end with HandEnd", () => {
    const events = cloneEvents();
    events.pop();
    expectInvalid(events, /exactly one end/);
  });

  it("rejects events after end", () => {
    const events = cloneEvents();
    events.push({ t: "act", seat: 5, kind: "check" });
    expectInvalid(events, /end must be the last event/);
  });

  it("rejects duplicate seats in start", () => {
    const events = cloneEvents();
    const start = events[0];
    if (start === undefined || start.t !== "start") throw new Error("fixture missing start");
    start.seats.push({ seat: 3, stack: 5000 });
    expectInvalid(events, /duplicate seat 3/);
  });

  it("rejects a button that is not a dealt-in seat", () => {
    const events = cloneEvents();
    const start = events[0];
    if (start === undefined || start.t !== "start") throw new Error("fixture missing start");
    start.button = 9;
    expectInvalid(events, /button 9 is not a dealt-in seat/);
  });

  it("rejects actions from unknown seats", () => {
    const events = cloneEvents();
    events.splice(10, 0, { t: "act", seat: 7, kind: "fold" });
    expectInvalid(events, /act: unknown seat 7/);
  });

  it("rejects pot awards to unknown seats", () => {
    const events = cloneEvents();
    const pot = events.find((e) => e.t === "pot");
    if (pot === undefined || pot.t !== "pot") throw new Error("fixture missing pot");
    pot.seat = 8;
    expectInvalid(events, /pot: unknown seat 8/);
  });

  it("rejects out-of-order board streets", () => {
    const events = cloneEvents();
    const flop = events.find((e) => e.t === "board");
    if (flop === undefined || flop.t !== "board") throw new Error("fixture missing board");
    flop.street = "turn";
    expectInvalid(events, /expected street 'flop' next/);
  });

  it("rejects a flop without exactly 3 cards", () => {
    const events = cloneEvents();
    const flop = events.find((e) => e.t === "board");
    if (flop === undefined || flop.t !== "board") throw new Error("fixture missing board");
    flop.cards = flop.cards.slice(0, 2);
    expectInvalid(events, /flop must have 3 card\(s\)/);
  });

  it("rejects duplicate cards across deals", () => {
    const events = cloneEvents();
    const flop = events.find((e) => e.t === "board");
    if (flop === undefined || flop.t !== "board") throw new Error("fixture missing board");
    flop.cards[0] = 51; // As — already dealt to seat 5
    expectInvalid(events, /duplicate card 51/);
  });

  it("rejects a second hole deal to the same seat", () => {
    const events = cloneEvents();
    events.splice(9, 0, { t: "hole", seat: 2, cards: [20, 22] });
    expectInvalid(events, /seat 2 already has hole cards/);
  });

  it("rejects call without amount and raise without toAmount", () => {
    const events = cloneEvents();
    events.splice(10, 0, { t: "act", seat: 6, kind: "call" });
    expectInvalid(events, /call requires positive integer amount/);

    const events2 = cloneEvents();
    events2.splice(10, 0, { t: "act", seat: 6, kind: "raise" });
    expectInvalid(events2, /raise requires positive integer toAmount/);
  });

  it("rejects raise expressed as amount and check carrying chips", () => {
    const events = cloneEvents();
    events.splice(10, 0, { t: "act", seat: 6, kind: "raise", amount: 300, toAmount: 300 });
    expectInvalid(events, /raise must not carry amount/);

    const events2 = cloneEvents();
    events2.splice(10, 0, { t: "act", seat: 6, kind: "check", amount: 100 });
    expectInvalid(events2, /check must not carry amount/);
  });

  it("rejects non-integer and non-positive amounts", () => {
    const events = cloneEvents();
    events.splice(10, 0, { t: "act", seat: 6, kind: "bet", amount: 10.5 });
    expectInvalid(events, /bet requires positive integer amount/);

    const events2 = cloneEvents();
    const post = events2.find((e) => e.t === "post");
    if (post === undefined || post.t !== "post") throw new Error("fixture missing post");
    post.amount = 0;
    expectInvalid(events2, /post\.amount must be a positive integer/);
  });

  it("rejects showdown reveals that contradict dealt hole cards", () => {
    const events = cloneEvents();
    const sd = events.find((e) => e.t === "showdown");
    if (sd === undefined || sd.t !== "showdown") throw new Error("fixture missing showdown");
    const reveal = sd.reveals[0];
    if (reveal === undefined) throw new Error("fixture missing reveal");
    reveal.cards = [46, 42]; // Kh Qh — not what seat 5 was dealt
    expectInvalid(events, /reveal does not match dealt hole cards/);
  });

  it("accepts reveals in swapped card order (order-insensitive match)", () => {
    const events = cloneEvents();
    const sd = events.find((e) => e.t === "showdown");
    if (sd === undefined || sd.t !== "showdown") throw new Error("fixture missing showdown");
    const reveal = sd.reveals[0];
    if (reveal === undefined) throw new Error("fixture missing reveal");
    reveal.cards = [reveal.cards[1], reveal.cards[0]];
    expect(validateEvents(events).ok).toBe(true);
  });

  it("rejects nets that do not sum to zero or omit a dealt-in seat", () => {
    const events = cloneEvents();
    const end = events[events.length - 1];
    if (end === undefined || end.t !== "end") throw new Error("fixture missing end");
    const heroNet = end.net.find((n) => n.seat === 5);
    if (heroNet === undefined) throw new Error("fixture missing hero net");
    heroNet.net += 100;
    expectInvalid(events, /nets must sum to 0/);

    const events2 = cloneEvents();
    const end2 = events2[events2.length - 1];
    if (end2 === undefined || end2.t !== "end") throw new Error("fixture missing end");
    end2.net = end2.net.filter((n) => n.seat !== 1);
    expectInvalid(events2, /missing net entry for seat 1/);
  });
});
