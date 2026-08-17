/**
 * Test-only helpers: fixtures, a seeded LCG, a settled-state projection, and
 * the sequencing-law checker. Not exported from the package.
 */

import type { Card, HandEvent, PotAwarded } from "@poker/history";
import type { Beat, BeatLane } from "./beats";
import { beatEnd } from "./beats";
import type { BeatEvent } from "./presenter";
import { ACTOR_SETTLE_OVERLAP } from "./tokens";

/* --------------------------------------------------------------- cards */

const RANKS = "23456789TJQKA";
const SUITS = "cdhs";

/** `"As"` → int 0–51 (`rank * 4 + suit`). */
export function card(text: string): Card {
  const rank = RANKS.indexOf(text[0] ?? "");
  const suit = SUITS.indexOf(text[1] ?? "");
  if (rank < 0 || suit < 0) throw new RangeError(`bad card: ${text}`);
  return rank * 4 + suit;
}

/* ----------------------------------------------------------------- rng */

/** Numerical Recipes LCG — deterministic, seeded, test-only. */
export function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

export function pick<T>(next: () => number, items: readonly T[]): T {
  const item = items[Math.floor(next() * items.length)];
  if (item === undefined) throw new RangeError("empty pick");
  return item;
}

/* ------------------------------------------------------------ fixtures */

/**
 * The scripted hand used by the goldens: 6-max, hero on seat 3, an open, four
 * folds, a call, three streets of action, a river raise and call, showdown,
 * award. Exercises every event type in the v1 log.
 */
export const SCRIPTED_HAND: readonly HandEvent[] = [
  {
    t: "start",
    handNumber: 1,
    button: 0,
    seats: [
      { seat: 0, stack: 10_000 },
      { seat: 1, stack: 10_000 },
      { seat: 2, stack: 10_000 },
      { seat: 3, stack: 10_000 },
      { seat: 4, stack: 10_000 },
      { seat: 5, stack: 10_000 },
    ],
    blinds: { sb: 25, bb: 50, ante: 0 },
  },
  { t: "post", seat: 1, kind: "sb", amount: 25 },
  { t: "post", seat: 2, kind: "bb", amount: 50 },
  { t: "hole", seat: 1, cards: [card("7c"), card("2d")] },
  { t: "hole", seat: 2, cards: [card("Ah"), card("Qs")] },
  { t: "hole", seat: 3, cards: [card("Kd"), card("Kh")] },
  { t: "hole", seat: 4, cards: [card("9s"), card("8s")] },
  { t: "hole", seat: 5, cards: [card("Jc"), card("4h")] },
  { t: "hole", seat: 0, cards: [card("5d"), card("5c")] },
  { t: "act", seat: 3, kind: "raise", toAmount: 150, thinkTimeMs: 1200 },
  { t: "act", seat: 4, kind: "fold", thinkTimeMs: 900 },
  { t: "act", seat: 5, kind: "fold", thinkTimeMs: 400 },
  { t: "act", seat: 0, kind: "fold", thinkTimeMs: 600 },
  { t: "act", seat: 1, kind: "fold", thinkTimeMs: 500 },
  { t: "act", seat: 2, kind: "call", amount: 100, thinkTimeMs: 2000 },
  { t: "board", street: "flop", cards: [card("Kc"), card("9d"), card("2h")] },
  { t: "act", seat: 2, kind: "check", thinkTimeMs: 700 },
  { t: "act", seat: 3, kind: "bet", amount: 175, thinkTimeMs: 1100 },
  { t: "act", seat: 2, kind: "call", amount: 175, thinkTimeMs: 1500 },
  { t: "board", street: "turn", cards: [card("Td")] },
  { t: "act", seat: 2, kind: "check", thinkTimeMs: 800 },
  { t: "act", seat: 3, kind: "check", thinkTimeMs: 300 },
  { t: "board", street: "river", cards: [card("Js")] },
  { t: "act", seat: 2, kind: "bet", amount: 400, thinkTimeMs: 2400 },
  { t: "act", seat: 3, kind: "raise", toAmount: 1200, thinkTimeMs: 1800 },
  { t: "act", seat: 2, kind: "call", amount: 800, thinkTimeMs: 3000 },
  {
    t: "showdown",
    reveals: [
      { seat: 3, cards: [card("Kd"), card("Kh")] },
      { seat: 2, cards: [card("Ah"), card("Qs")] },
    ],
  },
  // 25 (sb) + 1525 (seat 2) + 1525 (seat 3)
  { t: "pot", potIndex: 0, seat: 3, amount: 3075 },
  {
    t: "end",
    net: [
      { seat: 1, net: -25 },
      { seat: 2, net: -1525 },
      { seat: 3, net: 1550 },
    ],
  },
];

/** Hero's seat in `SCRIPTED_HAND`. */
export const SCRIPTED_HERO = 3;

/**
 * A full 8-handed orbit's worth of engine beats in one hand: everyone is dealt
 * in, everyone acts on every street, everyone shows down. The heaviest burst
 * the instant-mode budget has to survive.
 */
export function fullOrbitHand(seats = 8): HandEvent[] {
  const events: HandEvent[] = [
    {
      t: "start",
      handNumber: 1,
      button: 0,
      seats: Array.from({ length: seats }, (_, seat) => ({ seat, stack: 100_000 })),
      blinds: { sb: 25, bb: 50, ante: 0 },
    },
    { t: "post", seat: 1, kind: "sb", amount: 25 },
    { t: "post", seat: 2, kind: "bb", amount: 50 },
  ];
  let deck = 0;
  for (let seat = 0; seat < seats; seat++) {
    events.push({ t: "hole", seat, cards: [deck++, deck++] });
  }
  for (let seat = 0; seat < seats; seat++) {
    events.push({ t: "act", seat, kind: "call", amount: 50, thinkTimeMs: 1200 });
  }
  const streets = [
    { street: "flop" as const, cards: [deck++, deck++, deck++] },
    { street: "turn" as const, cards: [deck++] },
    { street: "river" as const, cards: [deck++] },
  ];
  for (const s of streets) {
    events.push({ t: "board", street: s.street, cards: s.cards });
    for (let seat = 0; seat < seats; seat++) {
      events.push({ t: "act", seat, kind: "check", thinkTimeMs: 900 });
    }
  }
  events.push({
    t: "showdown",
    reveals: Array.from({ length: seats }, (_, seat) => ({
      seat,
      cards: [seat * 2, seat * 2 + 1] as [Card, Card],
    })),
  });
  events.push({ t: "pot", potIndex: 0, seat: 0, amount: seats * 50 + 75 });
  events.push({ t: "end", net: [{ seat: 0, net: 0 }] });
  return events;
}

/** A structurally plausible random hand — for property tests, not for poker. */
export function randomHand(seed: number): HandEvent[] {
  const next = lcg(seed);
  const seats = 2 + Math.floor(next() * 7);
  const events: HandEvent[] = [
    {
      t: "start",
      handNumber: 1,
      button: 0,
      seats: Array.from({ length: seats }, (_, seat) => ({ seat, stack: 20_000 })),
      blinds: { sb: 25, bb: 50, ante: 0 },
    },
    { t: "post", seat: 0, kind: "sb", amount: 25 },
    { t: "post", seat: 1 % seats, kind: "bb", amount: 50 },
  ];
  let deck = 0;
  for (let seat = 0; seat < seats; seat++) events.push({ t: "hole", seat, cards: [deck++, deck++] });

  let live = Array.from({ length: seats }, (_, seat) => seat);
  const streets = ["preflop", "flop", "turn", "river"] as const;
  for (const street of streets) {
    if (street !== "preflop") {
      if (live.length < 2) break;
      const count = street === "flop" ? 3 : 1;
      events.push({
        t: "board",
        street,
        cards: Array.from({ length: count }, () => deck++),
      });
    }
    const acting = [...live];
    for (const seat of acting) {
      if (live.length < 2) break;
      const roll = next();
      const think = Math.floor(next() * 4000);
      if (roll < 0.25 && live.length > 1) {
        events.push({ t: "act", seat, kind: "fold", thinkTimeMs: think });
        live = live.filter((s) => s !== seat);
      } else if (roll < 0.5) {
        events.push({ t: "act", seat, kind: "check", thinkTimeMs: think });
      } else if (roll < 0.75) {
        events.push({ t: "act", seat, kind: "call", amount: 50 + Math.floor(next() * 200), thinkTimeMs: think });
      } else {
        events.push({
          t: "act",
          seat,
          kind: next() < 0.5 ? "bet" : "raise",
          ...(next() < 0.5 ? { amount: 100 + Math.floor(next() * 500) } : { toAmount: 300 + Math.floor(next() * 900) }),
          thinkTimeMs: think,
        });
      }
    }
  }
  if (live.length >= 2) {
    events.push({
      t: "showdown",
      reveals: live.map((seat) => ({ seat, cards: [seat * 2, seat * 2 + 1] as [Card, Card] })),
    });
  }
  const winner = live[0] ?? 0;
  const split = next() < 0.2 && live.length >= 2;
  const awards: PotAwarded[] = split
    ? [
        { t: "pot", potIndex: 0, seat: winner, amount: 500 },
        { t: "pot", potIndex: 0, seat: live[1] ?? winner, amount: 500 },
      ]
    : [{ t: "pot", potIndex: 0, seat: winner, amount: 1000 }];
  events.push(...awards);
  events.push({ t: "end", net: [{ seat: winner, net: 1000 }] });
  return events;
}

/* --------------------------------------------------- settled projection */

/**
 * A minimal table projection built from settled beats. Stands in for the app's
 * table store: what matters is that flushing at any frame produces the same
 * settled state, in the same order, as uninterrupted playback.
 */
export interface Projection {
  board: Card[];
  dealt: Record<number, number>;
  faceUp: Record<number, Card[]>;
  mucked: number[];
  bets: Record<number, number>;
  pot: number;
  stacks: Record<number, number>;
  active: number | null;
  glow: number[] | null;
  rested: boolean;
  log: string[];
}

export function emptyProjection(): Projection {
  return {
    board: [],
    dealt: {},
    faceUp: {},
    mucked: [],
    bets: {},
    pot: 0,
    stacks: {},
    active: null,
    glow: null,
    rested: false,
    log: [],
  };
}

/** Apply a beat's settled end-state. Called once per beat, on settle. */
export function applySettled(p: Projection, beat: Beat): void {
  p.log.push(`${beat.group}|${beat.kind}`);
  switch (beat.kind) {
    case "deal-hole":
      for (const d of beat.meta.deliveries) p.dealt[d.seat] = (p.dealt[d.seat] ?? 0) + d.cards.length;
      break;
    case "deal-board":
      p.board.push(...beat.meta.cards);
      break;
    case "reveal":
      for (const d of beat.meta.deliveries) p.faceUp[d.seat] = [...(p.faceUp[d.seat] ?? []), ...d.cards];
      break;
    case "winner-glow":
      p.glow = [...beat.meta.winners];
      break;
    case "chips-out":
      if (beat.meta.aggression === "blind") {
        for (const post of beat.meta.posts) {
          p.bets[post.seat] = (p.bets[post.seat] ?? 0) + post.amount;
          p.stacks[post.seat] = (p.stacks[post.seat] ?? 0) - post.amount;
        }
      } else {
        p.bets[beat.meta.seat] = beat.meta.toAmount;
        p.stacks[beat.meta.seat] = (p.stacks[beat.meta.seat] ?? 0) - beat.meta.amount;
      }
      break;
    case "chips-collect":
      for (const s of beat.meta.seats) p.bets[s.seat] = 0;
      p.pot = beat.meta.potAfter;
      break;
    case "pot-award":
      p.pot -= beat.meta.amount;
      p.stacks[beat.meta.seat] = (p.stacks[beat.meta.seat] ?? 0) + beat.meta.amount;
      break;
    case "fold-muck":
      p.mucked.push(beat.meta.seat);
      break;
    case "turn-indicator":
      p.active = beat.meta.seat;
      break;
    case "rest":
      p.rested = true;
      break;
    default:
      break;
  }
}

/** Build a projection from a stream of presenter events (settles only). */
export function projectionRecorder(): { projection: Projection; onBeat: (event: BeatEvent) => void } {
  const projection = emptyProjection();
  return {
    projection,
    onBeat: (event) => {
      if (event.phase === "settle") applySettled(projection, event.beat);
    },
  };
}

/* ------------------------------------------------- the sequencing law */

export interface GroupSpan {
  group: string;
  lane: BeatLane;
  start: number;
  end: number;
  seq: number;
}

/** Spans of the blocking phases, in schedule order (beats.md §5.1/§5.2). */
export function blockingGroups(beats: readonly Beat[]): GroupSpan[] {
  const spans = new Map<string, GroupSpan>();
  beats.forEach((beat, i) => {
    if (!beat.blocking) return;
    const span = spans.get(beat.group);
    if (span === undefined) {
      spans.set(beat.group, { group: beat.group, lane: beat.lane, start: beat.at, end: beatEnd(beat), seq: i });
      return;
    }
    span.start = Math.min(span.start, beat.at);
    span.end = Math.max(span.end, beatEnd(beat));
  });
  return [...spans.values()].sort((a, b) => a.start - b.start || a.seq - b.seq);
}

const EPS = 1e-9;

/**
 * Every illegal overlap in a schedule. Legal: actor→actor overlap of at most
 * the previous action's settle tail. Illegal: anything touching a dealer phase.
 */
export function overlapViolations(beats: readonly Beat[]): string[] {
  const spans = blockingGroups(beats);
  const bad: string[] = [];
  for (let i = 0; i < spans.length; i++) {
    const a = spans[i];
    if (a === undefined) continue;
    for (let j = i + 1; j < spans.length; j++) {
      const b = spans[j];
      if (b === undefined) continue;
      if (b.start >= a.end - EPS) continue; // disjoint
      if (a.lane === "actor" && b.lane === "actor") {
        const earliest = a.start + (a.end - a.start) * ACTOR_SETTLE_OVERLAP;
        if (b.start + EPS >= earliest) continue; // legal settle overlap
        bad.push(`${b.group} starts ${b.start} inside ${a.group} settle window (>= ${earliest} required)`);
      } else {
        bad.push(`${b.group} (${b.lane}) [${b.start},${b.end}] overlaps ${a.group} (${a.lane}) [${a.start},${a.end}]`);
      }
    }
  }
  return bad;
}

/* ------------------------------------------------------------ formatting */

function metaTag(beat: Beat): string {
  switch (beat.kind) {
    case "deal-hole": {
      const seats = beat.meta.deliveries.map((d) => `${d.seat}:${d.cards.length}`).join(",");
      return `pass=${String(beat.meta.pass)} ${seats}${beat.meta.grouped ? " grouped" : ""}`;
    }
    case "deal-board":
      return `${beat.meta.street} n=${beat.meta.cards.length} ${beat.meta.form}${beat.meta.grouped ? " grouped" : ""}`;
    case "reveal":
      return `${beat.meta.source} ${
        beat.meta.deliveries.length > 0 ? beat.meta.deliveries.map((d) => d.seat).join(",") : `board:${beat.meta.cards.length}`
      }${beat.meta.grouped ? " grouped" : ""}`;
    case "winner-glow":
      return `win=${beat.meta.winners.join(",")} dim=${beat.meta.dimmed.join(",")}`;
    case "chips-out":
      return beat.meta.aggression === "blind"
        ? `blind total=${beat.meta.total}`
        : `${beat.meta.aggression} s${beat.meta.seat} ${beat.meta.amount} T${beat.meta.tier}${beat.meta.allIn ? " allin" : ""}`;
    case "chips-collect":
      return `n=${beat.meta.seats.length} total=${beat.meta.total} pot=${beat.meta.potAfter}`;
    case "pot-award":
      return `s${beat.meta.seat} ${beat.meta.amount} breath=${beat.meta.breathMs}${beat.meta.heroWin ? " hero" : ""}`;
    case "fold-muck":
      return `s${beat.meta.seat}${beat.meta.travel ? " travel" : " in-place"}`;
    case "check-knock":
      return `s${beat.meta.seat} dips=${beat.meta.dips}`;
    case "turn-indicator":
      return `s${beat.meta.seat} ${beat.meta.form}${beat.meta.hero ? " hero" : ""}`;
    case "think-pause":
      return `s${beat.meta.seat} req=${beat.meta.requestedMs}`;
    case "mind-affordance":
      return `s${beat.meta.seat} ${beat.meta.target}`;
    case "badge-glint":
      return `${beat.meta.phase} nag=${beat.meta.nag}`;
    case "mood-shift":
      return `s${beat.meta.seat} ${beat.meta.from}->${beat.meta.to}`;
    case "banter":
      return `s${beat.meta.seat} ${beat.meta.phase}`;
    case "rest":
      return beat.meta.reason;
  }
}

function soundTag(beat: Beat): string {
  if (beat.sounds.length === 0) return "";
  return ` [${beat.sounds.map((s) => `${s.cue}@${s.atProgress}${s.gainDb === 0 ? "" : `${s.gainDb}dB`}`).join(" ")}]`;
}

/** One line per beat: `at +dur lane kind meta [cues]`. The golden format. */
export function formatSchedule(beats: readonly Beat[]): string {
  return beats
    .map((beat) => {
      const at = String(beat.at).padStart(5);
      const dur = String(beat.duration).padStart(4);
      const lane = `${beat.lane[0] ?? "?"}${beat.blocking ? "*" : " "}`;
      return `${at} +${dur} ${lane} ${beat.kind.padEnd(16)} ${metaTag(beat)}${soundTag(beat)}`;
    })
    .join("\n");
}
