/**
 * CoachLine — the one coach slot (CLAUDE.md design budget: "one coach line +
 * one banter slot").
 *
 * The budget is the whole design. One line, one row, fixed position, fades in
 * and out; it *never* stacks, never scrolls, never grows a second row. When a
 * newer line arrives the older one is gone — latest wins, no queue, no backlog.
 * A coach who is still explaining the flop while you act on the turn is worse
 * than no coach.
 *
 * The slot element is always mounted (it holds its row in the strip whether or
 * not there is anything to say — table.html Study 3: "Coach line and price chip
 * hold their exact positions across every state") and is an `aria-live` region
 * so a new line is announced without stealing focus.
 */

import { motion, useReducedMotion } from "motion/react";
import { flatTransition } from "@poker/ui";

export interface CoachLineProps {
  /** The current line, or `null` for silence. */
  line?: string | null;
  /**
   * Bump to re-play (and re-announce) a line whose text is unchanged — e.g.
   * the same nudge on a later street. Defaults to the text itself.
   */
  lineId?: string | number;
  className?: string;
}

export function CoachLine({ line, lineId, className }: CoachLineProps) {
  const reduced = useReducedMotion() === true;
  const text = line ?? null;
  const classes = ["fr-coach", className].filter((c): c is string => typeof c === "string" && c.length > 0).join(" ");

  return (
    <div className={classes} role="status" aria-live="polite" data-coach-slot data-empty={text === null ? "" : undefined}>
      {text === null ? null : (
        // `key` swap, not <AnimatePresence>: the outgoing line must be gone the
        // frame the new one arrives. Two coach lines in the DOM at once is the
        // budget violation this component exists to make impossible.
        <motion.span
          key={lineId ?? text}
          className="fr-coach__text"
          initial={reduced ? { opacity: 0 } : { opacity: 0, y: 3 }}
          animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
          transition={flatTransition}
        >
          {text}
        </motion.span>
      )}
    </div>
  );
}
