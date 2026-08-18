/**
 * The felt's fixed anchors.
 *
 * These numbers are a design decision, not an implementation detail: the read
 * dot, the button and the bet line "stay in the same relative spots at every
 * density" (table.html Study 2) is the promise density scaling makes, and it is
 * only true if the ring below is the one the design study drew.
 */

import { describe, expect, it } from "vitest";
import type { TableDensity } from "../components";
import {
  BET_AXIS_FRACTION,
  BOARD_ANCHOR,
  POT_ANCHOR,
  SEAT_SLOTS,
  anchorTransform,
  betAnchor,
  dealerAnchor,
  seatSlot,
  slotClass,
} from "./geometry";

const DENSITIES: readonly TableDensity[] = [2, 6, 9];

describe("seat rings", () => {
  it("has exactly one slot per seat at every density", () => {
    for (const density of DENSITIES) {
      expect(SEAT_SLOTS[density]).toHaveLength(density);
    }
  });

  it("puts the hero in slot 0, bottom centre, at every density", () => {
    for (const density of DENSITIES) {
      expect(seatSlot(density, 0)).toEqual({ x: 50, y: 80 });
    }
  });

  it("keeps every seat inside the felt", () => {
    for (const density of DENSITIES) {
      for (const point of SEAT_SLOTS[density]) {
        expect(point.x).toBeGreaterThanOrEqual(0);
        expect(point.x).toBeLessThanOrEqual(100);
        expect(point.y).toBeGreaterThanOrEqual(0);
        expect(point.y).toBeLessThanOrEqual(100);
      }
    }
  });

  it("never seats two players in the same chair", () => {
    for (const density of DENSITIES) {
      const keys = SEAT_SLOTS[density].map((p) => `${String(p.x)},${String(p.y)}`);
      expect(new Set(keys).size).toBe(density);
    }
  });

  it("wraps rather than throwing when a view-model overflows its density", () => {
    expect(seatSlot(6, 6)).toEqual(seatSlot(6, 0));
    expect(seatSlot(6, -1)).toEqual(seatSlot(6, 5));
  });
});

describe("derived anchors", () => {
  it("puts bet chips 35% of the way from the seat to the pot", () => {
    for (const density of DENSITIES) {
      for (const seat of SEAT_SLOTS[density]) {
        const bet = betAnchor(seat);
        expect(bet.x).toBeCloseTo(seat.x + (POT_ANCHOR.x - seat.x) * BET_AXIS_FRACTION, 6);
        expect(bet.y).toBeCloseTo(seat.y + (POT_ANCHOR.y - seat.y) * BET_AXIS_FRACTION, 6);
      }
    }
  });

  it("keeps the bet nearer the seat than the pot — the axis reads one way", () => {
    for (const seat of SEAT_SLOTS[9]) {
      const bet = betAnchor(seat);
      const toSeat = Math.hypot(bet.x - seat.x, bet.y - seat.y);
      const toPot = Math.hypot(bet.x - POT_ANCHOR.x, bet.y - POT_ANCHOR.y);
      expect(toSeat).toBeLessThan(toPot);
    }
  });

  it("sets the button felt-side of the plate, never on top of it", () => {
    for (const density of DENSITIES) {
      for (const seat of SEAT_SLOTS[density]) {
        const button = dealerAnchor(seat);
        const offset = Math.hypot(button.x - seat.x, button.y - seat.y);
        expect(offset).toBeGreaterThan(3);
        // …and always closer to the seat than the bet chips are.
        const bet = betAnchor(seat);
        expect(offset).toBeLessThan(Math.hypot(bet.x - seat.x, bet.y - seat.y) + 1e-9);
      }
    }
  });

  it("reproduces the study's own placements for the 6-max scene", () => {
    // table.html Study 2, 6-max: Silas on the right rail, button felt-side.
    const silas = seatSlot(6, 5);
    expect(silas).toEqual({ x: 92, y: 55 });
    expect(dealerAnchor(silas)).toEqual({ x: 84.63, y: 50.97 });
    // Rocco's chair at the top, his $4.60 on the axis toward the pot.
    expect(betAnchor(seatSlot(6, 3))).toEqual({ x: 50, y: 26.1 });
  });
});

describe("travel", () => {
  it("emits interpolable transform strings — same shape, different numbers", () => {
    const from = anchorTransform(BOARD_ANCHOR);
    const to = anchorTransform(seatSlot(6, 2));
    const shape = (s: string): string => s.replace(/-?\d+(\.\d+)?/g, "#");
    expect(shape(from)).toBe(shape(to));
    expect(from).not.toBe(to);
  });

  it("centres on the anchor and measures it against the felt", () => {
    expect(anchorTransform({ x: 8, y: 55 })).toBe("translate(-50%, -50%) translate(8cqw, 55cqh)");
  });
});

describe("slot classes", () => {
  it("names one class per slot, and nothing else", () => {
    expect(slotClass(0)).toBe("fr-stage-slot-0");
    expect(slotClass(8)).toBe("fr-stage-slot-8");
  });
});
