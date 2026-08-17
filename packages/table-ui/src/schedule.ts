/**
 * `schedule()` — the pure event-burst → beat-list function.
 *
 * The engine emits a hand's events instantly; this turns them into timed,
 * speed-aware, reduce-motion-aware beats per
 * `poker-internal/content/motion/beats.md` (§3 speed model, §4 vocabulary,
 * §5 orchestration). No clocks, no randomness, no I/O: same events + same
 * options ⇒ byte-identical schedule.
 *
 * Timing model:
 * - Beats are grouped into *phases* (`beat.group`). Sub-beats inside a phase
 *   stagger and overlap freely; blocking phases never overlap (§5.2), except
 *   actor→actor, which may overlap the previous action's settle tail
 *   (`ACTOR_SETTLE_OVERLAP`).
 * - Preparatory beats (turn indicator, think pulse) and ambient beats are
 *   non-blocking: they may overlap, and nothing waits for ambient.
 *
 * Inference the history log requires (v1 has no `StreetEnded` event): a street
 * ends — and the pot merges — when a `board` event arrives, or immediately
 * before showdown / the first pot award, provided chips are on the felt.
 */

import type {
  Card,
  DealBoard,
  DealHole,
  HandEvent,
  PlayerAction,
  PostBlind,
  PotAwarded,
  Showdown,
  Street,
} from "@poker/history";
import type {
  Beat,
  BeatBase,
  BeatKind,
  BeatMetaMap,
  BeatSound,
  BeatTransform,
  BlindPost,
  CardDelivery,
  SeatMood,
} from "./beats";
import { beatEnd } from "./beats";
import { CALL_TRIM_DB, applySoundPolicy, chipCue, chipTier } from "./sound";
import type { DurationSpec, Speed } from "./tokens";
import {
  ACTOR_SETTLE_OVERLAP,
  AUTO_DEAL_REST_MS,
  CARD_ARC_PX,
  CHIP_ARC_PX,
  DURATION,
  MIND_AFFORDANCE_DELAY_MS,
  THINK_FLOOR_MS,
  WINNER_GLOW_DELAY_MS,
  compressionTier,
  resolveDuration,
  resolveStagger,
} from "./tokens";

export interface ScheduleOptions {
  readonly speed: Speed;
  readonly reduceMotion: boolean;
  /** Time the schedule's first beat is measured from (ms). Default 0. */
  readonly startAt?: number;
  /** Hero's seat — drives the hole-card flip, `turn_blip`, and `win_chime`. */
  readonly heroSeat?: number;
  /** Schedule think pauses from `PlayerAction.thinkTimeMs`. Default true. */
  readonly thinkPauses?: boolean;
  /** Emit turn-indicator beats. Default true. */
  readonly turnIndicators?: boolean;
}

/** Per-beat duration tokens (beats.md §4). All @1x bases, pre-clamp. */
const SPEC = {
  /** 4.1 deal hole: 220ms/card. */
  hole: { base: 220, floor: 90, rmBase: DURATION.quick },
  /** 4.1 hero flip: `spring/flip` 250ms. */
  heroFlip: { base: DURATION.fast, floor: 90, rmBase: DURATION.quick },
  /** 4.2 street slide: 200ms. */
  boardSlide: { base: 200, floor: 90, rmBase: DURATION.quick },
  /** 4.2 street flip: 250ms (river +40). */
  boardFlip: { base: DURATION.fast, floor: 90, rmBase: DURATION.quick },
  /** 4.2 tier-1: slide and flip merge into one 160ms travel-turn. */
  boardMerged: { base: 450, floor: 90, at2x: 160, rmBase: DURATION.quick },
  /** 4.3 bet/raise: 120ms spawn + 320ms travel. */
  bet: { base: 440, floor: 100, rmBase: DURATION.quick },
  /** 4.4 call: 280ms travel, no spawn pop. */
  call: { base: 280, floor: 100, rmBase: DURATION.quick },
  /** 4.5 check knock: 180ms double rap. */
  check: { base: 180, floor: 90, rmBase: 120 },
  /** 4.6 fold muck: 280ms travel. */
  fold: { base: 280, floor: 90, rmBase: DURATION.quick },
  /** 4.6 seat dim: `--duration-quick`. */
  seatDim: { base: DURATION.quick, floor: 0, collapse3x: false },
  /** 4.7 pot merge: `spring/pot` 400ms. */
  merge: { base: DURATION.slow, floor: DURATION.quick },
  /** Spinning-counter roll-up: `--duration-slow`, overlapped. */
  rollUp: { base: DURATION.slow, floor: 0, collapse3x: false },
  /** 4.8 the breath: 250ms of stillness before the pot moves. */
  breath: { base: DURATION.fast, floor: 0, collapse3x: false },
  /** 4.8 pot award: 450ms slide, floor 150 at any speed, 120ms trace at instant. */
  award: { base: 450, floor: DURATION.quick, rmBase: DURATION.slow, atInstant: 120 },
  /** 4.9 showdown reveal: 250ms/seat, 120ms trace at instant. */
  showdown: { base: DURATION.fast, floor: 120, atInstant: 120 },
  /** 4.9 winning-hand glow sweep: 300ms. */
  glow: { base: 300, floor: DURATION.quick, rmBase: DURATION.quick },
  /** 4.9 delay from last flip to glow. */
  glowDelay: { base: WINNER_GLOW_DELAY_MS, floor: 0, collapse3x: false },
  /** 5.2 auto-deal rest: 600ms ÷ S, 0 at instant. */
  rest: { base: AUTO_DEAL_REST_MS, floor: 0, collapse3x: false },
} as const satisfies Record<string, DurationSpec>;

/** 4.2 the river flip gets +40ms — nobody names it, everyone feels it. */
const RIVER_FLIP_BONUS_MS = 40;
/** 4.2 flop slide stagger. */
const BOARD_SLIDE_STAGGER_MS = 60;
/** 4.9/4.11 flop flip stagger; also the hero's second-card flip offset. */
const BOARD_FLIP_STAGGER_MS = DURATION.micro;
/** 4.9 showdown seat stagger. */
const SHOWDOWN_SEAT_STAGGER_MS = DURATION.quick;
/** 4.8 split pots depart 60ms apart. */
const SPLIT_STAGGER_MS = 60;
/** 4.9 losing revealed hands dim; flop flips #2/#3 sit −4dB. */
const FLOP_FLIP_TRIM_DB = -4;
/** 4.9 each subsequent showdown seat −3dB. */
const SHOWDOWN_SEAT_TRIM_DB = -3;
/** 4.8 hero lost a big pot: `pot_slide` at −6dB and nothing else. */
const LOST_POT_TRIM_DB = -6;
/** 4.8 `win_chime` iff hero won and the pot is at least this many big blinds. */
const WIN_CHIME_MIN_BB = 15;
/** 4.14 the ring glide; FEEDBACK, so it never scales. */
const TURN_GLIDE_MS = 200;
/** 4.14 at 2x+ the glide becomes a fade — a fast-travelling ring is noise. */
const TURN_FADE_MS = 90;
/** 4.13 banter: 250ms in · 4s hold (÷S, min 2s) · 200ms out. */
const BANTER_IN_MS = DURATION.fast;
const BANTER_OUT_MS = 200;
const BANTER_HOLD_MS = 4000;
const BANTER_HOLD_MIN_MS = 2000;
/** 4.12 mood cross-fade: 800ms, shortened to 300ms at instant. */
const MOOD_MS = 800;
const MOOD_INSTANT_MS = 300;
/** 4.11 badge: 250ms dot pop + 600ms glint sweep; 150ms pulse under reduce-motion. */
const BADGE_POP_MS = DURATION.fast;
const BADGE_SWEEP_MS = 600;
const BADGE_SWEEP_RM_MS = DURATION.quick;
/** 4.10 mind-reveal affordance: 250ms fade-in, 40ms per-seat stagger. */
const MIND_AFFORDANCE_MS = DURATION.fast;

type BeatInit<K extends BeatKind> = Omit<BeatBase, "keepsTrace" | "sounds"> & {
  readonly kind: K;
  readonly meta: BeatMetaMap[K];
  readonly keepsTrace?: boolean;
  readonly sounds?: readonly BeatSound[];
};

/**
 * Build a beat. The cast is the one place the per-kind meta map is joined to
 * the `Beat` union; `BeatInit<K>` has already checked `meta` against `kind`.
 */
function mk<K extends BeatKind>(init: BeatInit<K>): Beat {
  return { keepsTrace: false, sounds: [], ...init } as unknown as Beat;
}

/** Transforms, swapped for their fade variant under reduce-motion (§5.4). */
function tf(
  reduceMotion: boolean,
  full: readonly BeatTransform[],
  fade: readonly BeatTransform[] = ["opacity"],
): readonly BeatTransform[] {
  return reduceMotion ? fade : full;
}

function cue(cueName: BeatSound["cue"], atProgress = 0, gainDb = 0): BeatSound {
  return { cue: cueName, atProgress, gainDb };
}

interface Walker {
  readonly speed: Speed;
  readonly rm: boolean;
  readonly tier: 0 | 1 | 2 | 3;
  readonly heroSeat: number | undefined;
  readonly out: Beat[];
  /** End of the last dealer phase. */
  dealerEnd: number;
  /** End of the last blocking actor phase. */
  actorEnd: number;
  /** Earliest time the next actor may begin (previous action's settle point). */
  actorReady: number;
  lastActor: number | null;
  street: Street;
  /** Chips already merged into the pot (cents). */
  pot: number;
  /** Chips resting on the felt this street, by seat (cents). */
  bets: Map<number, number>;
  stacks: Map<number, number>;
  bb: number;
}

function takeRun<T extends HandEvent["t"]>(
  events: readonly HandEvent[],
  from: number,
  t: T,
): Extract<HandEvent, { t: T }>[] {
  const run: Extract<HandEvent, { t: T }>[] = [];
  for (let i = from; i < events.length; i++) {
    const e = events[i];
    if (e === undefined || e.t !== t) break;
    run.push(e as Extract<HandEvent, { t: T }>);
  }
  return run;
}

function maxEnd(beats: readonly Beat[], from: number, fallback: number): number {
  let end = fallback;
  for (let i = from; i < beats.length; i++) {
    const b = beats[i];
    if (b === undefined) continue;
    end = Math.max(end, beatEnd(b));
  }
  return end;
}

/** Blocking dealer phases wait for every blocking beat before them. */
function dealerStart(w: Walker): number {
  return Math.max(w.dealerEnd, w.actorEnd);
}

/* ------------------------------------------------------------------ blinds */

function scheduleBlinds(w: Walker, posts: readonly PostBlind[], index: number): void {
  const group = `post#${index}`;
  const at = dealerStart(w);
  const dur = resolveDuration(SPEC.call, w.speed, w.rm);
  let total = 0;
  const list: BlindPost[] = posts.map((p) => {
    total += p.amount;
    w.bets.set(p.seat, (w.bets.get(p.seat) ?? 0) + p.amount);
    const stack = w.stacks.get(p.seat);
    if (stack !== undefined) w.stacks.set(p.seat, stack - p.amount);
    return { seat: p.seat, kind: p.kind, amount: p.amount };
  });
  const potBefore = w.pot;
  const tier = chipTier(total, potBefore);
  const first = posts[0];
  w.out.push(
    mk({
      kind: "chips-out",
      meta: { aggression: "blind", posts: list, total, arcPx: w.rm || w.tier >= 1 ? 0 : CHIP_ARC_PX },
      at,
      duration: dur,
      lane: "actor",
      speedClass: "paced",
      group,
      blocking: true,
      transforms: tf(w.rm, ["translate", "opacity"]),
      reduceMotion: "fade-in-place",
      spring: "spring/chip",
      sounds: dur > 0 ? [cue(chipCue(tier), 0.7, CALL_TRIM_DB)] : [],
      ...(first === undefined ? {} : { event: first }),
      eventIndex: index,
    }),
  );
  w.actorEnd = Math.max(w.actorEnd, at + dur);
  w.actorReady = at + dur * ACTOR_SETTLE_OVERLAP;
}

/* -------------------------------------------------------------- hole cards */

function scheduleHoleCards(w: Walker, holes: readonly DealHole[], index: number): void {
  const group = `deal-hole#${index}`;
  const start = dealerStart(w);
  const mark = w.out.length;
  const dur = resolveDuration(SPEC.hole, w.speed, w.rm);
  const stagger = resolveStagger(DURATION.stagger, w.speed);
  const arcPx = w.rm || w.tier >= 1 ? 0 : CARD_ARC_PX;
  const base: Omit<BeatInit<"deal-hole">, "meta" | "at" | "duration"> = {
    kind: "deal-hole",
    lane: "dealer",
    speedClass: "paced",
    group,
    blocking: true,
    // Cards spawn at opacity 1 — they come from a real place (4.1).
    transforms: tf(w.rm, ["translate", "rotate"]),
    reduceMotion: "fade-in-place",
    spring: "spring/deal",
  };
  const heroIndex = holes.findIndex((h) => h.seat === w.heroSeat);
  let heroLanded = start;

  if (w.tier >= 2) {
    // Tier 2: per-item beats become per-group — the whole deal is one moment.
    const deliveries: CardDelivery[] = holes.map((h) => ({ seat: h.seat, cards: [...h.cards] }));
    w.out.push(
      mk({
        ...base,
        meta: { deliveries, pass: "merged", grouped: true, arcPx },
        at: start,
        duration: dur,
        sounds: [cue("card_slide")],
        eventIndex: index,
      }),
    );
    heroLanded = start; // tier 2+: the hero flip merges into the landing
  } else if (w.tier === 1) {
    // Tier 1: one pass, both cards per seat travel as one two-card sprite.
    holes.forEach((h, i) => {
      w.out.push(
        mk({
          ...base,
          meta: { deliveries: [{ seat: h.seat, cards: [...h.cards] }], pass: "merged", grouped: false, arcPx },
          at: start + i * stagger,
          duration: dur,
          sounds: [cue("card_slide")],
          event: h,
          eventIndex: index + i,
        }),
      );
      if (i === heroIndex) heroLanded = start + i * stagger + dur;
    });
  } else {
    // Two passes in seat order, like a real dealer; one beat per card.
    const n = holes.length;
    for (let pass = 0; pass < 2; pass++) {
      holes.forEach((h, i) => {
        const card = h.cards[pass];
        if (card === undefined) return;
        const slot = pass * n + i;
        const at = start + slot * stagger;
        w.out.push(
          mk({
            ...base,
            meta: {
              deliveries: [{ seat: h.seat, cards: [card] }],
              pass: pass === 0 ? 1 : 2,
              grouped: false,
              arcPx,
            },
            at,
            duration: dur,
            sounds: [cue("card_slide")],
            event: h,
            eventIndex: index + i,
          }),
        );
        if (i === heroIndex && pass === 1) heroLanded = at + dur;
      });
    }
  }

  // Hero's cards flip face-up once they have landed (4.1).
  const hero = heroIndex >= 0 ? holes[heroIndex] : undefined;
  if (hero !== undefined) {
    const flipDur = resolveDuration(SPEC.heroFlip, w.speed, w.rm);
    const flipStagger = resolveStagger(DURATION.micro, w.speed);
    const grouped = w.tier >= 2;
    const flips: Card[][] = grouped ? [[...hero.cards]] : hero.cards.map((c) => [c]);
    flips.forEach((flipCards, i) => {
      w.out.push(
        mk({
          kind: "reveal",
          meta: {
            source: "hero",
            deliveries: [{ seat: hero.seat, cards: flipCards }],
            cards: [],
            grouped,
          },
          at: heroLanded + i * flipStagger,
          duration: flipDur,
          lane: "dealer",
          speedClass: "paced",
          group,
          blocking: true,
          transforms: tf(w.rm, ["rotateY", "opacity"]),
          reduceMotion: "cross-fade",
          spring: "spring/flip",
          event: hero,
          eventIndex: index + Math.max(heroIndex, 0),
        }),
      );
    });
  }

  w.dealerEnd = maxEnd(w.out, mark, start);
  w.actorReady = Math.max(w.actorReady, w.dealerEnd);
}

/* ------------------------------------------------------------ board street */

function scheduleBoard(w: Walker, e: DealBoard, index: number): void {
  const group = `board#${index}`;
  const start = dealerStart(w);
  const mark = w.out.length;
  const cards: Card[] = [...e.cards];
  const arcPx = w.rm || w.tier >= 1 ? 0 : CARD_ARC_PX;
  const flipSpec: DurationSpec =
    e.street === "river" ? { ...SPEC.boardFlip, base: SPEC.boardFlip.base + RIVER_FLIP_BONUS_MS } : SPEC.boardFlip;

  const boardBase: Omit<BeatInit<"deal-board">, "meta" | "at" | "duration" | "sounds"> = {
    kind: "deal-board",
    lane: "dealer",
    speedClass: "paced",
    group,
    blocking: true,
    transforms: tf(w.rm, ["translate", "rotateY"]),
    reduceMotion: "fade-in-place",
    spring: "spring/deal",
    event: e,
    eventIndex: index,
  };

  if (w.rm) {
    // Reduce-motion: cards fade in face-up in place, stagger kept (4.2).
    const dur = resolveDuration(SPEC.boardSlide, w.speed, true);
    const stagger = resolveStagger(BOARD_SLIDE_STAGGER_MS, w.speed);
    cards.forEach((card, i) => {
      w.out.push(
        mk({
          ...boardBase,
          meta: { street: e.street, cards: [card], form: "fade", grouped: false, arcPx: 0 },
          at: start + i * stagger,
          duration: dur,
          // The card is face-up when the fade completes — the snap lands there.
          sounds: [cue("card_slide"), cue("card_flip", 1, i === 0 ? 0 : FLOP_FLIP_TRIM_DB)],
        }),
      );
    });
  } else if (w.tier >= 2) {
    // Tier 2: the street deals as one unit.
    const dur = resolveDuration(SPEC.boardMerged, w.speed, false);
    w.out.push(
      mk({
        ...boardBase,
        meta: { street: e.street, cards, form: "slide+flip", grouped: true, arcPx },
        at: start,
        duration: dur,
        sounds: dur > 0 ? [cue("card_slide"), cue("card_flip", 0.7)] : [],
      }),
    );
  } else if (w.tier === 1) {
    // Tier 1: slide and flip merge — the card turns while it travels.
    const dur = resolveDuration(SPEC.boardMerged, w.speed, false);
    const stagger = resolveStagger(BOARD_SLIDE_STAGGER_MS, w.speed);
    cards.forEach((card, i) => {
      w.out.push(
        mk({
          ...boardBase,
          meta: { street: e.street, cards: [card], form: "slide+flip", grouped: false, arcPx },
          at: start + i * stagger,
          duration: dur,
          sounds: [cue("card_slide"), cue("card_flip", 0.7, i === 0 ? 0 : FLOP_FLIP_TRIM_DB)],
        }),
      );
    });
  } else {
    // Slide face-down, then flip: the two-part street deal (4.2).
    const slideDur = resolveDuration(SPEC.boardSlide, w.speed, false);
    const slideStagger = resolveStagger(BOARD_SLIDE_STAGGER_MS, w.speed);
    cards.forEach((card, i) => {
      w.out.push(
        mk({
          ...boardBase,
          meta: { street: e.street, cards: [card], form: "slide", grouped: false, arcPx },
          at: start + i * slideStagger,
          duration: slideDur,
          transforms: ["translate"],
          sounds: [cue("card_slide")],
        }),
      );
    });
    const flipStart = start + (cards.length - 1) * slideStagger + slideDur;
    const flipDur = resolveDuration(flipSpec, w.speed, false);
    const flipStagger = resolveStagger(BOARD_FLIP_STAGGER_MS, w.speed);
    cards.forEach((card, i) => {
      w.out.push(
        mk({
          kind: "reveal",
          meta: { source: "board", deliveries: [], cards: [card], street: e.street, grouped: false },
          at: flipStart + i * flipStagger,
          duration: flipDur,
          lane: "dealer",
          speedClass: "paced",
          group,
          blocking: true,
          transforms: ["rotateY"],
          reduceMotion: "cross-fade",
          spring: "spring/flip",
          sounds: [cue("card_flip", 0, i === 0 ? 0 : FLOP_FLIP_TRIM_DB)],
          event: e,
          eventIndex: index,
        }),
      );
    });
  }

  w.dealerEnd = maxEnd(w.out, mark, start);
  w.actorReady = Math.max(w.actorReady, w.dealerEnd);
  w.street = e.street;
}

/* ----------------------------------------------------------- pot mechanics */

/** Sweep the felt into the pot; no-op when nothing is out there (4.7). */
function scheduleMerge(w: Walker, index: number, event?: HandEvent): void {
  if (w.bets.size === 0) return;
  const group = `merge#${index}`;
  const at = dealerStart(w);
  const dur = resolveDuration(SPEC.merge, w.speed, w.rm);
  const seats = [...w.bets.entries()].map(([seat, amount]) => ({ seat, amount }));
  const total = seats.reduce((sum, s) => sum + s.amount, 0);
  w.pot += total;
  w.bets = new Map();
  w.out.push(
    mk({
      kind: "chips-collect",
      meta: {
        seats,
        total,
        potAfter: w.pot,
        street: w.street,
        rollUpMs: resolveDuration(SPEC.rollUp, w.speed, w.rm),
      },
      at,
      duration: dur,
      lane: "dealer",
      speedClass: "paced",
      group,
      blocking: true,
      transforms: tf(w.rm, ["translate", "opacity"]),
      reduceMotion: "fade-in-place",
      spring: "spring/pot",
      sounds: [cue("pot_merge")],
      ...(event === undefined ? {} : { event }),
      eventIndex: index,
    }),
  );
  w.dealerEnd = at + dur;
  w.actorReady = Math.max(w.actorReady, w.dealerEnd);
}

function scheduleAwards(w: Walker, awards: readonly PotAwarded[], index: number): void {
  const group = `award#${index}`;
  const breath = resolveDuration(SPEC.breath, w.speed, w.rm);
  const start = dealerStart(w) + breath;
  const dur = resolveDuration(SPEC.award, w.speed, w.rm);
  const stagger = resolveStagger(SPLIT_STAGGER_MS, w.speed);
  const rollUpMs = resolveDuration(SPEC.rollUp, w.speed, w.rm);
  awards.forEach((a, i) => {
    const heroWin = w.heroSeat !== undefined && a.seat === w.heroSeat;
    const big = w.bb > 0 && a.amount >= WIN_CHIME_MIN_BB * w.bb;
    const heroLostBig = w.heroSeat !== undefined && !heroWin && big;
    const sounds: BeatSound[] = [cue("pot_slide", 0, heroLostBig ? LOST_POT_TRIM_DB : 0)];
    if (heroWin && big) sounds.push(cue("win_chime", 1));
    w.out.push(
      mk({
        kind: "pot-award",
        meta: {
          seat: a.seat,
          potIndex: a.potIndex,
          amount: a.amount,
          breathMs: breath,
          splitIndex: i,
          splitCount: awards.length,
          heroWin,
          rollUpMs,
        },
        at: start + i * stagger,
        duration: dur,
        lane: "dealer",
        speedClass: "paced",
        group,
        blocking: true,
        keepsTrace: true,
        transforms: tf(w.rm, ["translate", "opacity"]),
        reduceMotion: "fade-in-place",
        spring: "spring/pot",
        sounds,
        event: a,
        eventIndex: index + i,
      }),
    );
    w.pot -= a.amount;
  });
  w.dealerEnd = start + (awards.length - 1) * stagger + dur;
  w.actorReady = Math.max(w.actorReady, w.dealerEnd);
}

/* ------------------------------------------------------------------ actors */

function scheduleTurn(w: Walker, seat: number, at: number, group: string, index: number): number {
  if (w.speed === "instant" || w.tier === 3) return 0;
  const glide = (w.speed === 0.5 || w.speed === 1) && !w.rm;
  const duration = glide ? TURN_GLIDE_MS : TURN_FADE_MS;
  const hero = w.heroSeat !== undefined && seat === w.heroSeat;
  w.out.push(
    mk({
      kind: "turn-indicator",
      meta: { seat, from: w.lastActor, hero, form: glide ? "glide" : "fade", arms: hero },
      at,
      duration,
      lane: "actor",
      speedClass: "feedback",
      group,
      blocking: false,
      transforms: tf(w.rm, glide ? ["translate", "opacity"] : ["opacity"]),
      reduceMotion: "cross-fade",
      spring: "spring/ui",
      cssToken: "fast",
      sounds: hero ? [cue("turn_blip")] : [],
      eventIndex: index,
    }),
  );
  return duration;
}

/** Think duration under the speed law: `1/S`, floored, zero at instant (§2.3). */
export function thinkDuration(thinkTimeMs: number, speed: Speed): number {
  if (speed === "instant" || thinkTimeMs <= 0) return 0;
  return Math.max(THINK_FLOOR_MS, Math.round(thinkTimeMs / speed));
}

function thinkBeat(w: Walker, seat: number, thinkTimeMs: number, at: number, group: string, index: number): number {
  const duration = thinkDuration(thinkTimeMs, w.speed);
  if (duration <= 0) return 0;
  w.out.push(
    mk({
      kind: "think-pause",
      meta: { seat, hero: w.heroSeat !== undefined && seat === w.heroSeat, requestedMs: thinkTimeMs },
      at,
      duration,
      lane: "actor",
      speedClass: "ambient",
      group,
      blocking: false,
      transforms: tf(w.rm, ["opacity"], []),
      reduceMotion: "static",
      eventIndex: index,
    }),
  );
  return duration;
}

function scheduleAction(w: Walker, e: PlayerAction, index: number, thinkPauses: boolean, turns: boolean): void {
  const group = `act#${index}`;
  const prepAt = Math.max(w.dealerEnd, w.actorReady);
  const turnDur = turns ? scheduleTurn(w, e.seat, prepAt, group, index) : 0;
  const thinkDur = thinkPauses ? thinkBeat(w, e.seat, e.thinkTimeMs ?? 0, prepAt, group, index) : 0;
  const at = prepAt + Math.max(turnDur, thinkDur);
  const arcPx = w.rm || w.tier >= 1 ? 0 : CHIP_ARC_PX;
  let duration = 0;

  if (e.kind === "fold") {
    duration = resolveDuration(SPEC.fold, w.speed, w.rm);
    const travel = !w.rm && w.tier < 2;
    w.out.push(
      mk({
        kind: "fold-muck",
        meta: {
          seat: e.seat,
          dimMs: resolveDuration(SPEC.seatDim, w.speed, w.rm),
          travel,
          tableRecede: w.heroSeat !== undefined && e.seat === w.heroSeat,
        },
        at,
        duration,
        lane: "actor",
        speedClass: "paced",
        group,
        blocking: true,
        transforms: travel ? ["translate", "rotate", "opacity"] : ["opacity"],
        reduceMotion: "fade-in-place",
        spring: "spring/muck",
        sounds: [cue("fold_muck")],
        event: e,
        eventIndex: index,
      }),
    );
  } else if (e.kind === "check") {
    duration = resolveDuration(SPEC.check, w.speed, w.rm);
    w.out.push(
      mk({
        kind: "check-knock",
        meta: { seat: e.seat, dips: w.tier === 0 && !w.rm ? 2 : 1 },
        at,
        duration,
        lane: "actor",
        speedClass: "paced",
        group,
        blocking: true,
        transforms: tf(w.rm, ["translate"]),
        reduceMotion: "pulse",
        cssToken: "quick",
        sounds: [cue("check_knock")],
        event: e,
        eventIndex: index,
      }),
    );
  } else {
    const committed = w.bets.get(e.seat) ?? 0;
    const toAmount = e.kind === "raise" ? (e.toAmount ?? committed) : committed + (e.amount ?? 0);
    const amount = Math.max(0, toAmount - committed);
    const potBefore = w.pot + [...w.bets.values()].reduce((sum, v) => sum + v, 0);
    const stack = w.stacks.get(e.seat);
    const allIn = stack !== undefined && stack - amount <= 0;
    if (stack !== undefined) w.stacks.set(e.seat, stack - amount);
    w.bets.set(e.seat, toAmount);
    const tier = chipTier(amount, potBefore, allIn);
    const aggressive = e.kind === "bet" || e.kind === "raise";
    duration = resolveDuration(aggressive ? SPEC.bet : SPEC.call, w.speed, w.rm);
    w.out.push(
      mk({
        kind: "chips-out",
        meta: {
          aggression: e.kind,
          seat: e.seat,
          amount,
          toAmount,
          tier,
          allIn,
          potBefore,
          arcPx,
          spawnPop: aggressive && w.tier === 0 && !w.rm,
        },
        at,
        duration,
        lane: "actor",
        speedClass: "paced",
        group,
        blocking: true,
        transforms: tf(w.rm, aggressive ? ["translate", "scale", "opacity", "blur2px"] : ["translate", "opacity"], [
          "opacity",
          "blur2px",
        ]),
        reduceMotion: "fade-in-place",
        spring: "spring/chip",
        sounds: [cue(chipCue(tier), 0.7, aggressive ? 0 : CALL_TRIM_DB)],
        event: e,
        eventIndex: index,
      }),
    );
  }

  w.actorEnd = Math.max(w.actorEnd, at + duration);
  w.actorReady = at + duration * ACTOR_SETTLE_OVERLAP;
  w.lastActor = e.seat;
}

/* --------------------------------------------------------------- showdown */

function scheduleShowdown(w: Walker, e: Showdown, index: number, winners: readonly number[]): void {
  const group = `showdown#${index}`;
  const start = dealerStart(w);
  const dur = resolveDuration(SPEC.showdown, w.speed, w.rm);
  const stagger = resolveStagger(SHOWDOWN_SEAT_STAGGER_MS, w.speed);
  const grouped = w.tier >= 2;
  const revealed = e.reveals.map((r) => r.seat);

  if (grouped) {
    w.out.push(
      mk({
        kind: "reveal",
        meta: {
          source: "showdown",
          deliveries: e.reveals.map((r) => ({ seat: r.seat, cards: [...r.cards] })),
          cards: [],
          grouped: true,
        },
        at: start,
        duration: dur,
        lane: "dealer",
        speedClass: "paced",
        group,
        blocking: true,
        keepsTrace: true,
        transforms: tf(w.rm, ["rotateY", "opacity"]),
        reduceMotion: "cross-fade",
        spring: "spring/flip",
        sounds: [cue("card_flip")],
        event: e,
        eventIndex: index,
      }),
    );
  } else {
    e.reveals.forEach((r, i) => {
      w.out.push(
        mk({
          kind: "reveal",
          meta: {
            source: "showdown",
            deliveries: [{ seat: r.seat, cards: [...r.cards] }],
            cards: [],
            grouped: false,
          },
          at: start + i * stagger,
          duration: dur,
          lane: "dealer",
          speedClass: "paced",
          group,
          blocking: true,
          keepsTrace: true,
          transforms: tf(w.rm, ["rotateY", "opacity"]),
          reduceMotion: "cross-fade",
          spring: "spring/flip",
          sounds: [cue("card_flip", 0, i === 0 ? 0 : SHOWDOWN_SEAT_TRIM_DB * i)],
          event: e,
          eventIndex: index,
        }),
      );
    });
  }

  const lastFlipEnd = start + (grouped ? 0 : (e.reveals.length - 1) * stagger) + dur;
  const glowAt = lastFlipEnd + resolveDuration(SPEC.glowDelay, w.speed, w.rm);
  const glowDur = resolveDuration(SPEC.glow, w.speed, w.rm);
  w.out.push(
    mk({
      kind: "winner-glow",
      meta: { winners, dimmed: revealed.filter((s) => !winners.includes(s)) },
      at: glowAt,
      duration: glowDur,
      lane: "dealer",
      speedClass: "paced",
      group,
      blocking: true,
      transforms: ["opacity"],
      reduceMotion: "cross-fade",
      cssToken: "medium",
      event: e,
      eventIndex: index,
    }),
  );
  w.dealerEnd = glowAt + glowDur;
  w.actorReady = Math.max(w.actorReady, w.dealerEnd);

  // Ambient: the mind-reveal affordance, never before showdown settles (4.10).
  const villains = revealed.filter((s) => s !== w.heroSeat);
  const target = w.tier >= 2 ? "tray" : "felt";
  villains.forEach((seat, i) => {
    w.out.push(
      mk({
        kind: "mind-affordance",
        meta: { seat, target },
        at: lastFlipEnd + MIND_AFFORDANCE_DELAY_MS + i * DURATION.stagger,
        duration: MIND_AFFORDANCE_MS,
        lane: "ambient",
        speedClass: "ambient",
        group: `mind#${index}`,
        blocking: false,
        transforms: tf(w.rm, ["translate", "opacity"]),
        reduceMotion: "fade-in-place",
        cssToken: "fast",
        event: e,
        eventIndex: index,
      }),
    );
  });
}

/* ------------------------------------------------------------------ public */

/**
 * Turn a burst of engine events into a beat schedule.
 *
 * Pure: no clock, no randomness. `at` is measured from `opts.startAt` (default
 * 0). The result is sorted by `at` (ties keep emission order), so a renderer or
 * the Presenter can consume it as a queue.
 */
export function schedule(events: readonly HandEvent[], opts: ScheduleOptions): Beat[] {
  const speed = opts.speed;
  const w: Walker = {
    speed,
    rm: opts.reduceMotion,
    tier: compressionTier(speed),
    heroSeat: opts.heroSeat,
    out: [],
    dealerEnd: 0,
    actorEnd: 0,
    actorReady: 0,
    lastActor: null,
    street: "preflop",
    pot: 0,
    bets: new Map(),
    stacks: new Map(),
    bb: 0,
  };
  const thinkPauses = opts.thinkPauses ?? true;
  const turns = opts.turnIndicators ?? true;
  const winners = events.filter((e): e is PotAwarded => e.t === "pot").map((e) => e.seat);

  let i = 0;
  while (i < events.length) {
    const e = events[i];
    if (e === undefined) break;
    switch (e.t) {
      case "start": {
        w.bb = e.blinds.bb;
        for (const s of e.seats) w.stacks.set(s.seat, s.stack);
        i++;
        break;
      }
      case "post": {
        const run = takeRun(events, i, "post");
        scheduleBlinds(w, run, i);
        i += run.length;
        break;
      }
      case "hole": {
        const run = takeRun(events, i, "hole");
        scheduleHoleCards(w, run, i);
        i += run.length;
        break;
      }
      case "act": {
        scheduleAction(w, e, i, thinkPauses, turns);
        i++;
        break;
      }
      case "board": {
        scheduleMerge(w, i, e);
        scheduleBoard(w, e, i);
        i++;
        break;
      }
      case "showdown": {
        scheduleMerge(w, i, e);
        scheduleShowdown(w, e, i, winners);
        i++;
        break;
      }
      case "pot": {
        const run = takeRun(events, i, "pot");
        scheduleMerge(w, i, run[0]);
        scheduleAwards(w, run, i);
        i += run.length;
        break;
      }
      case "end": {
        const at = dealerStart(w);
        const duration = resolveDuration(SPEC.rest, speed, w.rm);
        w.out.push(
          mk({
            kind: "rest",
            meta: { reason: "auto-deal" },
            at,
            duration,
            lane: "dealer",
            speedClass: "paced",
            group: `rest#${i}`,
            blocking: true,
            transforms: [],
            reduceMotion: "unchanged",
            event: e,
            eventIndex: i,
          }),
        );
        w.dealerEnd = at + duration;
        i++;
        break;
      }
    }
  }

  const t0 = opts.startAt ?? 0;
  const sorted = w.out
    .map((b, idx) => ({ b, idx }))
    .sort((x, y) => x.b.at - y.b.at || x.idx - y.idx)
    .map(({ b }) => (t0 === 0 ? b : ({ ...b, at: b.at + t0 } as Beat)));
  return applySoundPolicy(sorted, speed);
}

/**
 * The bot's think time as a beat (§2.3 + the PRD's 250ms floor): scales `1/S`,
 * never drops below `THINK_FLOOR_MS`, and disappears entirely at instant.
 * Returns `[]` when there is nothing to wait for.
 */
export function scheduleThink(seat: number, thinkTimeMs: number, opts: ScheduleOptions): Beat[] {
  const duration = thinkDuration(thinkTimeMs, opts.speed);
  if (duration <= 0) return [];
  const hero = opts.heroSeat !== undefined && seat === opts.heroSeat;
  return [
    mk({
      kind: "think-pause",
      meta: { seat, hero, requestedMs: thinkTimeMs },
      at: opts.startAt ?? 0,
      duration,
      lane: "actor",
      speedClass: "ambient",
      group: `think#${seat}`,
      blocking: false,
      transforms: opts.reduceMotion ? [] : ["opacity"],
      reduceMotion: "static",
    }),
  ];
}

export interface BanterLine {
  readonly seat: number;
  readonly text: string;
}

/**
 * The one banter slot (§4.13): in · hold (4s ÷ S, min 2s) · out. AMBIENT, so
 * the in/out durations never scale; suppressed entirely at instant, where
 * there is nothing to attach a line to.
 */
export function scheduleBanter(line: BanterLine, opts: ScheduleOptions): Beat[] {
  if (opts.speed === "instant") return [];
  const at = opts.startAt ?? 0;
  const holdMs = Math.max(BANTER_HOLD_MIN_MS, Math.round(BANTER_HOLD_MS / opts.speed));
  const group = `banter#${line.seat}`;
  const meta = { seat: line.seat, text: line.text, holdMs };
  const transforms = tf(opts.reduceMotion, ["translate", "opacity"]);
  return [
    mk({
      kind: "banter",
      meta: { ...meta, phase: "in" },
      at,
      duration: BANTER_IN_MS,
      lane: "ambient",
      speedClass: "ambient",
      group,
      blocking: false,
      transforms,
      reduceMotion: "fade-in-place",
      cssToken: "fast",
    }),
    mk({
      kind: "banter",
      meta: { ...meta, phase: "out" },
      at: at + BANTER_IN_MS + holdMs,
      duration: BANTER_OUT_MS,
      lane: "ambient",
      speedClass: "ambient",
      group,
      blocking: false,
      transforms,
      reduceMotion: "fade-in-place",
      cssToken: "quick",
    }),
  ];
}

/** Seat mood cross-fade (§4.12): silent, always; 800ms, 300ms at instant. */
export function scheduleMoodShift(seat: number, from: SeatMood, to: SeatMood, opts: ScheduleOptions): Beat[] {
  if (from === to) return [];
  return [
    mk({
      kind: "mood-shift",
      meta: { seat, from, to },
      at: opts.startAt ?? 0,
      duration: opts.speed === "instant" ? MOOD_INSTANT_MS : MOOD_MS,
      lane: "ambient",
      speedClass: "ambient",
      group: `mood#${seat}`,
      blocking: false,
      transforms: ["opacity", "blur2px"],
      reduceMotion: "unchanged",
    }),
  ];
}

export interface BadgeGlintOptions extends ScheduleOptions {
  /** Which of the two nags this is (§4.11: a badge nags exactly twice). */
  readonly nag?: 1 | 2;
  /** Hero has a pending decision — the tick is suppressed, the glint still fires. */
  readonly heroPending?: boolean;
}

/** Badge dot pop + glint sweep (§4.11). FEEDBACK: survives instant, never scales. */
export function scheduleBadgeGlint(opts: BadgeGlintOptions): Beat[] {
  const at = opts.startAt ?? 0;
  const nag = opts.nag ?? 1;
  const silent = opts.heroPending === true;
  const group = `badge#${nag}`;
  return [
    mk({
      kind: "badge-glint",
      meta: { phase: "pop", nag, silent },
      at,
      duration: BADGE_POP_MS,
      lane: "ambient",
      speedClass: "feedback",
      group,
      blocking: false,
      keepsTrace: true,
      transforms: opts.reduceMotion ? ["opacity"] : ["scale", "opacity"],
      reduceMotion: "fade-in-place",
      cssToken: "fast",
      sounds: silent ? [] : [cue("badge_tick", 0, -12)],
    }),
    mk({
      kind: "badge-glint",
      meta: { phase: "sweep", nag, silent },
      at: at + BADGE_POP_MS,
      duration: opts.reduceMotion ? BADGE_SWEEP_RM_MS : BADGE_SWEEP_MS,
      lane: "ambient",
      speedClass: "feedback",
      group,
      blocking: false,
      keepsTrace: true,
      transforms: opts.reduceMotion ? ["opacity"] : ["translate", "opacity"],
      reduceMotion: "pulse",
    }),
  ];
}
