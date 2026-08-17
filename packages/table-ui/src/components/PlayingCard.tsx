/**
 * The card — "Reader" face, the system of record (cards.html Study 1B).
 *
 * Rank owns the top-left, oversized; the suit anchors the bottom-right;
 * nothing repeats and nothing is mirrored. That is the only face that survives
 * the 24px HUD test, and it is why the metrics are one variable: every other
 * number on the card derives from `--fr-card-w` (72 / 56 / 24).
 *
 * Pure and presentational: it knows a card string, a size, and three states.
 * Deal choreography, muck timing and reveal order belong to the Presenter.
 */

import type { ReactElement } from "react";
import { cx } from "./cx";
import { readCard } from "./cards";
import type { CardCode } from "./cards";

/** 72px hero hand · 56px table · 24px HUD / tray chip (cards.html). */
export type CardSize = "hero" | "table" | "hud";

export interface PlayingCardProps {
  /** Canonical card string — `"As"`, `"Td"`, `"2c"`. Omit for a back. */
  readonly card?: CardCode;
  /** Force the back even when `card` is known (villain hole cards). */
  readonly faceDown?: boolean;
  /** Dead card: 38% opacity, colour drained. Released, not deleted. */
  readonly mucked?: boolean;
  readonly size?: CardSize;
  /** One extra class, for placement only. */
  readonly className?: string;
  /** Escape hatch for the Presenter's beat targeting. */
  readonly id?: string;
}

const BACK_LABEL = "face-down card";

/**
 * A single card. Face-up when it has a readable `card` and `faceDown` is not
 * set; a back otherwise — an unreadable card string never throws, it falls back
 * to the back, because a renderer's job is to keep drawing.
 */
export function PlayingCard({
  card,
  faceDown = false,
  mucked = false,
  size = "table",
  className,
  id,
}: PlayingCardProps): ReactElement {
  const read = card === undefined ? undefined : readCard(card);

  if (read === undefined || faceDown) {
    return (
      <span
        id={id}
        className={cx("fr-card", "fr-card--back", className)}
        data-fr="card"
        data-size={size}
        data-face="down"
        data-mucked={mucked ? "true" : undefined}
        role="img"
        aria-label={mucked ? `${BACK_LABEL}, mucked` : BACK_LABEL}
      />
    );
  }

  return (
    <span
      id={id}
      className={cx("fr-card", "fr-card--face", className)}
      data-fr="card"
      data-size={size}
      data-face="up"
      data-suit={read.suit}
      data-rank={read.rank}
      data-mucked={mucked ? "true" : undefined}
      role="img"
      aria-label={mucked ? `${read.label}, mucked` : read.label}
    >
      <span className="fr-card__rank" aria-hidden="true">
        {read.rankGlyph}
      </span>
      <span className="fr-card__suit" aria-hidden="true">
        {read.suitGlyph}
      </span>
    </span>
  );
}

export interface EmptySlotProps {
  readonly size?: CardSize;
  readonly className?: string;
  /**
   * Accessible name. Omitted by default: an undealt street is silent to a
   * screen reader — the board's own label already says which cards exist.
   */
  readonly label?: string;
  readonly id?: string;
}

/**
 * The undealt street: a dashed 22%-white keyline over a 3% fill. Present,
 * patient, silent (cards.html Study 4).
 */
export function EmptySlot({ size = "table", className, label, id }: EmptySlotProps): ReactElement {
  return (
    <span
      id={id}
      className={cx("fr-card-slot", className)}
      data-fr="card-slot"
      data-size={size}
      role={label === undefined ? undefined : "img"}
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
    />
  );
}
