/**
 * `Button` — the one system component for in-page actions.
 *
 * Raw `<button>` is banned outside `packages/ui` (`local/no-raw-interactive-elements`);
 * this is the sanctioned source. `variant="primary"` carries the gradient —
 * the design budget is "exactly one gradient CTA per screen" (see
 * docs/design-system.md / the DC4 menu study), so callers, not this
 * component, are responsible for that count.
 *
 * `hint` renders a small trailing glyph (typically a `<Kbd>`) without
 * polluting the accessible name — pair it with `aria-keyshortcuts` (see
 * `packages/table-ui/src/hero/ActionBar.tsx`, its real-world consumer).
 *
 * Styles live in the shared `components.css` (`.fr-btn` + `.fr-btn--*`
 * modifiers) — pulled once by the app, next to the tokens:
 *
 *   import "@poker/ui/tokens.css";
 *   import "@poker/ui/components.css";
 *
 * Motion: the shared press feedback (`PRESS_SCALE` / `pressTransition`,
 * beats.md §4.15) via `motion/react`'s `whileTap`, skipped entirely under
 * `prefers-reduced-motion`.
 */
import { motion, useReducedMotion } from "motion/react";
import type { ButtonHTMLAttributes, ReactNode, Ref } from "react";

import { PRESS_SCALE, pressTransition } from "./motionTokens";

export type ButtonVariant = "primary" | "ghost" | "quiet";
export type ButtonSize = "sm" | "md" | "lg";

/**
 * `motion.button` replaces a handful of native handlers (`onDrag`,
 * `onDragStart`, `onDragEnd`, `onAnimationStart`, `onAnimationEnd`,
 * `onAnimationIteration`) with its own gesture/animation-aware signatures —
 * omit them from the native attribute set so spreading `rest` onto
 * `motion.button` type-checks. Nothing in this app drags or CSS-animates a
 * button, so the native versions were never reachable anyway.
 */
type MotionButtonConflicts =
  | "onDrag"
  | "onDragStart"
  | "onDragEnd"
  | "onAnimationStart"
  | "onAnimationEnd"
  | "onAnimationIteration";

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className" | "color" | MotionButtonConflicts> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  /** A trailing key-hint glyph, e.g. `<Kbd>F</Kbd>` — excluded from the accessible name. */
  readonly hint?: ReactNode;
  readonly children: ReactNode;
  readonly ref?: Ref<HTMLButtonElement>;
}

export function Button({
  variant = "ghost",
  size = "md",
  type = "button",
  disabled = false,
  hint,
  children,
  ref,
  ...rest
}: ButtonProps) {
  const reduceMotion = useReducedMotion();
  const classes = ["fr-btn", `fr-btn--${variant}`, size === "md" ? null : `fr-btn--${size}`]
    .filter((c): c is string => typeof c === "string")
    .join(" ");

  return (
    <motion.button
      {...rest}
      ref={ref}
      type={type}
      disabled={disabled}
      className={classes}
      data-variant={variant}
      data-size={size}
      whileTap={disabled || reduceMotion === true ? undefined : { scale: PRESS_SCALE }}
      transition={pressTransition}
    >
      <span className="fr-btn__label">{children}</span>
      {hint !== undefined && hint !== null ? <span className="fr-btn__hint">{hint}</span> : null}
    </motion.button>
  );
}
