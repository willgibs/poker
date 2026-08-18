/**
 * Malformed-input rejection vectors for decodeHand/decodeEvent, beyond what
 * codec.test.ts's "decode rejects malformed input" block already covers.
 * Focus areas called out by docs/testing.md's parser contract ("fail loudly,
 * never coerce"): truncated wire payloads, version-field edge cases,
 * negative/out-of-range card ints, and negative-cent chip fields at both the
 * tuple layer and the envelope (config) layer.
 */

import { describe, expect, it } from "vitest";
import { decodeEvent, decodeHand, encodeHand, HandDecodeError } from "../src/index";
import { fixtureHand } from "./fixtures/hand001";

const good = encodeHand(fixtureHand);

describe("decodeHand/decodeEvent reject malformed input (never coerce)", () => {
  it("JSON.parse itself throws (never silently coerces) on truncated wire text", () => {
    const wire = JSON.stringify(good);
    // Chop the payload mid-stream at a few different points — none of them
    // are valid JSON, so parsing must fail loudly rather than return a
    // partial/garbage object.
    for (const cut of [wire.length - 3, Math.floor(wire.length / 2), 10]) {
      const truncated = wire.slice(0, cut);
      expect(() => JSON.parse(truncated)).toThrow(SyntaxError);
    }
  });

  it("rejects an envelope missing each required field individually", () => {
    const { v, id, sessionId, seed, config, events } = good;
    expect(() => decodeHand({ v, sessionId, seed, config, events })).toThrow(HandDecodeError); // no id
    expect(() => decodeHand({ v, id, seed, config, events })).toThrow(HandDecodeError); // no sessionId
    expect(() => decodeHand({ v, id, sessionId, config, events })).toThrow(HandDecodeError); // no seed
    expect(() => decodeHand({ v, id, sessionId, seed, events })).toThrow(HandDecodeError); // no config
    expect(() => decodeHand({ v, id, sessionId, seed, config })).toThrow(HandDecodeError); // no events
    expect(() => decodeHand({ id, sessionId, seed, config, events })).toThrow(HandDecodeError); // no v
  });

  it("rejects non-integer/zero/negative version values with the upgrade-on-read hint", () => {
    expect(() => decodeHand({ ...good, v: "1" })).toThrow(/unsupported version/);
    expect(() => decodeHand({ ...good, v: 1.5 })).toThrow(/unsupported version/);
    expect(() => decodeHand({ ...good, v: 0 })).toThrow(/unsupported version/);
    expect(() => decodeHand({ ...good, v: -1 })).toThrow(/unsupported version/);
    expect(() => decodeHand({ ...good, v: null })).toThrow(/unsupported version/);
    expect(() => decodeHand({ ...good, v: [1] })).toThrow(/unsupported version/);
  });

  it("rejects negative and out-of-range card ints across every event kind that carries cards", () => {
    expect(() => decodeEvent(["hole", 1, -1, 5])).toThrow(HandDecodeError);
    expect(() => decodeEvent(["hole", 1, 5, 52])).toThrow(/out of range/);
    expect(() => decodeEvent(["board", "flop", 52, 0, 1])).toThrow(/out of range/);
    expect(() => decodeEvent(["board", "turn", -3])).toThrow(HandDecodeError);
    expect(() => decodeEvent(["showdown", 5, 99, 10])).toThrow(/out of range/);
    expect(() => decodeEvent(["showdown", 5, -1, 10])).toThrow(HandDecodeError);
  });

  it("rejects negative-cent chip fields at the tuple layer (never coerced to positive)", () => {
    expect(() => decodeEvent(["post", 1, "sb", -50])).toThrow(HandDecodeError);
    expect(() => decodeEvent(["pot", 0, 1, -100])).toThrow(HandDecodeError);
    expect(() => decodeEvent(["start", 1, 1, [1, -500], 50, 100, 0])).toThrow(HandDecodeError); // negative stack
    expect(() => decodeEvent(["start", 1, 1, [1, 500], -50, 100, 0])).toThrow(HandDecodeError); // negative sb
    expect(() => decodeEvent(["start", 1, 1, [1, 500], 50, -100, 0])).toThrow(HandDecodeError); // negative bb
    expect(() => decodeEvent(["start", 1, 1, [1, 500], 50, 100, -1])).toThrow(HandDecodeError); // negative ante
  });

  it("rejects negative-cent chip fields at the envelope config layer", () => {
    expect(() =>
      decodeHand({ ...good, config: { variant: "nlhe", maxSeats: 6, sb: -50, bb: 100, ante: 0 } }),
    ).toThrow(/config\.sb/);
    expect(() =>
      decodeHand({ ...good, config: { variant: "nlhe", maxSeats: 6, sb: 50, bb: -100, ante: 0 } }),
    ).toThrow(/config\.bb/);
    expect(() =>
      decodeHand({ ...good, config: { variant: "nlhe", maxSeats: 6, sb: 50, bb: 100, ante: -1 } }),
    ).toThrow(/config\.ante/);
  });

  it("rejects non-array/non-object top-level payloads for decodeEvent", () => {
    expect(() => decodeEvent(null)).toThrow(HandDecodeError);
    expect(() => decodeEvent(undefined)).toThrow(HandDecodeError);
    expect(() => decodeEvent({})).toThrow(HandDecodeError);
    expect(() => decodeEvent("act")).toThrow(HandDecodeError);
    expect(() => decodeEvent(42)).toThrow(HandDecodeError);
  });
});
