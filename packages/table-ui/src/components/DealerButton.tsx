/**
 * The dealer button — a 16px disc, felt-side of the plate, ~30° toward the pot
 * (table.html Study 2). Fixed size at every density: like the read dot, it is
 * an anchor the player has already learned to find.
 *
 * Placement comes from `--fr-dealer-x` / `--fr-dealer-y`, set by the table
 * layout.
 */

import type { ReactElement } from "react";
import { cx } from "./cx";

export interface DealerButtonProps {
  /** Absolutely position on the felt via CSS vars. Default `true`. */
  readonly placed?: boolean;
  /** Accessible name. Defaults to `"dealer button"`. */
  readonly label?: string;
  readonly className?: string;
  readonly id?: string;
}

export function DealerButton({
  placed = true,
  label = "dealer button",
  className,
  id,
}: DealerButtonProps): ReactElement {
  return (
    <span
      id={id}
      className={cx("fr-dealer", placed && "fr-dealer--placed", className)}
      data-fr="dealer-button"
      role="img"
      aria-label={label}
    >
      <span aria-hidden="true">D</span>
    </span>
  );
}
