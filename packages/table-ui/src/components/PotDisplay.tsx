/**
 * The pot — a quiet pill (table.html Study 1).
 *
 * Numbers stay quiet: no gradient, no weight, no colour beyond the plate's own.
 * The amount is tabular so a spinning-counter roll-up never reflows the pill.
 *
 * `placed` (default) positions it on the felt from `--fr-pot-x` / `--fr-pot-y`,
 * which the table layout sets; pass `placed={false}` to drop it inline into a
 * bar or a rail tile.
 */

import type { ReactElement } from "react";
import { formatCents } from "@poker/ui";
import { cx } from "./cx";

export interface PotDisplayProps {
  /** Pot size in integer cents. */
  readonly cents: number;
  /** Leading word. Default `"Pot"`. */
  readonly label?: string;
  /** Absolutely position on the felt via CSS vars. Default `true`. */
  readonly placed?: boolean;
  readonly className?: string;
  readonly id?: string;
}

export function PotDisplay({
  cents,
  label = "Pot",
  placed = true,
  className,
  id,
}: PotDisplayProps): ReactElement {
  const amount = formatCents(cents);

  return (
    <div
      id={id}
      className={cx("fr-pot", placed && "fr-pot--placed", className)}
      data-fr="pot"
      role="status"
      aria-label={`${label} ${amount}`}
    >
      <span className="fr-pot__label" aria-hidden="true">
        {label}
      </span>
      <span className="fr-pot__amount fr-num" data-fr="pot-amount" aria-hidden="true">
        {amount}
      </span>
    </div>
  );
}
