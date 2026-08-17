// @vitest-environment jsdom
/**
 * The header budget test docs/design-system.md asks for: "add a unit test in
 * its package asserting `slots.length <= 4`". Everything else here defends the
 * same line from the DOM side — four slots rendered, four slots present, no
 * fifth one sneaking in through the contextual slot.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HEADER_SLOTS, HEADER_SLOT_BUDGET, TableHeader } from "./TableHeader";

afterEach(cleanup);

function renderHeader(props: Partial<React.ComponentProps<typeof TableHeader>> = {}) {
  const onExit = vi.fn();
  const onOpenLoadout = vi.fn();
  const onToggleNetUnit = vi.fn();
  const utils = render(
    <TableHeader
      stakes="$0.10/$0.25"
      netCents={1240}
      bigBlindCents={25}
      handsPlayed={142}
      loadoutName="Guided"
      onExit={onExit}
      onOpenLoadout={onOpenLoadout}
      onToggleNetUnit={onToggleNetUnit}
      {...props}
    />,
  );
  return { ...utils, onExit, onOpenLoadout, onToggleNetUnit };
}

describe("the ≤4-slot budget", () => {
  it("declares no more slots than the budget allows", () => {
    expect(HEADER_SLOTS.length).toBeLessThanOrEqual(HEADER_SLOT_BUDGET);
  });

  it("names exactly the four the design calls for, in order", () => {
    expect([...HEADER_SLOTS]).toEqual(["identity", "loadout", "contextual", "exit"]);
  });

  it("renders exactly four slots", () => {
    const { container } = renderHeader();
    expect(container.querySelectorAll("[data-header-slot]")).toHaveLength(4);
  });

  it("still renders exactly four when the contextual slot is filled", () => {
    const { container } = renderHeader({ contextual: <span data-testid="ctx">Turn</span> });
    expect(container.querySelectorAll("[data-header-slot]")).toHaveLength(4);
    expect(screen.getByTestId("ctx")).not.toBeNull();
  });

  it("still renders exactly four when it is empty", () => {
    const { container } = renderHeader({ contextual: undefined });
    expect(container.querySelectorAll("[data-header-slot]")).toHaveLength(4);
  });

  it("renders the declared slots and nothing else", () => {
    const { container } = renderHeader();
    const rendered = Array.from(container.querySelectorAll("[data-header-slot]")).map(
      (el) => el.getAttribute("data-header-slot"),
    );
    expect(rendered).toEqual([...HEADER_SLOTS]);
  });
});

describe("the identity cluster", () => {
  it("shows stakes, net and hands", () => {
    renderHeader();
    expect(screen.getByText("$0.10/$0.25")).not.toBeNull();
    expect(screen.getByText("+$12.40")).not.toBeNull();
    expect(screen.getByText("142 hands")).not.toBeNull();
  });

  it("signs the net and colours it by sign", () => {
    const { container, rerender } = renderHeader({ netCents: -305 });
    expect(screen.getByText("-$3.05")).not.toBeNull();
    expect(container.querySelector('.fr-hdr__net[data-sign="neg"]')).not.toBeNull();

    rerender(
      <TableHeader stakes="$0.10/$0.25" netCents={0} bigBlindCents={25} handsPlayed={1} loadoutName="Guided" />,
    );
    expect(container.querySelector('.fr-hdr__net[data-sign="flat"]')).not.toBeNull();
    expect(screen.getByText("1 hand")).not.toBeNull();
  });

  it("shows the same net in big blinds", () => {
    renderHeader({ netUnit: "bb" });
    expect(screen.getByText("+49.6bb")).not.toBeNull();
  });

  it("names the toggle by what it will do next", () => {
    const { onToggleNetUnit, rerender } = renderHeader();
    const toggle = screen.getByRole("button", { name: /Show in big blinds/ });
    fireEvent.click(toggle);
    expect(onToggleNetUnit).toHaveBeenCalledTimes(1);

    rerender(
      <TableHeader
        stakes="$0.10/$0.25"
        netCents={1240}
        bigBlindCents={25}
        handsPlayed={142}
        loadoutName="Guided"
        netUnit="bb"
      />,
    );
    expect(screen.getByRole("button", { name: /Show in dollars/ })).not.toBeNull();
  });

  it("puts tabular numerals on every number in the cluster", () => {
    const { container } = renderHeader();
    for (const selector of [".fr-hdr__stakes", ".fr-hdr__hands"]) {
      expect(container.querySelector(selector)?.className).toContain("fr-num");
    }
  });
});

describe("loadout and exit", () => {
  it("offers the loadout as a popover trigger", () => {
    const { onOpenLoadout } = renderHeader();
    const trigger = screen.getByRole("button", { name: "Guided" });
    expect(trigger.getAttribute("aria-haspopup")).toBe("dialog");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(trigger);
    expect(onOpenLoadout).toHaveBeenCalledTimes(1);
  });

  it("always offers the door, last", () => {
    const { onExit, container } = renderHeader();
    fireEvent.click(screen.getByRole("button", { name: "Exit" }));
    expect(onExit).toHaveBeenCalledTimes(1);

    const slots = container.querySelectorAll("[data-header-slot]");
    expect(slots[slots.length - 1]?.getAttribute("data-header-slot")).toBe("exit");
  });
});

describe("accessibility", () => {
  it("is a banner-shaped header element", () => {
    const { container } = renderHeader();
    expect(container.querySelector("header")).not.toBeNull();
  });

  it("keeps every control focusable and in the tab order", () => {
    const { container } = renderHeader({ contextual: <span>Turn</span> });
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>("button"));
    expect(buttons.length).toBe(3); // net toggle, loadout, exit
    for (const button of buttons) {
      expect(button.hasAttribute("disabled")).toBe(false);
      expect(Number(button.getAttribute("tabindex") ?? "0")).toBeGreaterThanOrEqual(0);
      button.focus();
      expect(document.activeElement).toBe(button);
    }
  });

  it("hides the decorative separators from assistive tech", () => {
    const { container } = renderHeader();
    for (const sep of container.querySelectorAll(".fr-hdr__sep")) {
      expect(sep.getAttribute("aria-hidden")).toBe("true");
    }
  });
});
