/**
 * The board — always five slots: what has been dealt, plus the promise of what
 * has not (cards.html Study 4).
 *
 * Stagger-ready: every dealt card is its own motion element, keyed by slot and
 * card, so the Presenter's deal-street beats mount exactly the cards that just
 * arrived and leave the settled ones alone. The entrance obeys beats.md — full
 * `transform` strings (never `x`/`y`), `spring/deal` physics from the token
 * table, the 12px card arc from the Presenter's own tokens, staggered by
 * `--duration-stagger` — and collapses to a fade in place under reduce-motion.
 */

import type { ReactElement } from "react";
import { motion, useReducedMotion } from "motion/react";
import { DURATION } from "../tokens";
import { boardCardEntrance } from "./entrance";
import { EmptySlot, PlayingCard } from "./PlayingCard";
import type { CardSize } from "./PlayingCard";
import type { CardCode } from "./cards";
import { readCard } from "./cards";
import { cx } from "./cx";

/** Flop, turn, river: the board is five slots, always. */
export const BOARD_SLOTS = 5;

export interface BoardProps {
  /** Dealt community cards, in order. 0–5; extras are ignored. */
  readonly cards?: readonly CardCode[];
  readonly size?: CardSize;
  /** Per-slot entrance stagger, ms. Defaults to the `stagger` beat token. */
  readonly staggerMs?: number;
  /** Accessible name. Defaults to the cards, spelled out. */
  readonly label?: string;
  readonly className?: string;
  readonly id?: string;
}

function boardLabel(cards: readonly CardCode[]): string {
  if (cards.length === 0) return "board, no cards dealt";
  const spoken = cards.map((card) => readCard(card)?.label ?? "face-down card");
  return `board: ${spoken.join(", ")}`;
}

export function Board({
  cards = [],
  size = "table",
  staggerMs = DURATION.stagger,
  label,
  className,
  id,
}: BoardProps): ReactElement {
  const reduceMotion = useReducedMotion() === true;
  const dealt = cards.slice(0, BOARD_SLOTS);
  const slots = Array.from({ length: BOARD_SLOTS }, (_, index) => dealt[index]);

  return (
    <div
      id={id}
      className={cx("fr-board", className)}
      data-fr="board"
      data-size={size}
      data-dealt={dealt.length}
      role="group"
      aria-label={label ?? boardLabel(dealt)}
    >
      {slots.map((card, index) => {
        if (card === undefined) {
          return <EmptySlot key={`fr-board-slot-${index}`} size={size} />;
        }

        const entrance = boardCardEntrance(index, staggerMs, reduceMotion);
        return (
          <motion.span
            key={`fr-board-card-${index}-${card}`}
            className="fr-board__cell"
            data-fr="board-card"
            data-index={index}
            initial={entrance.initial}
            animate={entrance.animate}
            transition={entrance.transition}
          >
            <PlayingCard card={card} size={size} />
          </motion.span>
        );
      })}
    </div>
  );
}
