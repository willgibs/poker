/**
 * Earned HUD — per-character stats built ONLY from what hero legitimately saw.
 *
 * PRD Q20: "Earned HUD — VPIP/PFR/3bet/AF built only from observed hands,
 * persists across sessions." The word that does the work is *observed*. A HUD
 * assembled from the engine's omniscient view would be a cheat with a nice
 * font, and it would teach the wrong lesson: reads are earned by paying
 * attention over hundreds of hands, and the product's job is to make that feel
 * real.
 *
 * ## How the guarantee is enforced
 *
 * Not by discipline — by construction. {@link foldHandIntoHud} rebuilds the
 * hand from {@link publicEvents}, the projection that strips every `hole` event
 * belonging to another seat. Villain hole cards are therefore not "ignored";
 * they are absent from the data structure this module ever holds. The only
 * cards it can learn are the ones in a `showdown` event, which every player at
 * the table saw.
 *
 * A `hud.test.ts` case constructs a hand where a villain folds a monster
 * face-down and asserts that no trace of it reaches the HUD state.
 *
 * ## Observation gates
 *
 * A HUD number shown too early is a lie with a decimal point. Every stat
 * carries its observation count and a `ready` flag against a per-stat gate.
 * These gates are much smaller than the leak-report gates in `concepts.ts` —
 * a HUD is a live read on one opponent, not a verdict on the hero's game — so
 * they are house numbers, deliberately named as such.
 */

import { HAND169_COUNT, hand169, label169 } from "@poker/core";
import type { HandRecord } from "@poker/history";
import { buildHandView, publicEvents } from "./replay";

/** Stats the earned HUD tracks. */
export type HudStatId = "vpip" | "pfr" | "threeBet" | "foldToThreeBet" | "af" | "wtsd" | "wsd";

/** All HUD stat ids. */
export const HUD_STAT_IDS: readonly HudStatId[] = [
  "vpip",
  "pfr",
  "threeBet",
  "foldToThreeBet",
  "af",
  "wtsd",
  "wsd",
];

/**
 * Observations required before a HUD stat may be DISPLAYED. House numbers —
 * a live read on one opponent, not the taxonomy's leak-report evidence gates.
 */
export const HUD_OBSERVATION_GATES: Readonly<Record<HudStatId, number>> = {
  vpip: 20,
  pfr: 20,
  threeBet: 25,
  foldToThreeBet: 15,
  af: 20,
  wtsd: 15,
  wsd: 10,
};

interface Counter {
  n: number;
  d: number;
}

/** Accumulated observations of one character. JSON-safe for persistence. */
export interface CharacterObservations {
  characterId: string;
  /** Hands hero was at the table with this character and they were dealt in. */
  handsObserved: number;
  /** Showdowns where this character's cards were revealed to the table. */
  showdownsSeen: number;
  counters: Record<HudStatId, Counter>;
  /**
   * Count of each canonical 169 class this character has SHOWN DOWN, indexed
   * by class. The only card knowledge a HUD is entitled to.
   */
  showdownClassCounts: number[];
}

/** The whole HUD: observations per character, accumulated across sessions. */
export interface HudState {
  /** Format stamp, so a persisted HUD can be migrated later. */
  v: 1;
  characters: Record<string, CharacterObservations>;
}

/** One displayable HUD number. */
export interface HudStat {
  stat: HudStatId;
  /** Percent for rates, ratio for `af`. Undefined when nothing to compute. */
  value?: number;
  observations: number;
  gate: number;
  /** True when `observations` cleared the gate — only then should it be shown. */
  ready: boolean;
}

/** A character's readable HUD line. */
export interface HudReadout {
  characterId: string;
  handsObserved: number;
  showdownsSeen: number;
  stats: Record<HudStatId, HudStat>;
  /** 169 classes seen at showdown, most frequent first. */
  showdownClasses: { label: string; count: number }[];
}

/** A fresh, empty HUD. */
export function createHud(): HudState {
  return { v: 1, characters: {} };
}

function emptyCharacter(characterId: string): CharacterObservations {
  const counters = {} as Record<HudStatId, Counter>;
  for (const id of HUD_STAT_IDS) counters[id] = { n: 0, d: 0 };
  return {
    characterId,
    handsObserved: 0,
    showdownsSeen: 0,
    counters,
    showdownClassCounts: new Array<number>(HAND169_COUNT).fill(0),
  };
}

export interface FoldHudOptions {
  /** Hero's seat — the only seat whose `hole` event survives the projection. */
  heroSeat: number;
  /** Stable character id per seat. Seats without one are not tracked. */
  seatToCharacter: ReadonlyMap<number, string> | Readonly<Record<number, string>>;
}

function characterOf(opts: FoldHudOptions, seat: number): string | undefined {
  const map = opts.seatToCharacter;
  if (map instanceof Map) return map.get(seat);
  return (map as Record<number, string>)[seat];
}

/**
 * Fold one hand into the HUD, returning a NEW state (the input is untouched).
 *
 * The hand is reconstructed from the public projection, so this function
 * cannot see villain hole cards even if it wanted to.
 */
export function foldHandIntoHud(
  state: HudState,
  record: HandRecord,
  opts: FoldHudOptions,
): HudState {
  const view = buildHandView(record, publicEvents(record.events, opts.heroSeat));
  const next: HudState = { v: 1, characters: { ...state.characters } };

  const pre = view.actions.filter((a) => a.street === "preflop");

  for (const seat of view.seats) {
    if (seat.seat === opts.heroSeat) continue;
    const characterId = characterOf(opts, seat.seat);
    if (characterId === undefined) continue;

    const prev = next.characters[characterId] ?? emptyCharacter(characterId);
    const c: CharacterObservations = {
      characterId,
      handsObserved: prev.handsObserved + 1,
      showdownsSeen: prev.showdownsSeen,
      counters: cloneCounters(prev.counters),
      showdownClassCounts: prev.showdownClassCounts.slice(),
    };

    const mine = pre.filter((a) => a.seat === seat.seat);
    const first = mine[0];

    bump(c, "vpip", mine.some((a) => a.kind === "call" || a.kind === "raise"));
    bump(c, "pfr", mine.some((a) => a.kind === "raise"));

    if (first !== undefined) {
      const raisesBefore = pre.filter(
        (a) => a.kind === "raise" && a.eventIndex < first.eventIndex,
      ).length;
      if (raisesBefore === 1) bump(c, "threeBet", first.kind === "raise");
    }

    // Opened, then faced a re-raise.
    const open = mine.find(
      (a) =>
        a.kind === "raise" &&
        pre.filter((p) => p.kind === "raise" && p.eventIndex < a.eventIndex).length === 0,
    );
    if (open !== undefined) {
      const threeBet = pre.find((a) => a.kind === "raise" && a.eventIndex > open.eventIndex);
      if (threeBet !== undefined) {
        const response = mine.find((a) => a.eventIndex > threeBet.eventIndex);
        if (response !== undefined) bump(c, "foldToThreeBet", response.kind === "fold");
      }
    }

    // Aggression factor: postflop bets+raises over calls (raw counts).
    const post = view.actions.filter((a) => a.street !== "preflop" && a.seat === seat.seat);
    c.counters.af.n += post.filter((a) => a.kind === "bet" || a.kind === "raise").length;
    c.counters.af.d += post.filter((a) => a.kind === "call").length;

    if (seat.sawFlop) bump(c, "wtsd", seat.wentToShowdown);
    if (seat.wentToShowdown) bump(c, "wsd", seat.awarded > 0);

    // The only card knowledge a HUD earns: cards shown at showdown.
    if (seat.revealed !== null) {
      c.showdownsSeen += 1;
      const cls = hand169(seat.revealed[0], seat.revealed[1]).index;
      c.showdownClassCounts[cls] = (c.showdownClassCounts[cls] ?? 0) + 1;
    }

    next.characters[characterId] = c;
  }

  return next;
}

function cloneCounters(src: Record<HudStatId, Counter>): Record<HudStatId, Counter> {
  const out = {} as Record<HudStatId, Counter>;
  for (const id of HUD_STAT_IDS) {
    const c = src[id] ?? { n: 0, d: 0 };
    out[id] = { n: c.n, d: c.d };
  }
  return out;
}

function bump(c: CharacterObservations, stat: HudStatId, hit: boolean): void {
  const counter = c.counters[stat];
  counter.d += 1;
  if (hit) counter.n += 1;
}

/** Fold a whole corpus into the HUD, in order. */
export function foldHandsIntoHud(
  state: HudState,
  records: readonly HandRecord[],
  opts: FoldHudOptions,
): HudState {
  let acc = state;
  for (const r of records) acc = foldHandIntoHud(acc, r, opts);
  return acc;
}

/** Readable HUD for one character, gates applied. */
export function hudFor(state: HudState, characterId: string): HudReadout | undefined {
  const c = state.characters[characterId];
  if (c === undefined) return undefined;
  const stats = {} as Record<HudStatId, HudStat>;
  for (const id of HUD_STAT_IDS) {
    const counter = c.counters[id] ?? { n: 0, d: 0 };
    const gate = HUD_OBSERVATION_GATES[id];
    const observations = id === "af" ? counter.n + counter.d : counter.d;
    const stat: HudStat = {
      stat: id,
      observations,
      gate,
      ready: observations >= gate,
    };
    // A zero denominator has no value to report — including aggression factor
    // with no calls behind it, where a ratio would be a fiction, not a read.
    if (counter.d > 0) {
      stat.value = id === "af" ? counter.n / counter.d : (100 * counter.n) / counter.d;
    }
    stats[id] = stat;
  }
  const showdownClasses: { label: string; count: number }[] = [];
  for (let i = 0; i < HAND169_COUNT; i++) {
    const count = c.showdownClassCounts[i] ?? 0;
    if (count > 0) showdownClasses.push({ label: label169(i), count });
  }
  showdownClasses.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  return {
    characterId,
    handsObserved: c.handsObserved,
    showdownsSeen: c.showdownsSeen,
    stats,
    showdownClasses,
  };
}
