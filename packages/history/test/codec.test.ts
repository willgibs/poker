import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  decodeEvent,
  decodeHand,
  encodeEvent,
  encodeHand,
  HandDecodeError,
} from "../src/index";
import type {
  ActionKind,
  DealBoard,
  DealHole,
  HandEnd,
  HandEvent,
  HandRecord,
  HandStart,
  PlayerAction,
  PostBlind,
  PotAwarded,
  Showdown,
} from "../src/index";
import { fixtureHand } from "./fixtures/hand001";

// ---------------------------------------------------------------------------
// Arbitraries (type-valid events; semantic validity is validate.ts's concern,
// so fuzzing arbitrary sequences here is a strictly stronger codec test)
// ---------------------------------------------------------------------------

const cardArb = fc.integer({ min: 0, max: 51 });
const seatArb = fc.integer({ min: 0, max: 9 });
const chipsArb = fc.integer({ min: 0, max: 5_000_000 });
const posChipsArb = fc.integer({ min: 1, max: 5_000_000 });
const holePairArb: fc.Arbitrary<[number, number]> = fc.tuple(cardArb, cardArb);

const startArb: fc.Arbitrary<HandStart> = fc.record({
  t: fc.constant("start" as const),
  handNumber: fc.integer({ min: 1, max: 1_000_000 }),
  button: seatArb,
  seats: fc.array(fc.record({ seat: seatArb, stack: chipsArb }), { minLength: 2, maxLength: 9 }),
  blinds: fc.record({ sb: chipsArb, bb: chipsArb, ante: chipsArb }),
});

const postArb: fc.Arbitrary<PostBlind> = fc.record({
  t: fc.constant("post" as const),
  seat: seatArb,
  kind: fc.constantFrom("sb" as const, "bb" as const, "ante" as const),
  amount: posChipsArb,
});

const holeArb: fc.Arbitrary<DealHole> = fc.record({
  t: fc.constant("hole" as const),
  seat: seatArb,
  cards: holePairArb,
});

const actArb: fc.Arbitrary<PlayerAction> = fc
  .tuple(
    seatArb,
    fc.constantFrom<ActionKind>("fold", "check", "call", "bet", "raise"),
    fc.option(posChipsArb, { nil: undefined }),
    fc.option(posChipsArb, { nil: undefined }),
    fc.option(fc.integer({ min: 0, max: 600_000 }), { nil: undefined }),
  )
  .map(([seat, kind, amount, toAmount, thinkTimeMs]) => {
    const e: PlayerAction = { t: "act", seat, kind };
    if (amount !== undefined) e.amount = amount;
    if (toAmount !== undefined) e.toAmount = toAmount;
    if (thinkTimeMs !== undefined) e.thinkTimeMs = thinkTimeMs;
    return e;
  });

const boardArb: fc.Arbitrary<DealBoard> = fc.record({
  t: fc.constant("board" as const),
  street: fc.constantFrom("flop" as const, "turn" as const, "river" as const),
  cards: fc.array(cardArb, { minLength: 1, maxLength: 3 }),
});

const showdownArb: fc.Arbitrary<Showdown> = fc.record({
  t: fc.constant("showdown" as const),
  reveals: fc.array(fc.record({ seat: seatArb, cards: holePairArb }), { maxLength: 6 }),
});

const potArb: fc.Arbitrary<PotAwarded> = fc.record({
  t: fc.constant("pot" as const),
  potIndex: fc.integer({ min: 0, max: 4 }),
  seat: seatArb,
  amount: posChipsArb,
});

const endArb: fc.Arbitrary<HandEnd> = fc.record({
  t: fc.constant("end" as const),
  net: fc.array(fc.record({ seat: seatArb, net: fc.integer({ min: -5_000_000, max: 5_000_000 }) }), {
    maxLength: 9,
  }),
});

const eventArb: fc.Arbitrary<HandEvent> = fc.oneof(
  startArb,
  postArb,
  holeArb,
  actArb,
  boardArb,
  showdownArb,
  potArb,
  endArb,
);

// JSON-safe opaque annotation values (annotations are opaque in v1).
const annotationValueArb = fc.oneof(
  fc.string(),
  fc.integer(),
  fc.boolean(),
  fc.constant(null),
  fc.array(fc.string(), { maxLength: 3 }),
);

const recordArb: fc.Arbitrary<HandRecord> = fc
  .tuple(
    fc.string(),
    fc.string(),
    fc.string(),
    fc.record({
      variant: fc.constant("nlhe" as const),
      maxSeats: fc.integer({ min: 2, max: 10 }),
      sb: chipsArb,
      bb: chipsArb,
      ante: chipsArb,
    }),
    fc.array(eventArb, { maxLength: 40 }),
    fc.option(fc.dictionary(fc.string(), annotationValueArb, { maxKeys: 5 }), { nil: undefined }),
  )
  .map(([id, sessionId, seed, config, events, annotations]) => {
    const r: HandRecord = { v: 1, id, sessionId, seed, config, events };
    if (annotations !== undefined) r.annotations = annotations;
    return r;
  });

// ---------------------------------------------------------------------------
// Round-trip
// ---------------------------------------------------------------------------

describe("encodeHand/decodeHand", () => {
  it("round-trips the fixture hand exactly", () => {
    expect(decodeHand(encodeHand(fixtureHand))).toStrictEqual(fixtureHand);
  });

  it("round-trips the fixture hand through JSON exactly", () => {
    const json = JSON.stringify(encodeHand(fixtureHand));
    expect(decodeHand(JSON.parse(json))).toStrictEqual(fixtureHand);
  });

  it("compact encoding stays under budget for the fixture (approx bytes/hand)", () => {
    const bytes = JSON.stringify(encodeHand(fixtureHand)).length;
    expect(bytes).toBeGreaterThan(0);
    expect(bytes).toBeLessThan(1500);
  });

  it("property: decode(encode(record)) === record for arbitrary event sequences", () => {
    fc.assert(
      fc.property(recordArb, (record) => {
        expect(decodeHand(encodeHand(record))).toStrictEqual(record);
      }),
      { numRuns: 300, seed: 421 },
    );
  });

  it("property: encoding survives JSON.stringify/parse unchanged", () => {
    fc.assert(
      fc.property(recordArb, (record) => {
        const encoded = encodeHand(record);
        const revived = JSON.parse(JSON.stringify(encoded)) as unknown;
        expect(revived).toStrictEqual(encoded);
        expect(decodeHand(revived)).toStrictEqual(record);
      }),
      { numRuns: 200, seed: 422 },
    );
  });

  it("property: single events round-trip through their tuple form", () => {
    fc.assert(
      fc.property(eventArb, (event) => {
        expect(decodeEvent(encodeEvent(event))).toStrictEqual(event);
      }),
      { numRuns: 500, seed: 423 },
    );
  });
});

// ---------------------------------------------------------------------------
// Tuple shapes are locked (normative — docs/hand-format.md)
// ---------------------------------------------------------------------------

describe("compact tuple shapes", () => {
  it("act tuples match the documented layout", () => {
    expect(encodeEvent({ t: "act", seat: 3, kind: "call", amount: 200 })).toStrictEqual([
      "act",
      3,
      "call",
      200,
    ]);
    expect(encodeEvent({ t: "act", seat: 5, kind: "raise", toAmount: 300 })).toStrictEqual([
      "act",
      5,
      "raise",
      null,
      300,
    ]);
    expect(encodeEvent({ t: "act", seat: 4, kind: "fold" })).toStrictEqual(["act", 4, "fold"]);
    expect(encodeEvent({ t: "act", seat: 4, kind: "check", thinkTimeMs: 900 })).toStrictEqual([
      "act",
      4,
      "check",
      null,
      null,
      900,
    ]);
  });

  it("start/board/showdown/end tuples match the documented layout", () => {
    expect(
      encodeEvent({
        t: "start",
        handNumber: 7,
        button: 2,
        seats: [
          { seat: 1, stack: 10000 },
          { seat: 2, stack: 9000 },
        ],
        blinds: { sb: 50, bb: 100, ante: 10 },
      }),
    ).toStrictEqual(["start", 7, 2, [1, 10000, 2, 9000], 50, 100, 10]);
    expect(encodeEvent({ t: "board", street: "flop", cards: [50, 21, 0] })).toStrictEqual([
      "board",
      "flop",
      50,
      21,
      0,
    ]);
    expect(
      encodeEvent({ t: "showdown", reveals: [{ seat: 5, cards: [51, 47] }] }),
    ).toStrictEqual(["showdown", 5, 51, 47]);
    expect(
      encodeEvent({ t: "end", net: [{ seat: 1, net: -50 }, { seat: 2, net: 50 }] }),
    ).toStrictEqual(["end", 1, -50, 2, 50]);
    expect(encodeEvent({ t: "hole", seat: 2, cards: [8, 12] })).toStrictEqual(["hole", 2, 8, 12]);
    expect(encodeEvent({ t: "post", seat: 2, kind: "sb", amount: 50 })).toStrictEqual([
      "post",
      2,
      "sb",
      50,
    ]);
    expect(encodeEvent({ t: "pot", potIndex: 0, seat: 5, amount: 3050 })).toStrictEqual([
      "pot",
      0,
      5,
      3050,
    ]);
  });
});

// ---------------------------------------------------------------------------
// Malformed input is rejected
// ---------------------------------------------------------------------------

describe("decode rejects malformed input", () => {
  const base = encodeHand(fixtureHand);

  it("rejects non-objects and arrays", () => {
    expect(() => decodeHand(null)).toThrow(HandDecodeError);
    expect(() => decodeHand(42)).toThrow(HandDecodeError);
    expect(() => decodeHand([])).toThrow(HandDecodeError);
    expect(() => decodeHand("hand")).toThrow(HandDecodeError);
  });

  it("rejects unknown versions with an upgrade-on-read hint", () => {
    expect(() => decodeHand({ ...base, v: 2 })).toThrow(/unsupported version/);
    expect(() => decodeHand({ ...base, v: undefined })).toThrow(HandDecodeError);
  });

  it("rejects bad envelope fields", () => {
    expect(() => decodeHand({ ...base, id: 7 })).toThrow(HandDecodeError);
    expect(() => decodeHand({ ...base, events: "nope" })).toThrow(HandDecodeError);
    expect(() => decodeHand({ ...base, config: { variant: "plo", maxSeats: 6, sb: 50, bb: 100, ante: 0 } })).toThrow(
      /config\.variant/,
    );
    expect(() => decodeHand({ ...base, config: { variant: "nlhe", maxSeats: 1, sb: 50, bb: 100, ante: 0 } })).toThrow(
      /maxSeats/,
    );
    expect(() => decodeHand({ ...base, annotations: [] })).toThrow(HandDecodeError);
  });

  it("rejects malformed event tuples", () => {
    expect(() => decodeEvent([])).toThrow(HandDecodeError);
    expect(() => decodeEvent(["zap", 1])).toThrow(/unknown tag/);
    expect(() => decodeEvent(["act", 1])).toThrow(HandDecodeError); // too short
    expect(() => decodeEvent(["act", 1, "call", 100, null, 5, 9])).toThrow(HandDecodeError); // too long
    expect(() => decodeEvent(["act", 1, "shove", 100])).toThrow(/unknown kind/);
    expect(() => decodeEvent(["act", 1, "call", -5])).toThrow(HandDecodeError);
    expect(() => decodeEvent(["act", 1.5, "call", 100])).toThrow(HandDecodeError);
    expect(() => decodeEvent(["hole", 1, 52, 3])).toThrow(/out of range/);
    expect(() => decodeEvent(["hole", 1, 51])).toThrow(HandDecodeError);
    expect(() => decodeEvent(["board", "flop", "Ah"])).toThrow(HandDecodeError);
    expect(() => decodeEvent(["board", "preflop"])).toThrow(/unknown street/);
    expect(() => decodeEvent(["start", 1, 0, [1, 100, 2], 50, 100, 0])).toThrow(/even length/);
    expect(() => decodeEvent(["showdown", 5, 51])).toThrow(/triples/);
    expect(() => decodeEvent(["end", 1])).toThrow(/pairs/);
    expect(() => decodeEvent(["post", 1, "straddle", 200])).toThrow(/unknown kind/);
    expect(() => decodeEvent(["pot", 0, 5])).toThrow(HandDecodeError);
  });
});
