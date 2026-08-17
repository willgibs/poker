/**
 * PriceChip — the single ambient price readout (table.html Study 3C, Study 4B).
 *
 * Two states, one component, one position:
 *
 *   not facing a bet →  `Pot $18.40`
 *   facing a bet     →  `Call $4.60 · 3.4 : 1 · need 23%`
 *
 * It is L1 chrome, not rail furniture: when the coach rail is collapsed the
 * chip stays, "so collapsing the rail never means flying blind — it means
 * choosing quiet". It holds its position across every action-bar state.
 *
 * Purely presentational: pot odds and break-even equity are computed upstream
 * (`@poker/equity`), never here.
 */

import { Pill, formatCents } from "@poker/ui";
import type { PriceState } from "./types";

export interface PriceChipProps {
  state: PriceState;
  className?: string;
}

/** `3.4` → `"3.4 : 1"`. One decimal — pot odds are a feel, not an audit. */
export function formatRatio(ratio: number): string {
  if (!Number.isFinite(ratio) || ratio < 0) {
    throw new RangeError(`invalid pot-odds ratio: ${ratio}`);
  }
  return `${ratio.toFixed(1)} : 1`;
}

/** `23.4` → `"need 23%"`. Break-even equity is never shown to a decimal. */
export function formatNeed(needPct: number): string {
  if (!Number.isFinite(needPct)) {
    throw new RangeError(`invalid break-even equity: ${needPct}`);
  }
  return `need ${Math.round(needPct)}%`;
}

export function priceLabel(state: PriceState): string {
  if (state.kind === "pot") return `Pot ${formatCents(state.potCents)}`;
  return [`Call ${formatCents(state.callCents)}`, formatRatio(state.ratio), formatNeed(state.needPct)].join(" · ");
}

export function PriceChip({ state, className }: PriceChipProps) {
  const classes = ["fr-price", className].filter((c): c is string => typeof c === "string" && c.length > 0).join(" ");
  return (
    <Pill numeric live className={classes} leading={<span className="fr-price__mark" aria-hidden="true" />}>
      {priceLabel(state)}
    </Pill>
  );
}
