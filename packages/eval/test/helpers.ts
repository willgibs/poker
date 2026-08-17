/** Test helpers: card parsing and a small seeded LCG (fixed seeds only). */

const RANK_CHARS = "23456789TJQKA";
const SUIT_CHARS = "cdhs";

/** Parse a card string like "As" or "Td" into a card int 0-51. */
export function card(s: string): number {
  const r = RANK_CHARS.indexOf(s[0]!);
  const su = SUIT_CHARS.indexOf(s[1]!);
  if (s.length !== 2 || r < 0 || su < 0) throw new Error(`bad card "${s}"`);
  return r * 4 + su;
}

/** Parse a space-separated card list, e.g. "Ah Kh Qh Jh Th 2c 3d". */
export function cards(s: string): number[] {
  return s.trim().split(/\s+/).map(card);
}

/** Deterministic 32-bit LCG (Numerical Recipes constants). Returns uint32. */
export function makeLcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state;
  };
}

/**
 * Uniform-ish int in [0, n) from the generator's HIGH bits (multiply-shift).
 * An LCG's low bits are badly correlated — using `next() % n` visibly skews
 * dealt boards (e.g. 5x too many straight flushes).
 */
export function nextBelow(next: () => number, n: number): number {
  return ((next() / 4294967296) * n) | 0;
}

const BASE_DECK = new Uint8Array(52);
for (let i = 0; i < 52; i++) BASE_DECK[i] = i;

/**
 * Deal a random 7-card board (distinct cards) into `out` via a partial
 * Fisher-Yates over a fresh 52-card deck.
 */
export function randomBoard(next: () => number, out: Uint8Array, deck: Uint8Array): void {
  deck.set(BASE_DECK);
  for (let i = 0; i < 7; i++) {
    const j = i + nextBelow(next, 52 - i);
    const tmp = deck[i]!;
    deck[i] = deck[j]!;
    deck[j] = tmp;
    out[i] = deck[i]!;
  }
}

/** In-place Fisher-Yates shuffle of a 7-card array. */
export function shuffle7(a: number[], next: () => number): void {
  for (let i = 6; i > 0; i--) {
    const j = nextBelow(next, i + 1);
    const tmp = a[i]!;
    a[i] = a[j]!;
    a[j] = tmp;
  }
}
