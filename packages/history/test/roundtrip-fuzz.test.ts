/**
 * Round-trip property tests over *structurally valid* generated hand logs.
 *
 * `codec.test.ts`'s `recordArb` fuzzes type-valid-but-structurally-arbitrary
 * event tuples (great for codec robustness, but e.g. it happily emits a
 * `raise` carrying both `amount` and `toAmount`, or a `board` before any
 * `start`). This file is the stronger companion: a small self-contained
 * seeded action policy plays out a full hand (blinds, deal, streets that
 * fold out or run to showdown, split/side pots, a balanced `end`) that
 * satisfies every rule in `validateEvents` — i.e. what a real engine-driven
 * hand log looks like — then round-trips it through the codec.
 *
 * NOTE: this package may only depend on @poker/core (see CLAUDE.md's package
 * map); @poker/engine sits *above* @poker/history in the dependency graph,
 * so the "seeded action policy" here is a local, minimal stand-in — not an
 * import of the real reducer. It only needs to be structurally valid; the
 * engine package's own property tests (packages/engine/test/property.test.ts)
 * cover betting-legality against the real reducer.
 */

import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { HAND_RECORD_VERSION, decisionRefs, decodeHand, encodeHand, validateEvents } from "../src/index";
import type { BoardStreet, HandEvent, HandRecord } from "../src/index";

// ---------------------------------------------------------------------------
// Tiny seeded PRNG (test-only, self-contained — see note above on why this
// isn't shared with packages/engine/test's identical helper).
// ---------------------------------------------------------------------------

interface Lcg {
  next(): number;
  int(n: number): number;
}

function lcg(seed: number): Lcg {
  let s = seed >>> 0 || 1;
  const next = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s;
  };
  return { next, int: (n: number) => next() % n };
}

function pick<T>(rng: Lcg, arr: readonly T[]): T {
  const v = arr[rng.int(arr.length)];
  if (v === undefined) throw new Error("pick: empty array");
  return v;
}

function shuffledDeck(rng: Lcg): number[] {
  const deck = Array.from({ length: 52 }, (_, i) => i);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const t = deck[i]!;
    deck[i] = deck[j]!;
    deck[j] = t;
  }
  return deck;
}

// ---------------------------------------------------------------------------
// Seeded action policy → a structurally valid HandRecord
// ---------------------------------------------------------------------------

const STREETS: ReadonlyArray<{ name: BoardStreet | "preflop"; cardCount: number }> = [
  { name: "preflop", cardCount: 0 },
  { name: "flop", cardCount: 3 },
  { name: "turn", cardCount: 1 },
  { name: "river", cardCount: 1 },
];

function generateHand(seed: number): HandRecord {
  const rng = lcg(seed);

  const seatCount = 2 + rng.int(5); // 2..6
  const seatOffset = rng.int(3); // exercise non-zero-based seat numbering
  const seatNums = Array.from({ length: seatCount }, (_, i) => i + seatOffset);
  const stacks = seatNums.map(() => 500 + rng.int(200_00));
  const buttonIdx = rng.int(seatCount);
  const button = seatNums[buttonIdx]!;
  const sb = 50;
  const bb = 100;
  const ante = rng.int(4) === 0 ? 25 : 0;

  const deck = shuffledDeck(rng);
  let cursor = 0;
  const draw = (n: number): number[] => {
    const cards = deck.slice(cursor, cursor + n);
    cursor += n;
    return cards;
  };

  const events: HandEvent[] = [];
  events.push({
    t: "start",
    handNumber: 1 + rng.int(500),
    button,
    seats: seatNums.map((seat, i) => ({ seat, stack: stacks[i]! })),
    blinds: { sb, bb, ante },
  });

  if (ante > 0) {
    for (let k = 1; k <= seatCount; k++) {
      const idx = (buttonIdx + k) % seatCount;
      events.push({ t: "post", seat: seatNums[idx]!, kind: "ante", amount: ante });
    }
  }

  const sbIdx = seatCount === 2 ? buttonIdx : (buttonIdx + 1) % seatCount;
  const bbIdx = (sbIdx + 1) % seatCount;
  events.push({ t: "post", seat: seatNums[sbIdx]!, kind: "sb", amount: sb });
  events.push({ t: "post", seat: seatNums[bbIdx]!, kind: "bb", amount: bb });

  const holeBySeat = new Map<number, [number, number]>();
  for (let k = 1; k <= seatCount; k++) {
    const idx = (buttonIdx + k) % seatCount;
    const seat = seatNums[idx]!;
    const drawn = draw(2);
    const pair: [number, number] = [drawn[0]!, drawn[1]!];
    holeBySeat.set(seat, pair);
    events.push({ t: "hole", seat, cards: pair });
  }

  const actingOrder = Array.from({ length: seatCount }, (_, k) => seatNums[(bbIdx + 1 + k) % seatCount]!);
  const folded = new Set<number>();
  let wentToShowdown = false;

  for (const street of STREETS) {
    const remainingBefore = actingOrder.filter((s) => !folded.has(s));
    if (remainingBefore.length <= 1) break;

    if (street.name !== "preflop") {
      events.push({ t: "board", street: street.name, cards: draw(street.cardCount) });
    }

    let betOpened = street.name === "preflop"; // the BB post already sets a level preflop
    let toAmount = street.name === "preflop" ? bb : 0;

    for (const seatNo of remainingBefore) {
      if (folded.has(seatNo)) continue;
      if (actingOrder.filter((s) => !folded.has(s)).length <= 1) break;

      const roll = rng.int(10);
      if (!betOpened) {
        if (roll < 6) {
          events.push({ t: "act", seat: seatNo, kind: "check" });
        } else if (roll < 9) {
          const amount = 50 + rng.int(2000);
          events.push({ t: "act", seat: seatNo, kind: "bet", amount });
          betOpened = true;
          toAmount = amount;
        } else {
          events.push({ t: "act", seat: seatNo, kind: "fold" });
          folded.add(seatNo);
        }
      } else if (roll < 5) {
        events.push({ t: "act", seat: seatNo, kind: "call", amount: 50 + rng.int(1000) });
      } else if (roll < 8) {
        toAmount += 50 + rng.int(2000);
        events.push({ t: "act", seat: seatNo, kind: "raise", toAmount });
      } else {
        events.push({ t: "act", seat: seatNo, kind: "fold" });
        folded.add(seatNo);
      }
    }

    if (street.name === "river") wentToShowdown = true;
  }

  const finalActive = actingOrder.filter((s) => !folded.has(s));
  const showdownHappens = wentToShowdown && finalActive.length >= 2;

  if (showdownHappens) {
    events.push({
      t: "showdown",
      reveals: finalActive.map((seat) => ({ seat, cards: holeBySeat.get(seat)! })),
    });
  }

  const winners = showdownHappens && rng.int(4) === 0 && finalActive.length >= 2 ? finalActive.slice(0, 2) : [pick(rng, finalActive)];
  const totalPot = 1000 + rng.int(100_00);
  if (winners.length === 1) {
    events.push({ t: "pot", potIndex: 0, seat: winners[0]!, amount: totalPot });
  } else {
    const half = Math.floor(totalPot / 2);
    events.push({ t: "pot", potIndex: 0, seat: winners[0]!, amount: half });
    events.push({ t: "pot", potIndex: 0, seat: winners[1]!, amount: totalPot - half });
  }
  if (showdownHappens && rng.int(5) === 0) {
    events.push({ t: "pot", potIndex: 1, seat: pick(rng, finalActive), amount: 1 + rng.int(5000) });
  }

  // Balanced nets: arbitrary deltas for every seat but the last, whose net
  // is forced so the whole array sums to exactly 0 (chip conservation).
  const deltas: number[] = [];
  for (let i = 0; i < seatNums.length - 1; i++) deltas.push(rng.int(4001) - 2000);
  deltas.push(-deltas.reduce((a, b) => a + b, 0));
  events.push({ t: "end", net: seatNums.map((seat, i) => ({ seat, net: deltas[i]! })) });

  let annotations: Record<string, unknown> | undefined;
  if (rng.int(2) === 0) {
    const refs = decisionRefs(events);
    if (refs.length > 0) {
      annotations = {};
      const count = 1 + rng.int(Math.min(3, refs.length));
      for (let i = 0; i < count; i++) {
        const ref = pick(rng, refs);
        annotations[ref.id] = { grade: pick(rng, ["A", "B", "C", "D"]), note: `auto-${seed}-${i}` };
      }
    }
  }

  const record: HandRecord = {
    v: HAND_RECORD_VERSION,
    id: `gen-hand-${seed}`,
    sessionId: `gen-sess-${seed % 97}`,
    seed: `seed-${seed}`,
    config: { variant: "nlhe", maxSeats: Math.max(seatCount, 2), sb, bb, ante },
    events,
  };
  if (annotations !== undefined) record.annotations = annotations;
  return record;
}

const seedArb = fc.integer({ min: 1, max: 0x7fffffff });

describe("generated valid hand logs (seeded action policy)", () => {
  it("are structurally valid per validateEvents across many seeds", () => {
    fc.assert(
      fc.property(seedArb, (seed) => {
        const record = generateHand(seed);
        const result = validateEvents(record.events);
        expect(result.errors).toStrictEqual([]);
        expect(result.ok).toBe(true);
      }),
      { numRuns: 300, seed: 90901 },
    );
  });

  it("round-trip through encodeHand/decodeHand with the version field intact", () => {
    fc.assert(
      fc.property(seedArb, (seed) => {
        const record = generateHand(seed);
        const decoded = decodeHand(encodeHand(record));
        expect(decoded).toStrictEqual(record);
        expect(decoded.v).toBe(HAND_RECORD_VERSION);
      }),
      { numRuns: 300, seed: 90902 },
    );
  });

  it("round-trip survives a JSON.stringify/JSON.parse hop unchanged", () => {
    fc.assert(
      fc.property(seedArb, (seed) => {
        const record = generateHand(seed);
        const wire = JSON.stringify(encodeHand(record));
        const decoded = decodeHand(JSON.parse(wire));
        expect(decoded).toStrictEqual(record);
      }),
      { numRuns: 200, seed: 90903 },
    );
  });

  it("every generated annotation key is a decisionId that decisionRefs also derives", () => {
    fc.assert(
      fc.property(seedArb, (seed) => {
        const record = generateHand(seed);
        if (record.annotations === undefined) return;
        const ids = new Set(decisionRefs(record.events).map((r) => r.id));
        for (const key of Object.keys(record.annotations)) {
          expect(ids.has(key)).toBe(true);
        }
      }),
      { numRuns: 300, seed: 90904 },
    );
  });
});
