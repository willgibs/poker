/**
 * Entrance choreography for the board's cards, as data.
 *
 * Keeping it here — pure, framework-free, unit-testable — means the reduce-
 * motion contract is asserted without rendering a spring: `Board.tsx` is then
 * only the wiring.
 *
 * Every number is a token lookup: `spring/deal` physics from `@poker/ui`'s
 * spring table (beats.md §2.1, Apple-style `{duration, bounce}`), the 12px card
 * arc and the stagger from the Presenter's own tokens, and `--duration-quick`
 * for the reduce-motion fade (beats.md §4.2, §5.4).
 */

import { durationMs, spring } from "@poker/ui";
import { CARD_ARC_PX } from "../tokens";

/** A `motion/react` transition, in the two shapes this kit uses. */
export type EntranceTransition =
  | { readonly duration: number; readonly delay: number }
  | { readonly type: "spring"; readonly duration: number; readonly bounce: number; readonly delay: number };

export interface Entrance {
  /** Frame 0. Transform strings only — never the `x`/`y` shorthands. */
  readonly initial: { readonly opacity: number; readonly transform?: string };
  /** The settled end-state. Always reachable in one flush. */
  readonly animate: { readonly opacity: number; readonly transform: string };
  readonly transition: EntranceTransition;
}

/**
 * The entrance for the board card in slot `index`.
 *
 * Reduce-motion collapses it to a fade in place at `--duration-quick`, keeping
 * the stagger — rhythm without motion (beats.md §5.4).
 */
export function boardCardEntrance(index: number, staggerMs: number, reduceMotion: boolean): Entrance {
  const delay = (index * staggerMs) / 1000;
  const animate = { opacity: 1, transform: "translateY(0px)" } as const;

  if (reduceMotion) {
    return {
      initial: { opacity: 0 },
      animate,
      transition: { duration: durationMs.quick / 1000, delay },
    };
  }

  return {
    initial: { opacity: 0, transform: `translateY(-${CARD_ARC_PX}px)` },
    animate,
    transition: {
      type: "spring",
      duration: spring.deal.durationSec,
      bounce: spring.deal.bounce,
      delay,
    },
  };
}
