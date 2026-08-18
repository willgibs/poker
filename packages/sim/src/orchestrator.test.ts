/**
 * Orchestrator properties: the seed hierarchy and mid-session bookkeeping.
 *
 * `session.test.ts` already proves whole-session replay is byte-identical and
 * that a single hand's deck is a pure function of `(sessionSeed, handNumber)`
 * across differing stack configs. This file goes one layer deeper into the
 * seed hierarchy documented at the top of `session.ts` — `hand/{N}/deck` is a
 * standalone, seed-keyed derivation, so a hand's deal is reconstructable
 * without simulating anything before it — and then spends most of its budget
 * on invariants a long, imperfect-world session must hold at every hand
 * boundary: chip conservation, correct button rotation around busted seats,
 * and the two re-entry house rules (`"off"`, `"rebuy-on-bust"`).
 */

import { describe, expect, it } from "vitest";
import { type Card, freshDeck } from "@poker/core";
import type { HandEvent, HandRecord } from "@poker/history";
import { streamFor } from "@poker/rng";
import { createSession } from "./session";
import type { SessionConfig } from "./types";

const SIX_MAX = ["barry", "doris", "hank", "rocco", "silas", "vera"] as const;

function selfPlayConfig(overrides: Partial<SessionConfig> = {}): SessionConfig {
  return {
    sessionSeed: "orchestrator-test",
    format: "cash",
    stakes: { sbCents: 50, bbCents: 100 },
    seats: SIX_MAX.map((personaId) => ({ personaId })),
    stackCents: 20_000,
    dealerOptions: { rebuy: "top-up" },
    annotations: { traces: false, grades: false },
    ...overrides,
  };
}

/**
 * Reconstructs the deck the engine dealt for `handNumber`, from `sessionSeed`
 * alone — no session run required. Mirrors the dealing convention documented
 * in `packages/engine/src/types.ts`: clockwise from the seat left of the
 * button, two consecutive cards per seat (button dealt last), then a
 * burn-free flop/turn/river.
 */
function expectedDeal(
  sessionSeed: string,
  handNumber: number,
  button: number,
  seatNumbers: readonly number[],
): { holeBySeat: Map<number, readonly [Card, Card]>; board: readonly Card[] } {
  const deck = streamFor(sessionSeed, `hand/${handNumber}/deck`).shuffle(freshDeck());
  const n = seatNumbers.length;
  const buttonIdx = seatNumbers.indexOf(button);
  const dealOrder: number[] = [];
  for (let i = 1; i <= n; i++) {
    dealOrder.push(seatNumbers[(buttonIdx + i) % n] as number);
  }
  let cursor = 0;
  const holeBySeat = new Map<number, readonly [Card, Card]>();
  for (const seat of dealOrder) {
    holeBySeat.set(seat, [deck[cursor] as Card, deck[cursor + 1] as Card]);
    cursor += 2;
  }
  const board = deck.slice(cursor, cursor + 5);
  return { holeBySeat, board };
}

/** The cards an actual hand record dealt, read back off its events. */
function dealtCards(record: HandRecord): {
  holeBySeat: Map<number, readonly [Card, Card]>;
  board: readonly Card[];
} {
  const holeBySeat = new Map<number, readonly [Card, Card]>();
  const board: Card[] = [];
  for (const e of record.events as HandEvent[]) {
    if (e.t === "hole") holeBySeat.set(e.seat, e.cards);
    if (e.t === "board") board.push(...e.cards);
  }
  return { holeBySeat, board };
}

// ---------------------------------------------------------------------------

describe("seed hierarchy", () => {
  it("hand N's full deal is reproducible in isolation from its handSeed alone", () => {
    // The only role the session plays here is producing "actual" — every
    // "expected" card below comes from calling streamFor directly on
    // (sessionSeed, handNumber), with hands 1..N-1 never touched by this math.
    const sessionSeed = "isolation-check";
    const session = createSession(selfPlayConfig({ sessionSeed }));
    const records: HandRecord[] = [];
    for (let i = 0; i < 20; i++) {
      const step = session.nextHand();
      if (step.awaitingHero) throw new Error("self-play must never pause");
      records.push(step.outcome.record);
    }

    for (const handNumber of [1, 5, 20]) {
      const record = records[handNumber - 1] as HandRecord;
      const start = record.events[0];
      if (start?.t !== "start") throw new Error("first event must be start");
      const seatNumbers = start.seats.map((s) => s.seat);

      const expected = expectedDeal(sessionSeed, handNumber, start.button, seatNumbers);
      const actual = dealtCards(record);

      expect(actual.board).toEqual(expected.board);
      for (const [seat, cards] of expected.holeBySeat) {
        expect(actual.holeBySeat.get(seat)).toEqual(cards);
      }
    }
  });

  it("the hand/{N}/deck stream is a deterministic, seed-and-number-keyed derivation", () => {
    // Same (sessionSeed, handNumber) always reshuffles identically...
    const a = streamFor("seed-alpha", "hand/1/deck").shuffle(freshDeck());
    const aAgain = streamFor("seed-alpha", "hand/1/deck").shuffle(freshDeck());
    expect(aAgain).toEqual(a);

    // ...a different sessionSeed decorrelates completely at the same hand...
    const b = streamFor("seed-beta", "hand/1/deck").shuffle(freshDeck());
    expect(b).not.toEqual(a);

    // ...and so does a different hand number under the same sessionSeed.
    const aHandTwo = streamFor("seed-alpha", "hand/2/deck").shuffle(freshDeck());
    expect(aHandTwo).not.toEqual(a);
  });

  it("propagates session-seed determinism through a whole live session's hand 1", () => {
    const stepFrom = (sessionSeed: string) => {
      const session = createSession(selfPlayConfig({ sessionSeed }));
      const step = session.nextHand();
      if (step.awaitingHero) throw new Error("self-play must never pause");
      return dealtCards(step.outcome.record);
    };
    const alpha = stepFrom("seed-alpha");
    const alphaAgain = stepFrom("seed-alpha");
    const beta = stepFrom("seed-beta");
    expect(alphaAgain).toEqual(alpha);
    expect(beta).not.toEqual(alpha);
  });
});

// ---------------------------------------------------------------------------

describe("mid-session invariants over a seeded 200-hand run", () => {
  // Chip conservation across hand boundaries already has a dedicated 200-hand
  // exercise in rake.test.ts (including the rake ledger's own arithmetic);
  // this one's job is button rotation at the same scale — session.test.ts
  // only exercises 8 hands, not enough to reveal an off-by-one in the wrap.
  it("rotates the button through an exact clockwise cycle at every hand boundary", () => {
    const session = createSession(selfPlayConfig({ sessionSeed: "invariants-200" }));
    const buttons: number[] = [];

    for (let i = 0; i < 200; i++) {
      const step = session.nextHand();
      if (step.awaitingHero) throw new Error("self-play must never pause");
      buttons.push(step.outcome.button);
    }

    // Every seat stays funded throughout (top-up rebuy), so rotation is a
    // plain clockwise cycle of the seat count, starting from the configured
    // button (seat 0 by default).
    expect(buttons).toEqual(Array.from({ length: 200 }, (_, i) => i % SIX_MAX.length));
    expect(session.view().handsPlayed).toBe(200);
  }, 20_000);
});

describe("busted-player handling (rebuy: off)", () => {
  it("skips busted seats when choosing the button and finishes once fewer than two remain funded", () => {
    const session = createSession({
      sessionSeed: "bust-skip",
      format: "cash",
      stakes: { sbCents: 50, bbCents: 100 },
      seats: [{ personaId: "barry" }, { personaId: "doris" }, { personaId: "hank" }, { personaId: "rocco" }],
      // Two deliberately short stacks (1.5bb) against two deep ones — with no
      // rebuy, both should bust and the table should fold to heads-up (and
      // then finish) well inside the 200-hand ceiling.
      stackCents: [150, 150, 20_000, 20_000],
      dealerOptions: { rebuy: "off" },
      annotations: { traces: false, grades: false },
    });

    const bustedBeforeThisHand = new Set<number>();
    let handsPlayed = 0;
    while (session.status() === "ready" && handsPlayed < 200) {
      const before = session.view().stacks;
      const step = session.nextHand();
      if (step.awaitingHero) throw new Error("self-play must never pause");
      handsPlayed += 1;

      // A seat that was already busted before this hand is never dealt in
      // again, and in particular never holds the button.
      expect(bustedBeforeThisHand.has(step.outcome.button)).toBe(false);
      for (const seat of step.outcome.seats) expect(bustedBeforeThisHand.has(seat)).toBe(false);

      const view = session.view();
      expect(view.stacks.reduce((a, b) => a + b, 0) + view.rakeTotalCents).toBe(view.buyInTotalCents);

      before.forEach((stack, seat) => {
        if (stack === 0) bustedBeforeThisHand.add(seat);
      });
    }

    // The scenario must actually have exercised a bust for the test to mean
    // anything.
    expect(bustedBeforeThisHand.size).toBeGreaterThan(0);
    expect(session.status()).toBe("finished");
    expect(() => session.nextHand()).toThrow(/session is over/);
  }, 20_000);
});

describe("re-entry invariant (rebuy: rebuy-on-bust)", () => {
  it("re-funds a seat to its own configured buy-in only once it hits minStackCents, leaving every other seat's carry-over untouched", () => {
    const shortBuyIn = 500; // 5bb — busts, and re-enters, repeatedly
    const buyIn = 20_000;
    const session = createSession({
      sessionSeed: "re-entry",
      format: "cash",
      stakes: { sbCents: 50, bbCents: 100 },
      seats: [{ personaId: "barry" }, { personaId: "doris" }, { personaId: "hank" }, { personaId: "rocco" }],
      stackCents: [shortBuyIn, buyIn, buyIn, buyIn],
      dealerOptions: { rebuy: "rebuy-on-bust" },
      annotations: { traces: false, grades: false },
    });

    let reentries = 0;
    let prevBuyInTotalCents = -1;
    for (let i = 0; i < 120; i++) {
      const before = session.view().stacks;
      const step = session.nextHand();
      if (step.awaitingHero) throw new Error("self-play must never pause");

      const start = step.outcome.record.events[0];
      if (start?.t !== "start") throw new Error("first event must be start");
      const dealtStackBySeat = new Map(start.seats.map((s) => [s.seat, s.stack]));

      before.forEach((stackBefore, seat) => {
        const dealtStack = dealtStackBySeat.get(seat);
        expect(dealtStack, `seat ${seat} must be dealt in every hand under rebuy-on-bust`).toBeDefined();
        if (stackBefore === 0) {
          // Busted below (at) minStackCents (default 0): topped back up to
          // its own configured buy-in, a genuine re-entry.
          expect(dealtStack).toBe(seat === 0 ? shortBuyIn : buyIn);
          reentries += 1;
        } else {
          // Anything still funded carries its stack over unmodified.
          expect(dealtStack).toBe(stackBefore);
        }
      });

      const view = session.view();
      expect(view.stacks.reduce((a, b) => a + b, 0) + view.rakeTotalCents).toBe(view.buyInTotalCents);
      expect(view.buyInTotalCents).toBeGreaterThanOrEqual(prevBuyInTotalCents);
      prevBuyInTotalCents = view.buyInTotalCents;
    }

    // The short stack must have busted and re-entered more than once for the
    // house rule to have actually been exercised, not merely permitted.
    expect(reentries).toBeGreaterThan(1);
  }, 20_000);
});
