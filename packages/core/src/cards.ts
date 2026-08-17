/**
 * Card primitives.
 *
 * A card is an integer 0–51: `card = rank * 4 + suit`.
 * Rank: 0=2, 1=3, … 8=T, 9=J, 10=Q, 11=K, 12=A.
 * Suit: 0=club, 1=diamond, 2=heart, 3=spade.
 * String form: rank char from "23456789TJQKA" + suit char from "cdhs",
 * e.g. "As" = 51, "Td" = 33, "2c" = 0.
 */

export type Card = number;

export const RANK_CHARS = "23456789TJQKA";
export const SUIT_CHARS = "cdhs";

export const RANK_COUNT = 13;
export const SUIT_COUNT = 4;
export const DECK_SIZE = 52;

/** Named rank values (0=deuce … 12=ace). */
export const RANK = {
  TWO: 0,
  THREE: 1,
  FOUR: 2,
  FIVE: 3,
  SIX: 4,
  SEVEN: 5,
  EIGHT: 6,
  NINE: 7,
  TEN: 8,
  JACK: 9,
  QUEEN: 10,
  KING: 11,
  ACE: 12,
} as const;

/** Named suit values (0=club, 1=diamond, 2=heart, 3=spade). */
export const SUIT = {
  CLUB: 0,
  DIAMOND: 1,
  HEART: 2,
  SPADE: 3,
} as const;

export type Rank = (typeof RANK)[keyof typeof RANK];
export type Suit = (typeof SUIT)[keyof typeof SUIT];

/** True iff `card` is an integer in 0–51. */
export function isCard(card: number): card is Card {
  return Number.isInteger(card) && card >= 0 && card < DECK_SIZE;
}

function assertCard(card: number): void {
  if (!isCard(card)) {
    throw new RangeError(`invalid card: ${card} (expected integer 0-${DECK_SIZE - 1})`);
  }
}

/** Build a card from rank (0–12) and suit (0–3). Throws on out-of-range input. */
export function makeCard(rank: number, suit: number): Card {
  if (!Number.isInteger(rank) || rank < 0 || rank >= RANK_COUNT) {
    throw new RangeError(`invalid rank: ${rank} (expected integer 0-${RANK_COUNT - 1})`);
  }
  if (!Number.isInteger(suit) || suit < 0 || suit >= SUIT_COUNT) {
    throw new RangeError(`invalid suit: ${suit} (expected integer 0-${SUIT_COUNT - 1})`);
  }
  return rank * SUIT_COUNT + suit;
}

/** Rank of a card, 0=deuce … 12=ace. */
export function rankOf(card: Card): Rank {
  return ((card / SUIT_COUNT) | 0) as Rank;
}

/** Suit of a card, 0=club, 1=diamond, 2=heart, 3=spade. */
export function suitOf(card: Card): Suit {
  return (card % SUIT_COUNT) as Suit;
}

/** Card → two-char string, e.g. 51 → "As". Throws on invalid card. */
export function cardToString(card: Card): string {
  assertCard(card);
  return RANK_CHARS.charAt(rankOf(card)) + SUIT_CHARS.charAt(suitOf(card));
}

/** Two-char string → card, e.g. "As" → 51. Throws on invalid input. */
export function cardFromString(s: string): Card {
  if (s.length !== 2) {
    throw new RangeError(`invalid card string: ${JSON.stringify(s)} (expected 2 chars)`);
  }
  const rank = RANK_CHARS.indexOf(s.charAt(0));
  const suit = SUIT_CHARS.indexOf(s.charAt(1));
  if (rank < 0 || suit < 0) {
    throw new RangeError(`invalid card string: ${JSON.stringify(s)}`);
  }
  return rank * SUIT_COUNT + suit;
}

/** A fresh, unshuffled deck: cards 0..51 in ascending order. */
export function freshDeck(): Card[] {
  const deck: Card[] = new Array<Card>(DECK_SIZE);
  for (let i = 0; i < DECK_SIZE; i++) deck[i] = i;
  return deck;
}
