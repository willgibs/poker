/**
 * SizeChip — the bet-sizing preset (table.html Study 3B).
 *
 * Two lines in one target: the *size* (`33%`, `Pot`, `All-in`) over the *money*
 * it means at this pot. The money line is why the chip exists — the player
 * chooses in fractions and pays in dollars, and making them hold both in their
 * head is the tax this component removes.
 *
 * `suggested` floats a tiny tag above the chip and is pre-selected when the bar
 * expands, so the fast path stays two taps: Bet → Bet $9.20.
 *
 * A toggle, so `aria-pressed` — not a radio. The bar owns "exactly one
 * selected"; the chip only reports its own state.
 */

import { motion, useReducedMotion } from "motion/react";
import type { ReactNode, Ref } from "react";
import { PRESS_SCALE, pressTransition } from "./motionTokens";

export interface SizeChipProps {
  /** The size itself: `"33%"`, `"Pot"`, `"All-in"`. */
  label: string;
  /** The money it means, already through `formatCents`. */
  sublabel?: string;
  selected?: boolean;
  /** Pre-highlighted as the read the coach would take. */
  suggested?: boolean;
  disabled?: boolean;
  /** A `<Kbd>` glyph for the number key that picks this chip. */
  hint?: ReactNode;
  onSelect?: () => void;
  className?: string;
  id?: string;
  ref?: Ref<HTMLButtonElement>;
}

export function SizeChip({
  label,
  sublabel,
  selected = false,
  suggested = false,
  disabled = false,
  hint,
  onSelect,
  className,
  id,
  ref,
}: SizeChipProps) {
  const reduced = useReducedMotion();
  const classes = [
    "fr-sizechip",
    selected ? "fr-sizechip--on" : null,
    suggested ? "fr-sizechip--suggested" : null,
    className,
  ]
    .filter((c): c is string => typeof c === "string" && c.length > 0)
    .join(" ");

  return (
    <motion.button
      ref={ref}
      id={id}
      type="button"
      className={classes}
      disabled={disabled}
      aria-pressed={selected}
      data-selected={selected ? "" : undefined}
      data-suggested={suggested ? "" : undefined}
      onClick={onSelect}
      whileTap={disabled ? undefined : { scale: PRESS_SCALE }}
      transition={pressTransition}
      data-reduced-motion={reduced === true ? "" : undefined}
    >
      {suggested ? <span className="fr-sizechip__tag">suggested</span> : null}
      <span className="fr-sizechip__label fr-num">{label}</span>
      {sublabel !== undefined ? <span className="fr-sizechip__sub fr-num">{sublabel}</span> : null}
      {hint !== undefined && hint !== null ? <span className="fr-sizechip__hint">{hint}</span> : null}
    </motion.button>
  );
}
