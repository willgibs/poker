/**
 * The stage's view-model, and the one function that moves it forward.
 *
 * `TableStageView` is *plain data*: seats, board, pot, hero, action state,
 * density. No callbacks, no class instances, no engine types leaking through —
 * it is exactly what a table store would hand a renderer, and exactly what a
 * test can write by hand.
 *
 * `applyBeat` is the projection: given a settled Presenter beat, it returns the
 * next view. It is the renderer's twin of the table store's reducer, and it is
 * *total* over the beat vocabulary — every kind either changes the view or is
 * explicitly declared ambient. That totality is what makes flush-equivalence
 * testable at the DOM: playing a hand beat by beat and flushing it in one frame
 * both fold the same beats in the same order, so both end on the same view, so
 * both paint the same DOM (beats.md §5.3).
 */

import type { Card, HandStart } from "@poker/history";
import type { LegalActions } from "@poker/engine";
import type { Beat, ChipTier, SeatMood } from "../beats";
import { beatEnd } from "../beats";
import type { CardCode, TableDensity } from "../components";
import { CARD_RANKS, CARD_SUITS } from "../components";
import type { PriceState, SizePreset } from "../hero";

/** A seat as the felt shows it. Index in `TableStageView.seats` is its slot. */
export interface StageSeat {
  /** Engine seat number — the id every beat refers to. Stable for a session. */
  readonly seat: number;
  readonly name: string;
  readonly stackCents: number;
  /** The hero's own seat: plate M+, name always shown, cards in the hero zone. */
  readonly hero?: boolean;
  readonly folded?: boolean;
  /** To act: glow ring + think-pulse. */
  readonly thinking?: boolean;
  readonly mood?: SeatMood;
  readonly earnedRead?: boolean;
  /** Compact HUD tag (`"24 / 19"`) — plate L, Study loadout only. */
  readonly hudTag?: string;
  /** Chips resting on the felt in front of this seat, integer cents. */
  readonly betCents?: number;
  readonly betTier?: ChipTier;
  /** Cards visible face-up at this seat (showdown). */
  readonly cards?: readonly CardCode[];
  /** Cards dealt but face-down. */
  readonly faceDown?: number;
  /** Holds the button this hand. */
  readonly button?: boolean;
  /** Won a pot — the glow sweep. */
  readonly winner?: boolean;
  /** Revealed and lost — dimmed to 70% (beats.md §4.9). */
  readonly dimmed?: boolean;
}

/**
 * The hero's cards. Name and stack are *not* here: the hero also occupies a
 * seat, and one seat's identity living in two places is how they drift apart.
 */
export interface StageHero {
  readonly seat: number;
  /** Dealt cards, in deal order. Rendered as a pair once both have landed. */
  readonly cards: readonly CardCode[] | null;
  /** Dealt but not yet turned over. */
  readonly faceDown?: boolean;
  /** Folded this hand — the cards stay, drained. */
  readonly mucked?: boolean;
}

/** Everything the hero zone needs, already decided upstream. */
export interface StageActionState {
  /** The exact menu from `legalActions(state)`. `{}` disarms the bar. */
  readonly legal: LegalActions;
  readonly presets?: readonly SizePreset[];
  readonly bigBlindCents: number;
  /** The one coach line, or `null` for silence. */
  readonly coach?: string | null;
  /** The one ambient price chip. */
  readonly price?: PriceState;
  /** Villain to act, hand over, beats replaying. */
  readonly disabled?: boolean;
}

/** The whole felt, as data. */
export interface TableStageView {
  readonly density: TableDensity;
  /** In slot order: index 0 is the hero's chair, bottom centre. */
  readonly seats: readonly StageSeat[];
  readonly board: readonly CardCode[];
  readonly potCents: number;
  readonly hero: StageHero | null;
  readonly actionState: StageActionState | null;
}

/* ------------------------------------------------------------------- cards */

/** Engine card int (0–51) → the renderer's canonical string, e.g. `"As"`. */
export function toCardCode(card: Card): CardCode {
  const rank = CARD_RANKS[Math.floor(card / 4)];
  const suit = CARD_SUITS[card % 4];
  // A renderer never throws on bad data: an unreadable code paints a back.
  if (rank === undefined || suit === undefined) return "2c";
  return `${rank}${suit}`;
}

export function toCardCodes(cards: readonly Card[]): CardCode[] {
  return cards.map(toCardCode);
}

/* ------------------------------------------------------------- construction */

/** An empty felt at a density — nothing dealt, nothing owed. */
export function emptyStageView(density: TableDensity = 6): TableStageView {
  return { density, seats: [], board: [], potCents: 0, hero: null, actionState: null };
}

export interface SeatIdentity {
  readonly seat: number;
  readonly name: string;
  readonly hero?: boolean;
  readonly earnedRead?: boolean;
  readonly hudTag?: string;
}

/**
 * The pre-deal view for a hand: seats in the order given (slot 0 first),
 * stacks and the button from the log's `start` event, nothing else on the felt.
 * The demo replay and the tests both start here, so both start identical.
 */
export function viewFromStart(
  start: HandStart,
  identities: readonly SeatIdentity[],
  density: TableDensity = 6,
): TableStageView {
  const stacks = new Map(start.seats.map((s) => [s.seat, s.stack]));
  const heroIdentity = identities.find((i) => i.hero === true);
  const seats: StageSeat[] = identities.map((identity) => ({
    seat: identity.seat,
    name: identity.name,
    stackCents: stacks.get(identity.seat) ?? 0,
    ...(identity.hero === true ? { hero: true } : {}),
    ...(identity.earnedRead === true ? { earnedRead: true } : {}),
    ...(identity.hudTag === undefined ? {} : { hudTag: identity.hudTag }),
    ...(start.button === identity.seat ? { button: true } : {}),
  }));

  return {
    density,
    seats,
    board: [],
    potCents: 0,
    hero: heroIdentity === undefined ? null : { seat: heroIdentity.seat, cards: null },
    actionState: null,
  };
}

/* ---------------------------------------------------------------- projection */

function mapSeats(
  view: TableStageView,
  fn: (seat: StageSeat) => StageSeat,
): TableStageView {
  return { ...view, seats: view.seats.map(fn) };
}

function mapSeat(
  view: TableStageView,
  seatNumber: number,
  fn: (seat: StageSeat) => StageSeat,
): TableStageView {
  return mapSeats(view, (seat) => (seat.seat === seatNumber ? fn(seat) : seat));
}

/** Only the acting seat carries the pulse — the ring is singular by law. */
function onlyThinking(view: TableStageView, seatNumber: number | null): TableStageView {
  return mapSeats(view, (seat) => {
    const next = seat.seat === seatNumber;
    if ((seat.thinking === true) === next) return seat;
    return next ? { ...seat, thinking: true } : { ...seat, thinking: false };
  });
}

/**
 * Fold one settled beat into the view.
 *
 * Ordering, not timing, is what this function consumes: it is called once per
 * beat on settle, whether that settle came from the clock or from `flush()`.
 */
export function applyBeat(view: TableStageView, beat: Beat): TableStageView {
  switch (beat.kind) {
    case "deal-hole": {
      let next = view;
      for (const delivery of beat.meta.deliveries) {
        const codes = toCardCodes(delivery.cards);
        next = mapSeat(next, delivery.seat, (seat) => ({
          ...seat,
          faceDown: (seat.faceDown ?? 0) + codes.length,
        }));
        if (next.hero !== null && next.hero.seat === delivery.seat) {
          next = {
            ...next,
            hero: { ...next.hero, cards: [...(next.hero.cards ?? []), ...codes], faceDown: true },
          };
        }
      }
      return next;
    }

    case "deal-board":
      return { ...view, board: [...view.board, ...toCardCodes(beat.meta.cards)] };

    case "reveal": {
      // Board flips carry no view change: `deal-board` already placed the card,
      // and the board renders face-up. Hole-card flips are the real reveal.
      if (beat.meta.source === "board") return view;
      let next = view;
      for (const delivery of beat.meta.deliveries) {
        const codes = toCardCodes(delivery.cards);
        next = mapSeat(next, delivery.seat, (seat) => {
          // A hand can be revealed twice — the hero's own flip on the deal, then
          // the same two cards again at showdown. Revealing is idempotent: it
          // makes *these* cards visible, it does not deal more of them.
          const shown = seat.cards ?? [];
          const fresh = codes.filter((code) => !shown.includes(code));
          if (fresh.length === 0) return seat;
          return {
            ...seat,
            cards: [...shown, ...fresh],
            // A card that has turned over is no longer one of the face-down ones.
            faceDown: Math.max(0, (seat.faceDown ?? 0) - fresh.length),
          };
        });
        if (next.hero !== null && next.hero.seat === delivery.seat) {
          next = { ...next, hero: { ...next.hero, faceDown: false } };
        }
      }
      return next;
    }

    case "winner-glow": {
      const winners = new Set(beat.meta.winners);
      const dimmed = new Set(beat.meta.dimmed);
      return onlyThinking(
        mapSeats(view, (seat) => ({
          ...seat,
          ...(winners.has(seat.seat) ? { winner: true } : {}),
          ...(dimmed.has(seat.seat) ? { dimmed: true } : {}),
        })),
        null,
      );
    }

    case "chips-out": {
      if (beat.meta.aggression === "blind") {
        let next = view;
        for (const post of beat.meta.posts) {
          next = mapSeat(next, post.seat, (seat) => ({
            ...seat,
            betCents: (seat.betCents ?? 0) + post.amount,
            betTier: 1,
            stackCents: seat.stackCents - post.amount,
          }));
        }
        return next;
      }
      const meta = beat.meta;
      return mapSeat(view, meta.seat, (seat) => ({
        ...seat,
        betCents: meta.toAmount,
        betTier: meta.tier,
        stackCents: seat.stackCents - meta.amount,
      }));
    }

    case "chips-collect": {
      const swept = new Set(beat.meta.seats.map((s) => s.seat));
      return {
        ...mapSeats(view, (seat) =>
          swept.has(seat.seat) ? { ...seat, betCents: 0, betTier: undefined } : seat,
        ),
        potCents: beat.meta.potAfter,
      };
    }

    case "pot-award": {
      const meta = beat.meta;
      return {
        ...mapSeat(view, meta.seat, (seat) => ({
          ...seat,
          stackCents: seat.stackCents + meta.amount,
          winner: true,
        })),
        potCents: Math.max(0, view.potCents - meta.amount),
      };
    }

    case "fold-muck": {
      const seatNumber = beat.meta.seat;
      const folded = mapSeat(view, seatNumber, (seat) => ({
        ...seat,
        folded: true,
        thinking: false,
        faceDown: 0,
        cards: undefined,
      }));
      return view.hero !== null && view.hero.seat === seatNumber
        ? { ...folded, hero: { ...view.hero, mucked: true } }
        : folded;
    }

    case "turn-indicator":
      return onlyThinking(view, beat.meta.seat);

    case "think-pause":
      return onlyThinking(view, beat.meta.seat);

    case "mood-shift": {
      const to = beat.meta.to;
      return mapSeat(view, beat.meta.seat, (seat) => ({ ...seat, mood: to }));
    }

    case "rest":
      // The hand is over: nobody is to act while the felt rests.
      return onlyThinking(view, null);

    // Ambient and feedback-only beats: they change how the felt *feels*, never
    // what it holds. `check-knock` is the seat plate's own dip; the badge,
    // banter and mind-reveal affordance live outside the view-model entirely.
    case "check-knock":
    case "mind-affordance":
    case "badge-glint":
    case "banter":
      return view;
  }
}

/**
 * The order beats *settle* in, which is not the order they start in: a long
 * beat that began first can land after a short one that began later. The
 * Presenter settles by `(settleAt, seq)` both when the clock reaches a beat and
 * when `flush()` jumps it (presenter.ts), so this is the one ordering a
 * projection may be folded in.
 */
export function settleOrder(beats: readonly Beat[]): Beat[] {
  return beats
    .map((beat, index) => ({ beat, index }))
    .sort((a, b) => beatEnd(a.beat) - beatEnd(b.beat) || a.index - b.index)
    .map((entry) => entry.beat);
}

/** Fold a whole beat list in settle order. The settled end-state. */
export function applyBeats(view: TableStageView, beats: readonly Beat[]): TableStageView {
  return settleOrder(beats).reduce(applyBeat, view);
}
