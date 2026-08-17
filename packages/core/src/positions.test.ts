import { describe, expect, it } from "vitest";
import {
  MAX_TABLE_SIZE,
  MIN_TABLE_SIZE,
  positionOf,
  positionsFor,
} from "./positions";

describe("positionsFor", () => {
  it("snapshot: heads-up (button is the small blind, labeled BTN)", () => {
    expect(positionsFor(2)).toEqual(["BTN", "BB"]);
  });

  it("snapshot: 6-max", () => {
    expect(positionsFor(6)).toEqual(["BTN", "SB", "BB", "UTG", "HJ", "CO"]);
  });

  it("snapshot: 9-max", () => {
    expect(positionsFor(9)).toEqual([
      "BTN",
      "SB",
      "BB",
      "UTG",
      "UTG1",
      "UTG2",
      "LJ",
      "HJ",
      "CO",
    ]);
  });

  it("every table size has one unique label per seat, starting at BTN", () => {
    for (let size = MIN_TABLE_SIZE; size <= MAX_TABLE_SIZE; size++) {
      const labels = positionsFor(size);
      expect(labels).toHaveLength(size);
      expect(labels[0]).toBe("BTN");
      expect(new Set(labels).size).toBe(size);
      if (size >= 3) {
        expect(labels[1]).toBe("SB");
        expect(labels[2]).toBe("BB");
      }
      if (size >= 5) {
        expect(labels[size - 1]).toBe("CO"); // seat before the button is the cutoff
      }
    }
  });

  it("rejects invalid table sizes", () => {
    for (const bad of [1, 10, 0, -3, 2.5, NaN]) {
      expect(() => positionsFor(bad), String(bad)).toThrow(RangeError);
    }
  });
});

describe("positionOf", () => {
  it("agrees with positionsFor for every seat", () => {
    for (let size = MIN_TABLE_SIZE; size <= MAX_TABLE_SIZE; size++) {
      const labels = positionsFor(size);
      for (let seat = 0; seat < size; seat++) {
        expect(positionOf(size, seat)).toBe(labels[seat]);
      }
    }
  });

  it("rejects out-of-range seats", () => {
    expect(() => positionOf(6, -1)).toThrow(RangeError);
    expect(() => positionOf(6, 6)).toThrow(RangeError);
    expect(() => positionOf(6, 1.5)).toThrow(RangeError);
    expect(() => positionOf(1, 0)).toThrow(RangeError);
  });
});
