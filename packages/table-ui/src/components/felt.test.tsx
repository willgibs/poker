// @vitest-environment jsdom
/** Felt, pot, bet chips, dealer button — the open-plan furniture. */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Felt } from "./Felt";
import type { TableDensity } from "./Felt";
import { BetChips } from "./BetChips";
import { DealerButton } from "./DealerButton";
import { PotDisplay } from "./PotDisplay";
import { SeatPlate } from "./SeatPlate";

afterEach(cleanup);

function query(fr: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-fr="${fr}"]`);
}

describe("Felt — open plan", () => {
  it("pools a glow on the canvas instead of drawing a rail", () => {
    const { container } = render(<Felt />);
    expect(query("felt")?.querySelector(".fr-felt__glow")).toBeTruthy();
    expect(container.querySelector(".fr-rail")).toBeNull();
  });

  it("keeps the glow out of the accessibility tree", () => {
    render(<Felt />);
    expect(query("felt")?.querySelector(".fr-felt__glow")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("defaults to the home density", () => {
    render(<Felt />);
    expect(query("felt")?.getAttribute("data-fr-density")).toBe("6");
  });

  it("carries 2 / 6 / 9 as the scale variable hook", () => {
    for (const density of [2, 6, 9] as readonly TableDensity[]) {
      const { unmount } = render(<Felt density={density} />);
      expect(query("felt")?.getAttribute("data-fr-density")).toBe(String(density));
      unmount();
    }
  });

  it("projects its children into the scene", () => {
    render(
      <Felt density={9}>
        <SeatPlate name="Hank" stackCents={2740} density={9} />
      </Felt>,
    );
    expect(query("felt-scene")?.querySelector('[data-fr="seat-plate"]')).toBeTruthy();
  });

  it("is an unnamed container until it is given a label", () => {
    const { unmount } = render(<Felt />);
    expect(query("felt")?.getAttribute("role")).toBeNull();
    unmount();

    render(<Felt label="six-max table" />);
    expect(screen.getByRole("group", { name: "six-max table" })).toBeTruthy();
  });
});

describe("PotDisplay", () => {
  it("reads the pot out quietly, tabular", () => {
    render(<PotDisplay cents={1840} />);
    const amount = screen.getByRole("status", { name: "Pot $18.40" }).querySelector('[data-fr="pot-amount"]');
    expect(amount?.textContent).toBe("$18.40");
    expect(amount?.className).toContain("fr-num");
  });

  it("is placed on the felt by default, and can step off it", () => {
    const { unmount } = render(<PotDisplay cents={1840} />);
    expect(query("pot")?.className).toContain("fr-pot--placed");
    unmount();

    render(<PotDisplay cents={1840} placed={false} />);
    expect(query("pot")?.className).not.toContain("fr-pot--placed");
  });

  it("takes another leading word", () => {
    render(<PotDisplay cents={460} label="Side pot" />);
    expect(screen.getByRole("status", { name: "Side pot $4.60" })).toBeTruthy();
  });
});

describe("BetChips", () => {
  it("shows a chip disc and the amount on the seat -> pot axis", () => {
    render(<BetChips cents={460} />);
    const bet = screen.getByRole("group", { name: "bet $4.60" });
    expect(bet.querySelector('[data-fr="chip-disc"]')).toBeTruthy();
    expect(bet.querySelector('[data-fr="bet-amount"]')?.textContent).toBe("$4.60");
    expect(bet.className).toContain("fr-bet--placed");
  });

  it("carries the chip tier so the stack can shrink while the number does not", () => {
    for (const tier of [1, 2, 3, 4] as const) {
      const { unmount } = render(<BetChips cents={460} tier={tier} />);
      const bet = query("bet-chips");
      expect(bet?.getAttribute("data-tier")).toBe(String(tier));
      expect(bet?.querySelector('[data-fr="bet-amount"]')?.textContent).toBe("$4.60");
      unmount();
    }
  });

  it("takes an explicit label for calls and all-ins", () => {
    render(<BetChips cents={4255} label="all-in $42.55" tier={4} />);
    expect(screen.getByRole("group", { name: "all-in $42.55" })).toBeTruthy();
  });
});

describe("DealerButton", () => {
  it("is a named 16px disc", () => {
    render(<DealerButton />);
    const button = screen.getByRole("img", { name: "dealer button" });
    expect(button.textContent).toBe("D");
    expect(button.className).toContain("fr-dealer");
    expect(button.className).toContain("fr-dealer--placed");
  });

  it("can be labelled and un-placed", () => {
    render(<DealerButton label="button, hero" placed={false} />);
    expect(screen.getByRole("img", { name: "button, hero" }).className).not.toContain("fr-dealer--placed");
  });
});
