/**
 * The money path: dollars, big blinds, stakes, and the editable-amount
 * round-trip the action bar's type-in depends on.
 */

import { describe, expect, it } from "vitest";

import { formatAmountInput, formatBb, formatCents, formatStakes, parseAmountInput } from "./formatCents";

describe("formatCents", () => {
  it("renders whole and fractional dollars with two decimals", () => {
    expect(formatCents(1840)).toBe("$18.40");
    expect(formatCents(920)).toBe("$9.20");
    expect(formatCents(460)).toBe("$4.60");
    expect(formatCents(0)).toBe("$0.00");
    expect(formatCents(5)).toBe("$0.05");
    expect(formatCents(100)).toBe("$1.00");
  });

  it("groups thousands", () => {
    expect(formatCents(124_000)).toBe("$1,240.00");
    expect(formatCents(123_456_789)).toBe("$1,234,567.89");
    expect(formatCents(99_999)).toBe("$999.99");
    expect(formatCents(124_000, { group: false })).toBe("$1240.00");
  });

  it("signs losses always and wins only on request", () => {
    expect(formatCents(-1840)).toBe("-$18.40");
    expect(formatCents(1840)).toBe("$18.40");
    expect(formatCents(1840, { showPositiveSign: true })).toBe("+$18.40");
    expect(formatCents(0, { showPositiveSign: true })).toBe("$0.00");
  });

  it("can drop the currency mark and the zero cents", () => {
    expect(formatCents(1800, { trimZeroCents: true })).toBe("$18");
    expect(formatCents(1840, { trimZeroCents: true })).toBe("$18.40");
    expect(formatCents(1840, { currency: false })).toBe("18.40");
  });

  it("refuses a fractional cent — that is a chip-math bug upstream", () => {
    expect(() => formatCents(18.4)).toThrow(RangeError);
    expect(() => formatCents(Number.NaN)).toThrow(RangeError);
  });

  it("is locale-independent: one amount, one string, every machine", () => {
    expect(formatCents(1_234_567)).toBe("$12,345.67");
  });
});

describe("formatBb", () => {
  it("renders one decimal", () => {
    expect(formatBb(1840, 25)).toBe("73.6bb");
    expect(formatBb(-500, 25)).toBe("-20.0bb");
    expect(formatBb(0, 25)).toBe("0.0bb");
  });

  it("signs wins when asked (session net)", () => {
    expect(formatBb(1840, 25, { signed: true })).toBe("+73.6bb");
    expect(formatBb(-1840, 25, { signed: true })).toBe("-73.6bb");
    expect(formatBb(0, 25, { signed: true })).toBe("0.0bb");
  });

  it("rejects a non-positive big blind and a fractional cent", () => {
    expect(() => formatBb(100, 0)).toThrow(RangeError);
    expect(() => formatBb(100, -25)).toThrow(RangeError);
    expect(() => formatBb(10.5, 25)).toThrow(RangeError);
  });
});

describe("formatStakes", () => {
  it("renders the blind pair", () => {
    expect(formatStakes(10, 25)).toBe("$0.10/$0.25");
  });
});

describe("formatAmountInput", () => {
  it("is the bare editable form — no currency mark, no grouping", () => {
    expect(formatAmountInput(920)).toBe("9.20");
    expect(formatAmountInput(0)).toBe("0.00");
    expect(formatAmountInput(5)).toBe("0.05");
    expect(formatAmountInput(125_000)).toBe("1250.00");
  });

  it("refuses a fractional or negative amount", () => {
    expect(() => formatAmountInput(9.5)).toThrow(RangeError);
    expect(() => formatAmountInput(-100)).toThrow(RangeError);
  });
});

describe("parseAmountInput", () => {
  it("reads what a player types", () => {
    expect(parseAmountInput("9.20")).toBe(920);
    expect(parseAmountInput("12.5")).toBe(1250);
    expect(parseAmountInput("18")).toBe(1800);
    expect(parseAmountInput("$1,250.00")).toBe(125_000);
    expect(parseAmountInput(" 4.6 ")).toBe(460);
    expect(parseAmountInput("0.05")).toBe(5);
  });

  it("returns null for anything that is not a price", () => {
    expect(parseAmountInput("")).toBeNull();
    expect(parseAmountInput(".")).toBeNull();
    expect(parseAmountInput("abc")).toBeNull();
    expect(parseAmountInput("1.234")).toBeNull(); // sub-cent precision is a bug
    expect(parseAmountInput("-5")).toBeNull();
  });

  it("round-trips with formatAmountInput", () => {
    for (const cents of [0, 5, 99, 100, 920, 4255, 125_000]) {
      expect(parseAmountInput(formatAmountInput(cents))).toBe(cents);
    }
  });
});
