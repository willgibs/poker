/**
 * The felt — open plan (table.html Study 1C, the adopted default identity).
 *
 * There is no rail and no table object: a warm radial glow pools in the middle
 * of the near-black canvas and the seats project into it. Containment comes
 * from the fixed anchors (read dot, dealer button, bet axis), not from a rim,
 * which is why density scaling is pure geometry.
 *
 * `density` sets the scale variables the seat plates read (plate L / M / S);
 * a plate with no density of its own inherits the felt's.
 */

import type { ReactElement, ReactNode } from "react";
import { cx } from "./cx";

/** Seats at the table: heads-up, the home density, or full ring. */
export type TableDensity = 2 | 6 | 9;

export interface FeltProps {
  /** 2 → plate L · 6 → plate M (default) · 9 → plate S. */
  readonly density?: TableDensity;
  /** Seats, board, pot, chips and markers — anything that lives on the felt. */
  readonly children?: ReactNode;
  /** Accessible name; supplied, the felt becomes a labelled group. */
  readonly label?: string;
  readonly className?: string;
  readonly id?: string;
}

export function Felt({ density = 6, children, label, className, id }: FeltProps): ReactElement {
  return (
    <div
      id={id}
      className={cx("fr-felt", className)}
      data-fr="felt"
      data-fr-density={density}
      role={label === undefined ? undefined : "group"}
      aria-label={label}
    >
      <div className="fr-felt__glow" aria-hidden="true" />
      <div className="fr-felt__scene" data-fr="felt-scene">
        {children}
      </div>
    </div>
  );
}
