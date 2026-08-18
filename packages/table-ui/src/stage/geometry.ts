/**
 * Table geometry — the open-plan seat coordinates, as data.
 *
 * Normative source: `poker-internal/design/explorations/table.html` Study 1C
 * (the adopted open-plan felt) and Study 2 (the density ladder). There is no
 * rail and no table object, so containment comes entirely from these fixed
 * anchors: the seat ring, the board, the pot, the bet axis and the button.
 * That is why density scaling is pure geometry — nothing here is measured from
 * the DOM, and nothing is ever computed at runtime from an element box.
 *
 * Units are **percent of the felt box**, unitless. Two consumers read them:
 *
 *   - `stage.css`, which places the resting elements (one `--fr-slot-x/y` pair
 *     per slot, everything else derived in `calc()`); `stageCss.test.ts` proves
 *     the stylesheet's numbers are exactly the numbers below.
 *   - `TableStage.tsx`, which animates the *travelling* elements between two
 *     anchors. Travel is expressed in container units (`cqw` / `cqh`) against
 *     the stage scene, so a flight is the same fraction of the felt at every
 *     viewport — and `transform` strings interpolate cleanly, which `x`/`y`
 *     shorthands would not (beats.md law #4: transform + opacity only).
 *
 * Slot 0 is always the hero, bottom centre. Slots ascend **clockwise** from
 * there — hero → left → top → right — matching the seat order table.html
 * lays out at every density.
 */

import type { TableDensity } from "../components";

/** A point on the felt, in percent of the felt box. */
export interface StagePoint {
  readonly x: number;
  readonly y: number;
}

/** The pot pill's centre (table.html: `left:50%; top:56%`). */
export const POT_ANCHOR: StagePoint = { x: 50, y: 56 };

/** The board's centre (table.html: `left:50%; top:39%`). */
export const BOARD_ANCHOR: StagePoint = { x: 50, y: 39 };

/** Where cards and chips come from and return to: the dealer's position. */
export const DEALER_ORIGIN: StagePoint = BOARD_ANCHOR;

/**
 * Seat rings, per density, in slot order. Transcribed from table.html — these
 * are hand-placed by the design study, not generated from an ellipse, because
 * the open plan has no rim to sit on.
 */
export const SEAT_SLOTS: Readonly<Record<TableDensity, readonly StagePoint[]>> = {
  2: [
    { x: 50, y: 80 },
    { x: 50, y: 11 },
  ],
  6: [
    { x: 50, y: 80 },
    { x: 8, y: 55 },
    { x: 23, y: 14 },
    { x: 50, y: 10 },
    { x: 77, y: 14 },
    { x: 92, y: 55 },
  ],
  9: [
    { x: 50, y: 80 },
    { x: 13, y: 72 },
    { x: 4, y: 42 },
    { x: 16, y: 13 },
    { x: 38, y: 7 },
    { x: 63, y: 7 },
    { x: 85, y: 13 },
    { x: 96, y: 42 },
    { x: 87, y: 72 },
  ],
} as const;

/** Bet chips sit on the seat → pot axis at 35% of the distance (Study 2). */
export const BET_AXIS_FRACTION = 0.35;

/** The button sits this far along the seat → pot axis before it is rotated. */
export const DEALER_AXIS_FRACTION = 0.2;

/** …and this far around it: "felt-side of the plate, ~30° toward the pot". */
export const DEALER_AXIS_DEGREES = 30;

const DEALER_COS = Math.cos((DEALER_AXIS_DEGREES * Math.PI) / 180);
const DEALER_SIN = Math.sin((DEALER_AXIS_DEGREES * Math.PI) / 180);

/** Two decimals: enough for a percentage, few enough to write into CSS. */
export function roundPct(value: number): number {
  return Math.round(value * 100) / 100;
}

/** The seat ring for a density. */
export function seatSlots(density: TableDensity): readonly StagePoint[] {
  return SEAT_SLOTS[density];
}

/**
 * The slot a seat index occupies. Indexes past the ring wrap, so a view-model
 * with more seats than the density admits still renders somewhere sane rather
 * than throwing at paint time.
 */
export function seatSlot(density: TableDensity, index: number): StagePoint {
  const ring = SEAT_SLOTS[density];
  const point = ring[((index % ring.length) + ring.length) % ring.length];
  // `noUncheckedIndexedAccess`: the modulo above guarantees a hit, but the
  // compiler cannot see it, and a renderer never throws.
  return point ?? POT_ANCHOR;
}

/** Where this seat's live bet rests. */
export function betAnchor(seat: StagePoint): StagePoint {
  return {
    x: roundPct(seat.x + (POT_ANCHOR.x - seat.x) * BET_AXIS_FRACTION),
    y: roundPct(seat.y + (POT_ANCHOR.y - seat.y) * BET_AXIS_FRACTION),
  };
}

/** Where this seat's dealer button rests when it holds the button. */
export function dealerAnchor(seat: StagePoint): StagePoint {
  const dx = POT_ANCHOR.x - seat.x;
  const dy = POT_ANCHOR.y - seat.y;
  return {
    x: roundPct(seat.x + (dx * DEALER_COS - dy * DEALER_SIN) * DEALER_AXIS_FRACTION),
    y: roundPct(seat.y + (dx * DEALER_SIN + dy * DEALER_COS) * DEALER_AXIS_FRACTION),
  };
}

/**
 * A point as a `transform` string, in stage-container units.
 *
 * `translate(-50%, -50%)` centres the element on the anchor (its own box);
 * the second translate is the anchor itself, in `cqw`/`cqh` against the stage
 * scene's size container. Both halves are present in every string this module
 * emits, so two of them always interpolate — `motion` matches structure, then
 * tweens the numbers.
 */
export function anchorTransform(point: StagePoint): string {
  return `translate(-50%, -50%) translate(${roundPct(point.x)}cqw, ${roundPct(point.y)}cqh)`;
}

/** The per-slot class the stylesheet hangs `--fr-slot-x/y` off. */
export function slotClass(slot: number): string {
  return `fr-stage-slot-${slot}`;
}
