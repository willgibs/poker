/**
 * Kbd — a key cap.
 *
 * The keyboard is a first-class way to play (table.html Study 3C: "Full
 * keyboard play is an a11y commitment, not a power feature"), so the key map
 * is drawn, not documented. One glyph per cap; the cap is decorative chrome and
 * is hidden from assistive tech when it sits inside a control that already
 * announces its own shortcut.
 */

import type { ReactNode } from "react";

export interface KbdProps {
  children: ReactNode;
  /**
   * Hide from the accessibility tree. Default `true` — inside a Button the cap
   * duplicates the control's own `aria-keyshortcuts`, and a screen reader
   * reading "Fold F" is noise. Set `false` in a standalone legend.
   */
  decorative?: boolean;
  className?: string;
}

export function Kbd({ children, decorative = true, className }: KbdProps) {
  const classes = ["fr-kbd", className].filter((c): c is string => typeof c === "string" && c.length > 0).join(" ");
  return (
    <kbd className={classes} aria-hidden={decorative ? true : undefined}>
      {children}
    </kbd>
  );
}
