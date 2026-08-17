/**
 * TableHeader — four slots, and the fourth one is the door.
 *
 * "Table header ≤ 4 slots" is product law (CLAUDE.md design budgets), and
 * docs/design-system.md names this component as the place the budget finally
 * gets a test: `HEADER_SLOTS.length <= HEADER_SLOT_BUDGET`, asserted in
 * `TableHeader.test.tsx`. The cap is structural — the slot list is a `const`
 * tuple and the component renders exactly it, so a fifth thing cannot arrive by
 * accident, only by a deliberate edit that breaks a test.
 *
 * The four:
 *   1. identity   — stakes · session net (toggles bb/$) · hands played
 *   2. loadout    — the popover trigger (placeholder this wave)
 *   3. contextual — whatever this screen needs; often nothing
 *   4. exit       — always last, always present
 *
 * The contextual slot is deliberately the only open one. Anything that wants to
 * live in the header competes for that one seat.
 */

import { Button, formatBb, formatCents } from "@poker/ui";
import type { ReactNode } from "react";

/** The header's whole vocabulary. Exported so the budget can be asserted. */
export const HEADER_SLOTS = ["identity", "loadout", "contextual", "exit"] as const;
export type HeaderSlot = (typeof HEADER_SLOTS)[number];

/** CLAUDE.md: table header ≤ 4 slots. */
export const HEADER_SLOT_BUDGET = 4;

export type NetUnit = "usd" | "bb";

export interface TableHeaderProps {
  /** Pre-formatted stake pair, e.g. `"$0.10/$0.25"` (`formatStakes`). */
  stakes: string;
  /** Session net in integer cents; negative is a loss. */
  netCents: number;
  /** Big blind in cents — the divisor for the bb view. */
  bigBlindCents: number;
  netUnit?: NetUnit;
  onToggleNetUnit?: () => void;
  handsPlayed: number;

  /** Name of the active loadout ("Guided", "Study", "Immersive"). */
  loadoutName: string;
  onOpenLoadout?: () => void;

  /** Slot 3. The only open seat in the header. */
  contextual?: ReactNode;

  onExit?: () => void;
  exitLabel?: string;
  className?: string;
}

export function TableHeader({
  stakes,
  netCents,
  bigBlindCents,
  netUnit = "usd",
  onToggleNetUnit,
  handsPlayed,
  loadoutName,
  onOpenLoadout,
  contextual,
  onExit,
  exitLabel = "Exit",
  className,
}: TableHeaderProps) {
  const classes = ["fr-hdr", className].filter((c): c is string => typeof c === "string" && c.length > 0).join(" ");

  const netText =
    netUnit === "bb"
      ? formatBb(netCents, bigBlindCents, { signed: true })
      : formatCents(netCents, { showPositiveSign: true });
  const nextUnit = netUnit === "bb" ? "dollars" : "big blinds";
  const sign = netCents > 0 ? "pos" : netCents < 0 ? "neg" : "flat";
  const hands = `${handsPlayed} ${handsPlayed === 1 ? "hand" : "hands"}`;

  return (
    <header className={classes} data-hdr>
      {/* 1 — identity */}
      <div className="fr-hdr__slot fr-hdr__slot--identity" data-header-slot="identity">
        <span className="fr-hdr__stakes fr-num">{stakes}</span>
        <span className="fr-hdr__sep" aria-hidden="true">
          ·
        </span>
        <span className="fr-hdr__net" data-sign={sign}>
          <Button
            variant="quiet"
            size="sm"
            onClick={onToggleNetUnit}
            aria-label={`Session net ${netText}. Show in ${nextUnit}.`}
          >
            <span className="fr-num">{netText}</span>
          </Button>
        </span>
        <span className="fr-hdr__sep" aria-hidden="true">
          ·
        </span>
        <span className="fr-hdr__hands fr-num">{hands}</span>
      </div>

      {/* 2 — loadout */}
      <div className="fr-hdr__slot fr-hdr__slot--loadout" data-header-slot="loadout">
        <Button variant="ghost" size="sm" onClick={onOpenLoadout} aria-haspopup="dialog" aria-expanded={false}>
          {loadoutName}
        </Button>
      </div>

      {/* 3 — contextual: the header's one open seat */}
      <div className="fr-hdr__slot fr-hdr__slot--contextual" data-header-slot="contextual">
        {contextual ?? null}
      </div>

      {/* 4 — exit */}
      <div className="fr-hdr__slot fr-hdr__slot--exit" data-header-slot="exit">
        <Button variant="quiet" size="sm" onClick={onExit}>
          {exitLabel}
        </Button>
      </div>
    </header>
  );
}
