/**
 * The bridge between the layer-1 motion tables and what `motion/react` accepts.
 *
 * `primitives.ts` stores easings as CSS strings (`cubic-bezier(…)`, `ease-out`)
 * because that is what a stylesheet needs. `motion/react` wants a 4-tuple or one
 * of its own names. This module *derives* the motion form from the same token —
 * it never writes down a second copy of a curve or a duration, so renaming or
 * retuning a token in `primitives.ts` moves the springs and the CSS together.
 *
 * Nothing here is a new value except `PRESS_SCALE`, which is beats.md §4.15's
 * `scale(0.97)` press — a motion constant with no CSS twin, and `packages/ui`
 * is the layer allowed to write it down.
 */

import { durationMs, easing, spring } from "../tokens/primitives";
import type { SpringName } from "../tokens/primitives";

/** What `motion/react` accepts for `transition.ease`. */
export type MotionEase = readonly [number, number, number, number] | "easeOut" | "easeInOut" | "linear";

const NAMED_EASE: Readonly<Record<string, MotionEase>> = {
  "ease-out": "easeOut",
  "ease-in-out": "easeInOut",
  linear: "linear",
};

/**
 * `"cubic-bezier(0.22, 1, 0.36, 1)"` → `[0.22, 1, 0.36, 1]`;
 * `"ease-out"` → `"easeOut"`. Throws on anything the token table cannot
 * produce, so a malformed easing token fails loudly at import time.
 */
export function easeToMotion(token: string): MotionEase {
  const named = NAMED_EASE[token];
  if (named !== undefined) return named;

  const match = /^cubic-bezier\(([^)]+)\)$/.exec(token.trim());
  if (match !== null) {
    const raw = match[1];
    if (raw !== undefined) {
      const parts = raw.split(",").map((p) => Number(p.trim()));
      if (parts.length === 4 && parts.every((n) => Number.isFinite(n))) {
        const [a, b, c, d] = parts as [number, number, number, number];
        return [a, b, c, d];
      }
    }
  }
  throw new RangeError(`easing token is not expressible as a motion ease: ${token}`);
}

/** A spring token as `motion/react` physics. */
export function springToMotion(name: SpringName): {
  type: "spring";
  stiffness: number;
  damping: number;
  mass: number;
} {
  const s = spring[name];
  return { type: "spring", stiffness: s.stiffness, damping: s.damping, mass: s.mass };
}

/** A flat-beat duration token in seconds (motion counts in seconds, CSS in ms). */
export function seconds(ms: number): number {
  return ms / 1000;
}

/** beats.md §4.15 — the hero press. Kept under reduce-motion: it is feedback, not travel. */
export const PRESS_SCALE = 0.97;

/** The press transition: `--duration-micro`, `--ease-out`. */
export const pressTransition = {
  duration: seconds(durationMs.micro),
  ease: easeToMotion(easing.out),
} as const;

/** The flat entrance/exit: `--duration-quick`, `--ease-smooth-out`. */
export const flatTransition = {
  duration: seconds(durationMs.quick),
  ease: easeToMotion(easing.smoothOut),
} as const;

/** The reduce-motion substitute for any spring: a fade at `--duration-quick`. */
export const reducedTransition = {
  duration: seconds(durationMs.quick),
  ease: easeToMotion(easing.smoothOut),
} as const;
