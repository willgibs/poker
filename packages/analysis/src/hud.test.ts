import { cardToString } from "@poker/core";
import type { HandRecord } from "@poker/history";
import { describe, expect, it } from "vitest";
import {
  HUD_OBSERVATION_GATES,
  HUD_STAT_IDS,
  createHud,
  foldHandIntoHud,
  foldHandsIntoHud,
  hudFor,
} from "./hud";
import { hand } from "./test-helpers";

const HERO = 0;
const VILLAIN = 1;
const SEAT_MAP = { [VILLAIN]: "doris" };

/**
 * Heads-up: the villain is dealt a monster, folds preflop face-down, and the
 * hand ends with no showdown. Nobody at a real table would ever learn what
 * that fold was — and neither may the HUD.
 */
function mucksAMonster(n: number): HandRecord {
  return hand({ handNumber: n, seats: [HERO, VILLAIN], button: HERO, bb: 100, id: `muck-${n}` })
    .blinds()
    .dealTo(HERO, "7c", "2d")
    .dealTo(VILLAIN, "As", "Ad") // the secret
    .raise(HERO, 300)
    .fold(VILLAIN)
    .award(HERO)
    .build();
}

/** Heads-up hand that reaches showdown with both hands tabled. */
function showsDown(n: number, villainCards: [string, string] = ["Kh", "Kd"]): HandRecord {
  return hand({
    handNumber: n,
    seats: [HERO, VILLAIN],
    button: HERO,
    bb: 100,
    id: `showdown-${n}`,
    board: ["Qc", "9d", "2s", "5h", "3c"],
  })
    .blinds()
    .dealTo(HERO, "7c", "6d")
    .dealTo(VILLAIN, villainCards[0], villainCards[1])
    .call(HERO)
    .check(VILLAIN)
    .flop()
    .check(VILLAIN)
    .check(HERO)
    .turn()
    .check(VILLAIN)
    .check(HERO)
    .river()
    .check(VILLAIN)
    .check(HERO)
    .showdown(VILLAIN, HERO)
    .award(VILLAIN)
    .build();
}

describe("earned HUD — privacy", () => {
  it("learns nothing from hole cards it never saw", () => {
    const state = foldHandIntoHud(createHud(), mucksAMonster(1), {
      heroSeat: HERO,
      seatToCharacter: SEAT_MAP,
    });
    const doris = state.characters.doris;
    expect(doris?.handsObserved).toBe(1);
    expect(doris?.showdownsSeen).toBe(0);
    // No 169-class knowledge at all: every counter is still zero.
    expect(doris?.showdownClassCounts.every((n) => n === 0)).toBe(true);

    // AA is class index 0, so the strongest possible read is simply absent.
    expect(doris?.showdownClassCounts[0]).toBe(0);
  });

  it("produces an identical HUD whatever the villain mucked", () => {
    // The sharpest form of the guarantee: swap the folded hand from aces to
    // seven-deuce and every observation must be bit-for-bit the same. If any
    // code path read a card it should not have, this test fails.
    const opts = { heroSeat: HERO, seatToCharacter: SEAT_MAP };
    const withAces = foldHandIntoHud(createHud(), mucksAMonster(1), opts);
    const withTrash = foldHandIntoHud(
      createHud(),
      hand({ handNumber: 1, seats: [HERO, VILLAIN], button: HERO, bb: 100, id: "muck-1" })
        .blinds()
        .dealTo(HERO, "7c", "2d")
        .dealTo(VILLAIN, "8h", "3s")
        .raise(HERO, 300)
        .fold(VILLAIN)
        .award(HERO)
        .build(),
      opts,
    );
    expect(withTrash).toEqual(withAces);
    expect(JSON.stringify(withTrash)).toBe(JSON.stringify(withAces));
    // Sanity: the two records really did differ in the mucked hand.
    expect(cardToString(51)).toBe("As");
  });

  it("still records the public actions of a hand it saw no cards in", () => {
    const state = foldHandIntoHud(createHud(), mucksAMonster(1), {
      heroSeat: HERO,
      seatToCharacter: SEAT_MAP,
    });
    const doris = state.characters.doris;
    // A fold is public: it counts against VPIP.
    expect(doris?.counters.vpip).toEqual({ n: 0, d: 1 });
    expect(doris?.counters.pfr).toEqual({ n: 0, d: 1 });
  });

  it("learns exactly the classes shown at showdown, and only those", () => {
    let state = createHud();
    state = foldHandIntoHud(state, showsDown(1, ["Kh", "Kd"]), {
      heroSeat: HERO,
      seatToCharacter: SEAT_MAP,
    });
    state = foldHandIntoHud(state, mucksAMonster(2), {
      heroSeat: HERO,
      seatToCharacter: SEAT_MAP,
    });
    const readout = hudFor(state, "doris");
    expect(readout?.handsObserved).toBe(2);
    expect(readout?.showdownsSeen).toBe(1);
    expect(readout?.showdownClasses).toEqual([{ label: "KK", count: 1 }]);
  });

  it("is unchanged whether or not the record contains villain hole events", () => {
    // The projection is the guarantee: stripping the hole events by hand must
    // produce a byte-identical HUD.
    const full = mucksAMonster(3);
    const stripped: HandRecord = {
      ...full,
      events: full.events.filter((e) => e.t !== "hole" || e.seat === HERO),
    };
    const opts = { heroSeat: HERO, seatToCharacter: SEAT_MAP };
    expect(foldHandIntoHud(createHud(), full, opts)).toEqual(
      foldHandIntoHud(createHud(), stripped, opts),
    );
  });

  it("never tracks the hero", () => {
    const state = foldHandIntoHud(createHud(), showsDown(1), {
      heroSeat: HERO,
      seatToCharacter: { [HERO]: "hero", [VILLAIN]: "doris" },
    });
    expect(state.characters.hero).toBeUndefined();
    expect(state.characters.doris).toBeDefined();
  });

  it("ignores seats with no character id", () => {
    const state = foldHandIntoHud(createHud(), showsDown(1), {
      heroSeat: HERO,
      seatToCharacter: {},
    });
    expect(Object.keys(state.characters)).toEqual([]);
  });
});

describe("earned HUD — accumulation", () => {
  it("accumulates across records without mutating the previous state", () => {
    const first = foldHandIntoHud(createHud(), showsDown(1), {
      heroSeat: HERO,
      seatToCharacter: SEAT_MAP,
    });
    const second = foldHandIntoHud(first, showsDown(2, ["Ah", "Ac"]), {
      heroSeat: HERO,
      seatToCharacter: SEAT_MAP,
    });
    expect(first.characters.doris?.handsObserved).toBe(1);
    expect(second.characters.doris?.handsObserved).toBe(2);
    expect(second.characters.doris?.showdownsSeen).toBe(2);
    expect(hudFor(second, "doris")?.showdownClasses.map((c) => c.label).sort()).toEqual([
      "AA",
      "KK",
    ]);
  });

  it("accepts either a Map or a plain record for the seat mapping", () => {
    const viaMap = foldHandIntoHud(createHud(), showsDown(1), {
      heroSeat: HERO,
      seatToCharacter: new Map([[VILLAIN, "doris"]]),
    });
    const viaObject = foldHandIntoHud(createHud(), showsDown(1), {
      heroSeat: HERO,
      seatToCharacter: SEAT_MAP,
    });
    expect(viaMap).toEqual(viaObject);
  });

  it("counts VPIP, PFR and 3-bet from public actions", () => {
    const records: HandRecord[] = [];
    // Villain 3-bets 3 of 10 opens and folds the rest.
    for (let n = 1; n <= 10; n++) {
      const b = hand({
        handNumber: n,
        seats: [HERO, VILLAIN],
        button: HERO,
        bb: 100,
        id: `3bet-${n}`,
      })
        .blinds()
        .deal()
        .raise(HERO, 300);
      if (n <= 3) records.push(b.raise(VILLAIN, 900).fold(HERO).award(VILLAIN).build());
      else records.push(b.fold(VILLAIN).award(HERO).build());
    }
    const state = foldHandsIntoHud(createHud(), records, {
      heroSeat: HERO,
      seatToCharacter: SEAT_MAP,
    });
    const doris = state.characters.doris;
    expect(doris?.counters.threeBet).toEqual({ n: 3, d: 10 });
    expect(doris?.counters.vpip).toEqual({ n: 3, d: 10 });
    expect(doris?.counters.pfr).toEqual({ n: 3, d: 10 });
  });

  it("counts aggression factor as raw postflop bets over calls", () => {
    const record = hand({
      handNumber: 1,
      seats: [HERO, VILLAIN],
      button: HERO,
      bb: 100,
      stack: 50_000,
      board: ["Qc", "9d", "2s", "5h", "3c"],
    })
      .blinds()
      .deal()
      .call(HERO)
      .check(VILLAIN)
      .flop()
      .bet(VILLAIN, 200)
      .call(HERO)
      .turn()
      .bet(VILLAIN, 400)
      .call(HERO)
      .river()
      .check(VILLAIN)
      .bet(HERO, 500)
      .call(VILLAIN)
      .showdown(VILLAIN, HERO)
      .award(HERO)
      .build();
    const state = foldHandIntoHud(createHud(), record, {
      heroSeat: HERO,
      seatToCharacter: SEAT_MAP,
    });
    expect(state.characters.doris?.counters.af).toEqual({ n: 2, d: 1 });
  });
});

describe("earned HUD — observation gates", () => {
  it("withholds a stat until enough observations back it", () => {
    const records: HandRecord[] = [];
    for (let n = 1; n <= 5; n++) records.push(mucksAMonster(n));
    const state = foldHandsIntoHud(createHud(), records, {
      heroSeat: HERO,
      seatToCharacter: SEAT_MAP,
    });
    const readout = hudFor(state, "doris");
    expect(readout?.stats.vpip.observations).toBe(5);
    expect(readout?.stats.vpip.gate).toBe(HUD_OBSERVATION_GATES.vpip);
    expect(readout?.stats.vpip.ready).toBe(false);
    // The value still exists — the gate governs display, not computation.
    expect(readout?.stats.vpip.value).toBe(0);
  });

  it("marks a stat ready once its gate is cleared", () => {
    const records: HandRecord[] = [];
    for (let n = 1; n <= HUD_OBSERVATION_GATES.vpip; n++) records.push(mucksAMonster(n));
    const readout = hudFor(
      foldHandsIntoHud(createHud(), records, { heroSeat: HERO, seatToCharacter: SEAT_MAP }),
      "doris",
    );
    expect(readout?.stats.vpip.ready).toBe(true);
    expect(readout?.stats.threeBet.ready).toBe(false); // no 3-bet spots occurred
  });

  it("reports every tracked stat, with no value where there is no denominator", () => {
    const readout = hudFor(
      foldHandIntoHud(createHud(), mucksAMonster(1), {
        heroSeat: HERO,
        seatToCharacter: SEAT_MAP,
      }),
      "doris",
    );
    expect(Object.keys(readout?.stats ?? {}).sort()).toEqual([...HUD_STAT_IDS].sort());
    expect(readout?.stats.wtsd.value).toBeUndefined();
    expect(readout?.stats.af.value).toBeUndefined();
  });

  it("returns undefined for a character it has never seen", () => {
    expect(hudFor(createHud(), "nobody")).toBeUndefined();
  });

  it("survives a JSON round-trip — the HUD persists across sessions", () => {
    const state = foldHandIntoHud(createHud(), showsDown(1), {
      heroSeat: HERO,
      seatToCharacter: SEAT_MAP,
    });
    const restored = JSON.parse(JSON.stringify(state)) as typeof state;
    expect(restored).toEqual(state);
    expect(hudFor(restored, "doris")).toEqual(hudFor(state, "doris"));
  });
});
