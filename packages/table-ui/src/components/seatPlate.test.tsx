// @vitest-environment jsdom
/** SeatPlate — the locked Study 2 scaling rules, as assertions. */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SeatPlate } from "./SeatPlate";
import type { TableDensity } from "./Felt";

afterEach(cleanup);

const DENSITIES: readonly TableDensity[] = [2, 6, 9];

function seat(): HTMLElement {
  const found = document.querySelector<HTMLElement>('[data-fr="seat-plate"]');
  if (found === null) throw new Error("no seat plate rendered");
  return found;
}

describe("SeatPlate — name and stack", () => {
  it("exposes a group named by the player and their stack", () => {
    render(<SeatPlate name="Barry" stackCents={1230} />);
    expect(screen.getByRole("group", { name: "Barry, $12.30" })).toBeTruthy();
  });

  it("renders the stack tabular at every density", () => {
    for (const density of DENSITIES) {
      const { unmount } = render(<SeatPlate name="Doris" stackCents={3175} density={density} />);
      const stack = seat().querySelector('[data-fr="seat-stack"]');
      expect(stack?.textContent).toBe("$31.75");
      expect(stack?.className).toContain("fr-num");
      unmount();
    }
  });

  it("carries the density onto the element so the plate scales in CSS", () => {
    for (const density of DENSITIES) {
      const { unmount } = render(<SeatPlate name="Silas" stackCents={6120} density={density} />);
      expect(seat().getAttribute("data-fr-density")).toBe(String(density));
      unmount();
    }
  });

  it("defaults to the home density, 6-max", () => {
    render(<SeatPlate name="Rocco" stackCents={2430} />);
    expect(seat().getAttribute("data-fr-density")).toBe("6");
  });
});

describe("SeatPlate — the 9-max trade-off", () => {
  it("shows villain names at 2-max and 6-max", () => {
    for (const density of [2, 6] as const) {
      const { unmount } = render(<SeatPlate name="Priya" stackCents={2410} density={density} />);
      expect(seat().querySelector('[data-fr="seat-name"]')?.textContent).toBe("Priya");
      unmount();
    }
  });

  it("drops villain names at 9-max — avatar and stack only", () => {
    render(<SeatPlate name="Luna" stackCents={985} density={9} />);
    expect(seat().querySelector('[data-fr="seat-name"]')).toBeNull();
    expect(seat().querySelector('[data-fr="seat-stack"]')?.textContent).toBe("$9.85");
  });

  it("keeps the dropped name in the accessible name — pixels, never information", () => {
    render(<SeatPlate name="Luna" stackCents={985} density={9} />);
    expect(screen.getByRole("group", { name: "Luna, $9.85" })).toBeTruthy();
  });

  it("never compresses hero's plate: the name survives 9-max", () => {
    render(<SeatPlate name="Hero" stackCents={4255} density={9} hero />);
    expect(seat().querySelector('[data-fr="seat-name"]')?.textContent).toBe("Hero");
    expect(seat().getAttribute("data-hero")).toBe("true");
  });

  it("marks only hero's plate as hero", () => {
    render(<SeatPlate name="Vera" stackCents={6120} />);
    expect(seat().getAttribute("data-hero")).toBeNull();
  });
});

describe("SeatPlate — the avatar disc", () => {
  it("falls back to the name's initial, uppercased", () => {
    render(<SeatPlate name="barry" stackCents={1230} />);
    expect(seat().querySelector('[data-fr="avatar"]')?.textContent).toBe("B");
  });

  it("takes an explicit initial", () => {
    render(<SeatPlate name="The Professor" stackCents={1230} avatarInitial="P" />);
    expect(seat().querySelector('[data-fr="avatar"]')?.textContent).toBe("P");
  });

  it("does not announce the placeholder glyph", () => {
    render(<SeatPlate name="Chip" stackCents={1805} />);
    expect(seat().querySelector('[data-fr="avatar"]')?.getAttribute("aria-hidden")).toBe("true");
  });
});

describe("SeatPlate — mood", () => {
  it("is neutral unless told otherwise", () => {
    render(<SeatPlate name="Silas" stackCents={6120} />);
    expect(seat().getAttribute("data-mood")).toBe("neutral");
  });

  it("carries heated and steaming for the rim treatment", () => {
    for (const mood of ["neutral", "heated", "steaming"] as const) {
      const { unmount } = render(<SeatPlate name="Barry" stackCents={1230} moodState={mood} />);
      expect(seat().getAttribute("data-mood")).toBe(mood);
      unmount();
    }
  });

  it("never labels the mood — tilt is an earned read, not a meter", () => {
    render(<SeatPlate name="Barry" stackCents={1230} moodState="steaming" />);
    expect(screen.getByRole("group", { name: "Barry, $12.30" }).textContent).not.toContain("steaming");
  });
});

describe("SeatPlate — states", () => {
  it("shows the earned-read dot only when the read is earned", () => {
    const { unmount } = render(<SeatPlate name="Doris" stackCents={3175} />);
    expect(seat().querySelector('[data-fr="earned-read"]')).toBeNull();
    unmount();

    render(<SeatPlate name="Doris" stackCents={3175} earnedRead />);
    expect(seat().querySelector('[data-fr="earned-read"]')).toBeTruthy();
  });

  it("keeps the read dot at every density — it never scales, never moves", () => {
    for (const density of DENSITIES) {
      const { unmount } = render(
        <SeatPlate name="Doris" stackCents={3175} density={density} earnedRead />,
      );
      const dot = seat().querySelector('[data-fr="earned-read"]');
      expect(dot).toBeTruthy();
      // Same class at every density: the size lives in one CSS rule, not a scale.
      expect(dot?.className).toBe("fr-seat__read-dot");
      unmount();
    }
  });

  it("marks folded seats", () => {
    render(<SeatPlate name="Barry" stackCents={1230} folded />);
    expect(seat().getAttribute("data-folded")).toBe("true");
    expect(screen.getByRole("group", { name: "Barry, $12.30, folded" })).toBeTruthy();
  });

  it("shows the think-pulse only on the seat to act", () => {
    const { unmount } = render(<SeatPlate name="Rocco" stackCents={2430} />);
    expect(seat().querySelector('[data-fr="thinking-indicator"]')).toBeNull();
    expect(seat().getAttribute("data-thinking")).toBeNull();
    unmount();

    render(<SeatPlate name="Rocco" stackCents={2430} thinking />);
    expect(seat().querySelector('[data-fr="thinking-indicator"]')).toBeTruthy();
    expect(seat().getAttribute("data-thinking")).toBe("true");
    expect(screen.getByRole("group", { name: "Rocco, $24.30, to act" })).toBeTruthy();
  });

  it("renders the compact HUD tag only when the loadout supplies one", () => {
    const { unmount } = render(<SeatPlate name="Vera" stackCents={6120} density={2} />);
    expect(seat().querySelector('[data-fr="seat-hud"]')).toBeNull();
    unmount();

    render(<SeatPlate name="Vera" stackCents={6120} density={2} hudTag="24 / 19" />);
    expect(seat().querySelector('[data-fr="seat-hud"]')?.textContent).toBe("24 / 19");
  });

  it("renders hole cards above the plate", () => {
    render(
      <SeatPlate name="Hero" stackCents={4255} hero>
        <span data-testid="hole-cards" />
      </SeatPlate>,
    );
    expect(seat().firstElementChild?.getAttribute("data-testid")).toBe("hole-cards");
  });
});
