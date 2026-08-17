/**
 * A seat's live bet: chip disc + amount, sitting on the seat → pot axis at 35%
 * of the distance (table.html Study 2, a locked anchor).
 *
 * The axis is geometry the table layout owns, so placement arrives as CSS
 * variables (`--fr-bet-x` / `--fr-bet-y`) rather than props — the component
 * never computes a position and never writes an inline style.
 *
 * Chips shrink with the density and the tier; the amount label never does.
 */

import type { ReactElement } from "react";
import { formatCents } from "@poker/ui";
import type { ChipTier } from "../beats";
import { cx } from "./cx";

export interface BetChipsProps {
  /** Amount on the felt in front of the seat, integer cents. */
  readonly cents: number;
  /** Stack tier by bet:pot ratio — the same 1–4 the chip ladder uses. */
  readonly tier?: ChipTier;
  /** Absolutely position on the seat → pot axis via CSS vars. Default `true`. */
  readonly placed?: boolean;
  /** Accessible name. Defaults to `"bet $4.60"`. */
  readonly label?: string;
  readonly className?: string;
  readonly id?: string;
}

export function BetChips({
  cents,
  tier = 2,
  placed = true,
  label,
  className,
  id,
}: BetChipsProps): ReactElement {
  const amount = formatCents(cents);

  return (
    <div
      id={id}
      className={cx("fr-bet", placed && "fr-bet--placed", className)}
      data-fr="bet-chips"
      data-tier={tier}
      role="group"
      aria-label={label ?? `bet ${amount}`}
    >
      <span className="fr-bet__chip" data-fr="chip-disc" aria-hidden="true" />
      <span className="fr-bet__amount fr-num" data-fr="bet-amount" aria-hidden="true">
        {amount}
      </span>
    </div>
  );
}
