// @vitest-environment jsdom
/**
 * Two states, one chip, one position. The strings are the contract — they are
 * what a player reads mid-hand without looking away from the felt.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PriceChip, formatNeed, formatRatio, priceLabel } from "./PriceChip";

afterEach(cleanup);

describe("priceLabel", () => {
  it("reads the pot when nothing is owed", () => {
    expect(priceLabel({ kind: "pot", potCents: 1840 })).toBe("Pot $18.40");
  });

  it("reads price, odds and break-even when facing a bet", () => {
    expect(priceLabel({ kind: "call", callCents: 460, ratio: 3.4, needPct: 23 })).toBe(
      "Call $4.60 · 3.4 : 1 · need 23%",
    );
  });

  it("formats odds to one decimal and equity to a whole percent", () => {
    expect(formatRatio(3.44)).toBe("3.4 : 1");
    expect(formatRatio(2)).toBe("2.0 : 1");
    expect(formatNeed(22.6)).toBe("need 23%");
    expect(formatNeed(23)).toBe("need 23%");
  });

  it("refuses impossible odds rather than printing nonsense", () => {
    expect(() => formatRatio(Number.NaN)).toThrow(RangeError);
    expect(() => formatRatio(-1)).toThrow(RangeError);
    expect(() => formatNeed(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe("PriceChip", () => {
  it("renders the pot state", () => {
    render(<PriceChip state={{ kind: "pot", potCents: 1840 }} />);
    expect(screen.getByRole("status").textContent).toBe("Pot $18.40");
  });

  it("renders the call state", () => {
    render(<PriceChip state={{ kind: "call", callCents: 460, ratio: 3.4, needPct: 23 }} />);
    expect(screen.getByRole("status").textContent).toBe("Call $4.60 · 3.4 : 1 · need 23%");
  });

  it("announces politely — the price changes, it does not interrupt", () => {
    render(<PriceChip state={{ kind: "pot", potCents: 1840 }} />);
    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite");
  });

  it("carries tabular numerals so the chip never twitches", () => {
    render(<PriceChip state={{ kind: "pot", potCents: 1840 }} />);
    expect(screen.getByRole("status").className).toContain("fr-num");
  });

  it("stays one chip across a state change", () => {
    const { rerender } = render(<PriceChip state={{ kind: "pot", potCents: 1840 }} />);
    rerender(<PriceChip state={{ kind: "call", callCents: 460, ratio: 3.4, needPct: 23 }} />);
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });
});
