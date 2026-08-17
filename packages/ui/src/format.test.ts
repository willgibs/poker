import { describe, expect, it } from "vitest";

import { formatCents } from "./format";

describe("formatCents", () => {
  it("formats zero", () => {
    expect(formatCents(0)).toBe("$0.00");
  });

  it("pads single-digit cents", () => {
    expect(formatCents(10)).toBe("$0.10");
    expect(formatCents(5)).toBe("$0.05");
  });

  it("formats whole dollars", () => {
    expect(formatCents(2500)).toBe("$25.00");
  });

  it("groups thousands", () => {
    expect(formatCents(125_000)).toBe("$1,250.00");
  });

  it("uses a true minus sign for negative amounts", () => {
    expect(formatCents(-620)).toBe("−$6.20");
  });

  it("omits the sign for positive amounts by default", () => {
    expect(formatCents(2110)).toBe("$21.10");
  });

  it("adds a plus sign for positive amounts when requested", () => {
    expect(formatCents(2110, { showPositiveSign: true })).toBe("+$21.10");
  });

  it("does not add a plus sign for zero even when requested", () => {
    expect(formatCents(0, { showPositiveSign: true })).toBe("$0.00");
  });

  it("throws on fractional cents", () => {
    expect(() => formatCents(10.5)).toThrow(TypeError);
  });

  it("throws on non-finite input", () => {
    expect(() => formatCents(Number.NaN)).toThrow(TypeError);
    expect(() => formatCents(Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });
});
