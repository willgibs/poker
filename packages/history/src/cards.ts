/**
 * Minimal card string helpers, internal to @poker/history.
 *
 * These mirror the repo-wide card convention (see CLAUDE.md and
 * docs/hand-format.md): card = rank * 4 + suit, rank char from
 * "23456789TJQKA", suit char from "cdhs". Kept local (and NOT re-exported
 * from the package index) so the history package stays green while
 * @poker/core is under construction; consumers should use core's helpers.
 */

import type { Card } from "./types";

const RANK_CHARS = "23456789TJQKA";
const SUIT_CHARS = "cdhs";

/** True when `card` is an integer in 0..51. */
export function isCard(card: number): card is Card {
  return Number.isInteger(card) && card >= 0 && card <= 51;
}

/** "As", "Td", "2c" — throws RangeError on out-of-range input. */
export function cardToString(card: Card): string {
  if (!isCard(card)) throw new RangeError(`invalid card int: ${card}`);
  const rank = card >> 2;
  const suit = card & 3;
  return `${RANK_CHARS.charAt(rank)}${SUIT_CHARS.charAt(suit)}`;
}

/** Parse "As" → 51 etc. — throws RangeError on malformed input. */
export function cardFromString(s: string): Card {
  if (s.length !== 2) throw new RangeError(`invalid card string: ${JSON.stringify(s)}`);
  const rank = RANK_CHARS.indexOf(s.charAt(0));
  const suit = SUIT_CHARS.indexOf(s.charAt(1));
  if (rank < 0 || suit < 0) throw new RangeError(`invalid card string: ${JSON.stringify(s)}`);
  return rank * 4 + suit;
}
