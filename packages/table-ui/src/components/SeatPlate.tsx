/**
 * A seat — avatar disc + name/stack plate (table.html Study 2).
 *
 * The locked scaling rules this component implements:
 *   - plate L / M / S by density (avatar 34 / 26 / 21px)
 *   - 9-max drops villain names — avatar + stack only, name on tap. The name
 *     stays in the accessible name at every density, so the trade-off costs
 *     pixels, never information.
 *   - hero's plate never compresses: always plate M+, with its name
 *   - the earned-read dot is 8px, top-right of the avatar, and never scales or
 *     moves — it is the anchor players learn to find
 *
 * The avatar is the DC2 portrait's placeholder: an initial on the skin's accent
 * gradient. Mood is a rim treatment (characters.html Study 2) — faces never
 * carry the skin accent, rims do — so swapping in real portraits later is a
 * content change, not a layout change.
 */

import type { ReactElement, ReactNode } from "react";
import { formatCents } from "@poker/ui";
import type { SeatMood } from "../beats";
import type { TableDensity } from "./Felt";
import { cx } from "./cx";

export interface SeatPlateProps {
  /** Display name. Always in the accessible name, even when plate S hides it. */
  readonly name: string;
  /** Stack in integer cents. */
  readonly stackCents: number;
  /** Overrides the felt's density for this plate. Default 6 (plate M). */
  readonly density?: TableDensity;
  /** Hero's own seat: plate M+ at every density, name always shown. */
  readonly hero?: boolean;
  /** Out of the hand — the plate dims to 42%. */
  readonly folded?: boolean;
  /** It is this seat's turn: glow ring + the breathing think-pulse. */
  readonly thinking?: boolean;
  /** Tilt state, as the Presenter's mood-shift beat reports it. */
  readonly moodState?: SeatMood;
  /** An earned read is available on this villain. */
  readonly earnedRead?: boolean;
  /** Placeholder portrait glyph. Defaults to the name's first character. */
  readonly avatarInitial?: string;
  /** Compact HUD tag (e.g. `"24 / 19"`) — plate L, Study loadout only. */
  readonly hudTag?: string;
  /** Rendered above the plate: hole cards. */
  readonly children?: ReactNode;
  readonly className?: string;
  readonly id?: string;
}

function initialOf(name: string, override: string | undefined): string {
  if (override !== undefined && override.length > 0) return override;
  const first = Array.from(name.trim())[0];
  return first === undefined ? "?" : first.toUpperCase();
}

export function SeatPlate({
  name,
  stackCents,
  density = 6,
  hero = false,
  folded = false,
  thinking = false,
  moodState = "neutral",
  earnedRead = false,
  avatarInitial,
  hudTag,
  children,
  className,
  id,
}: SeatPlateProps): ReactElement {
  const stack = formatCents(stackCents);
  // Plate S drops villain names; hero never compresses.
  const showName = hero || density !== 9;
  const state = folded ? ", folded" : thinking ? ", to act" : "";

  return (
    <div
      id={id}
      className={cx("fr-seat", className)}
      data-fr="seat-plate"
      data-fr-density={density}
      data-hero={hero ? "true" : undefined}
      data-folded={folded ? "true" : undefined}
      data-thinking={thinking ? "true" : undefined}
      data-mood={moodState}
      role="group"
      aria-label={`${name}, ${stack}${state}`}
    >
      {children}
      <div className="fr-seat__plate">
        {thinking ? <span className="fr-seat__pulse" data-fr="thinking-indicator" aria-hidden="true" /> : null}
        <span className="fr-seat__portrait">
          <span className="fr-seat__avatar" data-fr="avatar" aria-hidden="true">
            {initialOf(name, avatarInitial)}
          </span>
          {earnedRead ? <span className="fr-seat__read-dot" data-fr="earned-read" aria-hidden="true" /> : null}
        </span>
        <span className="fr-seat__who">
          {showName ? (
            <span className="fr-seat__name" data-fr="seat-name" aria-hidden="true">
              {name}
            </span>
          ) : null}
          <span className="fr-seat__stack fr-num" data-fr="seat-stack" aria-hidden="true">
            {stack}
          </span>
        </span>
        {hudTag === undefined ? null : (
          <span className="fr-seat__hud fr-num" data-fr="seat-hud" aria-hidden="true">
            {hudTag}
          </span>
        )}
      </div>
    </div>
  );
}
