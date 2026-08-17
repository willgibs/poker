/**
 * KeyMapOverlay — the map you hold, not the settings page you memorise
 * (table.html Study 3C).
 *
 * Held while `?` is down, gone the moment it is released. It is a legend, not
 * a dialog: no focus trap, no dismiss button, nothing to escape from — holding
 * a key cannot strand anyone. It also never appears mid-hand as a popup the
 * player did not ask for, which keeps it clear of the "no popups/modals
 * mid-hand" budget.
 *
 * Rows are the map, in the order the hand is played.
 */

import { Kbd } from "@poker/ui";
import { motion, useReducedMotion } from "motion/react";
import { flatTransition } from "@poker/ui";
import type { ReactNode } from "react";

interface KeyRow {
  readonly keys: readonly string[];
  readonly what: string;
  /** Rendered between the caps, e.g. `"–"` for a range. */
  readonly join?: string;
}

/** The map, single source of truth for both the overlay and the button hints. */
export const KEY_MAP: readonly KeyRow[] = [
  { keys: ["F"], what: "fold" },
  { keys: ["C"], what: "check or call" },
  { keys: ["B"], what: "bet or raise" },
  { keys: ["1", "5"], what: "sizes", join: "–" },
  { keys: ["←", "→"], what: "nudge by big blind" },
  { keys: ["⏎"], what: "commit" },
  { keys: ["⎋"], what: "back" },
  { keys: ["?"], what: "hold for this map" },
];

export interface KeyMapOverlayProps {
  open: boolean;
  className?: string;
}

export function KeyMapOverlay({ open, className }: KeyMapOverlayProps) {
  const reduced = useReducedMotion() === true;
  if (!open) return null;

  const classes = ["fr-keymap", className].filter((c): c is string => typeof c === "string" && c.length > 0).join(" ");

  return (
    <motion.div
      className={classes}
      data-keymap
      role="note"
      aria-label="Keyboard map"
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 4 }}
      animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
      transition={flatTransition}
    >
      {KEY_MAP.map((row) => (
        <span className="fr-keymap__row" key={row.what}>
          {joinKeys(row)}
          <span className="fr-keymap__what">{row.what}</span>
        </span>
      ))}
    </motion.div>
  );
}

function joinKeys(row: KeyRow): ReactNode {
  const caps: ReactNode[] = [];
  row.keys.forEach((key, index) => {
    if (index > 0 && row.join !== undefined) {
      caps.push(
        <span className="fr-keymap__join" key={`join-${key}`}>
          {row.join}
        </span>,
      );
    }
    caps.push(
      <Kbd decorative={false} key={key}>
        {key}
      </Kbd>,
    );
  });
  return caps;
}
