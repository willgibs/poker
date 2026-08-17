/**
 * The hero zone's prop vocabulary.
 *
 * Everything here is *already decided* by the time it reaches a component:
 * which sizes exist, what each one costs, which one the coach would take, what
 * the price is. The hero zone renders decisions; it never makes them. Sizing
 * math, suggestion policy, and legality all live upstream in `@poker/engine`
 * and the Presenter — see docs/architecture.md, "Table projection".
 */

/** One sizing preset on the expanded bar (table.html Study 3B). */
export interface SizePreset {
  /** Stable id — the key React uses and the id `onSelectPreset` reports. */
  readonly id: string;
  /** What the player chooses: `"33%"`, `"Pot"`, `"All-in"`. */
  readonly label: string;
  /** What it costs, in integer cents. The bet/raise-TO total. */
  readonly amountCents: number;
  /** Pre-highlighted when the bar expands. At most one preset should set this. */
  readonly suggested?: boolean;
}

/**
 * Card face sizes come from `../components` (`CardSize`: 72 / 56 / 24px, locked
 * at cards.html's recommendation) — the hero zone does not define a second
 * scale for the same thing.
 */

/** The two states of the single ambient price chip (table.html Study 3C). */
export type PriceState =
  | { readonly kind: "pot"; readonly potCents: number }
  | {
      readonly kind: "call";
      readonly callCents: number;
      /** Pot odds as `R : 1`. */
      readonly ratio: number;
      /** Break-even equity, 0–100. */
      readonly needPct: number;
    };
