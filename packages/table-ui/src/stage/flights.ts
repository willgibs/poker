/**
 * Flights — the travelling half of a beat, as data.
 *
 * A beat says *what moved, from where, for how long*; this turns that into the
 * handful of transient elements the stage mounts while it is in the air and
 * unmounts the instant it settles. Keeping it pure (no React, no DOM) means the
 * reduce-motion contract and the beats.md law "transform + opacity only" are
 * unit-testable without rendering a spring — the same trick `entrance.ts` plays
 * for the board.
 *
 * The three axes the felt animates along (beats.md §4) are all here:
 *   - dealer → seat: hole cards
 *   - seat → pot: chips out, then chips collected along the same axis
 *   - pot → winner: the award
 *
 * Two beats deliberately produce no flight:
 *   - `deal-board`, because `Board` owns its own staggered card entrance and
 *     two animations for one card is a stutter, not a flourish;
 *   - anything with no translation in `beat.transforms` — which, under
 *     reduce-motion, is *every* beat, since `schedule()` has already swapped
 *     the transform list for its fade variant (beats.md §5.4). Nothing travels
 *     under reduce-motion because nothing is asked to.
 */

import { spring } from "@poker/ui";
import type { SpringName } from "@poker/ui";
import type { Beat } from "../beats";
import { hasTranslation } from "../beats";
import type { SpringToken } from "../tokens";
import type { CardCode, TableDensity } from "../components";
import type { StagePoint } from "./geometry";
import { DEALER_ORIGIN, POT_ANCHOR, betAnchor, seatSlot } from "./geometry";
import { toCardCode } from "./view";

/** What a flight carries: a card back, a chip stack, or the pot itself. */
export type FlightKind = "card" | "chip" | "pot";

/** A `motion/react` transition, in the two shapes the kit uses. */
export type FlightTransition =
  | { readonly duration: number }
  | { readonly type: "spring"; readonly duration: number; readonly bounce: number };

/** One element in the air. */
export interface StageFlight {
  /** Stable within a beat: `${beat.group}:${kind}:${n}`. React's key. */
  readonly id: string;
  readonly kind: FlightKind;
  readonly from: StagePoint;
  readonly to: StagePoint;
  readonly transition: FlightTransition;
  /** A card in flight, when it is face-up (nothing in v1 flies face-up yet). */
  readonly card?: CardCode;
  /** Chip amount in integer cents — the label the chip carries while moving. */
  readonly amountCents?: number;
  /** Fades out as it lands rather than in as it leaves (the muck). */
  readonly fading?: boolean;
}

/** What a flight needs to know about the table it is crossing. */
export interface FlightContext {
  readonly density: TableDensity;
  /** Engine seat number → slot index, or `undefined` if the seat is not shown. */
  slotOf(seat: number): number | undefined;
}

function springNameOf(token: SpringToken | undefined): SpringName | null {
  if (token === undefined) return null;
  const name = token.slice("spring/".length);
  return name in spring ? (name as SpringName) : null;
}

/**
 * The beat's own duration, rendered with the beat's own spring.
 *
 * `beat.duration` is authoritative — it is what the Presenter scheduled and
 * what the next beat is waiting on — so the spring is expressed in motion's
 * `{duration, bounce}` form rather than raw physics. The picture then settles
 * on exactly the frame the schedule says it does.
 */
export function flightTransition(beat: Beat): FlightTransition {
  const seconds = beat.duration / 1000;
  const name = springNameOf(beat.spring);
  if (name === null) return { duration: seconds };
  return { type: "spring", duration: seconds, bounce: spring[name].bounce };
}

function seatPoint(ctx: FlightContext, seat: number): StagePoint | null {
  const slot = ctx.slotOf(seat);
  return slot === undefined ? null : seatSlot(ctx.density, slot);
}

/**
 * The elements a beat puts in the air. Empty for a beat that does not travel,
 * has no duration to travel in, or animates something the felt owns already.
 */
export function flightsForBeat(beat: Beat, ctx: FlightContext): StageFlight[] {
  if (beat.duration <= 0 || !hasTranslation(beat)) return [];
  const transition = flightTransition(beat);
  const flights: StageFlight[] = [];

  switch (beat.kind) {
    case "deal-hole": {
      beat.meta.deliveries.forEach((delivery, i) => {
        const to = seatPoint(ctx, delivery.seat);
        if (to === null) return;
        delivery.cards.forEach((card, k) => {
          flights.push({
            id: `${beat.group}:card:${delivery.seat}:${i}:${k}`,
            kind: "card",
            from: DEALER_ORIGIN,
            to,
            transition,
            card: toCardCode(card),
          });
        });
      });
      return flights;
    }

    case "chips-out": {
      if (beat.meta.aggression === "blind") {
        beat.meta.posts.forEach((post, i) => {
          const from = seatPoint(ctx, post.seat);
          if (from === null) return;
          flights.push({
            id: `${beat.group}:chip:${post.seat}:${i}`,
            kind: "chip",
            from,
            to: betAnchor(from),
            transition,
            amountCents: post.amount,
          });
        });
        return flights;
      }
      const from = seatPoint(ctx, beat.meta.seat);
      if (from === null) return flights;
      flights.push({
        id: `${beat.group}:chip:${beat.meta.seat}`,
        kind: "chip",
        from,
        to: betAnchor(from),
        transition,
        amountCents: beat.meta.amount,
      });
      return flights;
    }

    case "chips-collect": {
      beat.meta.seats.forEach((entry, i) => {
        const seat = seatPoint(ctx, entry.seat);
        if (seat === null) return;
        flights.push({
          id: `${beat.group}:chip:${entry.seat}:${i}`,
          kind: "chip",
          from: betAnchor(seat),
          to: POT_ANCHOR,
          transition,
          amountCents: entry.amount,
        });
      });
      return flights;
    }

    case "pot-award": {
      const to = seatPoint(ctx, beat.meta.seat);
      if (to === null) return flights;
      flights.push({
        id: `${beat.group}:pot:${beat.meta.seat}:${beat.meta.splitIndex}`,
        kind: "pot",
        from: POT_ANCHOR,
        to,
        transition,
        amountCents: beat.meta.amount,
      });
      return flights;
    }

    case "fold-muck": {
      if (!beat.meta.travel) return flights;
      const from = seatPoint(ctx, beat.meta.seat);
      if (from === null) return flights;
      flights.push({
        id: `${beat.group}:card:${beat.meta.seat}`,
        kind: "card",
        from,
        to: DEALER_ORIGIN,
        transition,
        fading: true,
      });
      return flights;
    }

    // `deal-board` lands through `Board`'s own entrance; `reveal`, the knock,
    // the ring and every ambient beat animate in place, where they already are.
    default:
      return flights;
  }
}
