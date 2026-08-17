/**
 * The card alphabet, in display terms.
 *
 * Cards are ints 0–51 in the engine (`@poker/core`); their string form — rank
 * char + suit char, e.g. `"As"`, `"Td"`, `"2c"` — is the canonical wire form
 * (CLAUDE.md) and the shape the renderer speaks. `cards.test.ts` asserts this
 * module's alphabet is character-identical to `@poker/core`'s `RANK_CHARS` /
 * `SUIT_CHARS`, so the two can never drift.
 *
 * Everything here is pure data + string work: no DOM, no React.
 */

/** Ranks, ascending, as their canonical chars. */
export const CARD_RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "T", "J", "Q", "K", "A"] as const;

/** Suits in engine order (`0=♣ 1=♦ 2=♥ 3=♠`), as their canonical chars. */
export const CARD_SUITS = ["c", "d", "h", "s"] as const;

export type CardRank = (typeof CARD_RANKS)[number];
export type CardSuit = (typeof CARD_SUITS)[number];

/** A card in canonical string form — `"As"`, `"Td"`, `"2c"`. */
export type CardCode = `${CardRank}${CardSuit}`;

/**
 * What the face prints. Ten is the only rank whose glyph is not its char: the
 * Reader face has the room for "10" at every size (cards.html Study 1B).
 */
const RANK_GLYPH = {
  "2": "2",
  "3": "3",
  "4": "4",
  "5": "5",
  "6": "6",
  "7": "7",
  "8": "8",
  "9": "9",
  T: "10",
  J: "J",
  Q: "Q",
  K: "K",
  A: "A",
} as const satisfies Record<CardRank, string>;

/** What a screen reader says. */
const RANK_WORD = {
  "2": "two",
  "3": "three",
  "4": "four",
  "5": "five",
  "6": "six",
  "7": "seven",
  "8": "eight",
  "9": "nine",
  T: "ten",
  J: "jack",
  Q: "queen",
  K: "king",
  A: "ace",
} as const satisfies Record<CardRank, string>;

const SUIT_GLYPH = {
  c: "♣",
  d: "♦",
  h: "♥",
  s: "♠",
} as const satisfies Record<CardSuit, string>;

const SUIT_WORD = {
  c: "clubs",
  d: "diamonds",
  h: "hearts",
  s: "spades",
} as const satisfies Record<CardSuit, string>;

/** Everything a card face needs to render itself, resolved once. */
export interface ReadCard {
  readonly rank: CardRank;
  readonly suit: CardSuit;
  /** The oversized top-left index — `"10"` for tens, the rank char otherwise. */
  readonly rankGlyph: string;
  /** The bottom-right suit glyph. */
  readonly suitGlyph: string;
  /** Accessible name, e.g. `"ace of spades"`. */
  readonly label: string;
}

function isRank(char: string): char is CardRank {
  return (CARD_RANKS as readonly string[]).includes(char);
}

function isSuit(char: string): char is CardSuit {
  return (CARD_SUITS as readonly string[]).includes(char);
}

/**
 * Parse a canonical card string. Returns `undefined` for anything that is not
 * exactly one rank char followed by one suit char — a renderer never throws on
 * bad data, it falls back to a face-down card.
 */
export function readCard(code: string): ReadCard | undefined {
  if (code.length !== 2) return undefined;
  const rank = code[0] ?? "";
  const suit = code[1] ?? "";
  if (!isRank(rank) || !isSuit(suit)) return undefined;
  return {
    rank,
    suit,
    rankGlyph: RANK_GLYPH[rank],
    suitGlyph: SUIT_GLYPH[suit],
    label: `${RANK_WORD[rank]} of ${SUIT_WORD[suit]}`,
  };
}

/** Accessible name for a card string, or `undefined` if it is not a card. */
export function cardLabel(code: string): string | undefined {
  return readCard(code)?.label;
}
