/**
 * HeroCards — your two cards, at hero size (cards.html: 72px).
 *
 * The pair the whole zone is built around: overlapped and fanned like a hand
 * held at the table, never a neat row. Composition only — the Reader face,
 * its metrics, and its four-colour paint all belong to `PlayingCard`
 * (`../components`), and deal/flip choreography belongs to the Presenter.
 *
 * The pair carries one accessible name ("Your hand, ace of spades, queen of
 * diamonds") rather than two loose card images, because that is the unit a
 * player thinks in.
 */

import { PlayingCard } from "../components";
import type { CardCode, CardSize } from "../components";

export interface HeroCardsProps {
  /** Your two cards, or `null` before the deal / after a muck. */
  cards: readonly [CardCode, CardCode] | null;
  size?: CardSize;
  /** Face-down: dealt but not yet turned over. */
  faceDown?: boolean;
  /** Folded this hand — the cards stay, drained. */
  mucked?: boolean;
  /** Accessible name for the pair. */
  label?: string;
  className?: string;
}

export function HeroCards({
  cards,
  size = "hero",
  faceDown = false,
  mucked = false,
  label = "Your hand",
  className,
}: HeroCardsProps) {
  const classes = ["fr-herocards", className]
    .filter((c): c is string => typeof c === "string" && c.length > 0)
    .join(" ");

  if (cards === null) {
    return <span className={classes} data-hero-cards data-empty="" aria-hidden="true" />;
  }

  return (
    <span className={classes} data-hero-cards role="group" aria-label={label} data-mucked={mucked ? "" : undefined}>
      <PlayingCard card={cards[0]} size={size} faceDown={faceDown} mucked={mucked} className="fr-herocards__card" />
      <PlayingCard card={cards[1]} size={size} faceDown={faceDown} mucked={mucked} className="fr-herocards__card" />
    </span>
  );
}
