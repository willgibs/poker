/**
 * Pill — the status chip.
 *
 * A hairline capsule carrying one short, quiet fact: a stake level, a loadout
 * name, a street, an off-record marker. Non-interactive by construction — if it
 * needs a press it is a `Button` or a `SizeChip`, not a Pill. Tones map 1:1 to
 * semantic tokens so a skin swap re-colors them for free.
 */

import type { ReactNode } from "react";

export type PillTone = "neutral" | "accent" | "pos" | "neg" | "off-record";

export interface PillProps {
  children: ReactNode;
  tone?: PillTone;
  /** A swatch, dot, or icon before the label. */
  leading?: ReactNode;
  /**
   * The pill carries a formatted chip amount — adds tabular numerals so the
   * capsule never twitches as the number changes.
   */
  numeric?: boolean;
  /** Announce changes politely (live price, live pot). */
  live?: boolean;
  className?: string;
  title?: string;
}

export function Pill({ children, tone = "neutral", leading, numeric = false, live = false, className, title }: PillProps) {
  const classes = ["fr-pill", `fr-pill--${tone}`, numeric ? "fr-num" : null, className]
    .filter((c): c is string => typeof c === "string" && c.length > 0)
    .join(" ");

  return (
    <span
      className={classes}
      data-tone={tone}
      title={title}
      role={live ? "status" : undefined}
      aria-live={live ? "polite" : undefined}
    >
      {leading !== undefined && leading !== null ? <span className="fr-pill__leading">{leading}</span> : null}
      {children}
    </span>
  );
}
