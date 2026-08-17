// @vitest-environment jsdom
/**
 * HeroCards is composition, so this suite checks the composition: two cards,
 * hero size, one accessible name for the pair, and the three states the felt
 * can put them in.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { HeroCards } from "./HeroCards";

afterEach(cleanup);

describe("HeroCards", () => {
  it("renders exactly two cards", () => {
    const { container } = render(<HeroCards cards={["As", "Qd"]} />);
    expect(container.querySelectorAll('[data-fr="card"]')).toHaveLength(2);
  });

  it("defaults to hero size — 72px, per cards.html", () => {
    const { container } = render(<HeroCards cards={["As", "Qd"]} />);
    for (const card of container.querySelectorAll('[data-fr="card"]')) {
      expect(card.getAttribute("data-size")).toBe("hero");
    }
  });

  it("takes the other locked sizes", () => {
    const { container } = render(<HeroCards cards={["As", "Qd"]} size="hud" />);
    for (const card of container.querySelectorAll('[data-fr="card"]')) {
      expect(card.getAttribute("data-size")).toBe("hud");
    }
  });

  it("names the pair as one unit, not two loose images", () => {
    render(<HeroCards cards={["As", "Qd"]} />);
    const group = screen.getByRole("group", { name: "Your hand" });
    expect(group).not.toBeNull();
  });

  it("takes a custom label", () => {
    render(<HeroCards cards={["As", "Qd"]} label="Hero, showdown" />);
    expect(screen.getByRole("group", { name: "Hero, showdown" })).not.toBeNull();
  });

  it("renders backs when face-down", () => {
    const { container } = render(<HeroCards cards={["As", "Qd"]} faceDown />);
    const cards = container.querySelectorAll('[data-fr="card"]');
    expect(cards).toHaveLength(2);
    for (const card of cards) {
      expect(card.getAttribute("data-face")).toBe("down");
    }
  });

  it("marks a mucked hand without deleting it", () => {
    const { container } = render(<HeroCards cards={["As", "Qd"]} mucked />);
    expect(container.querySelector("[data-hero-cards]")?.hasAttribute("data-mucked")).toBe(true);
    expect(container.querySelectorAll('[data-fr="card"]')).toHaveLength(2);
  });

  it("holds an empty, silent slot before the deal", () => {
    const { container } = render(<HeroCards cards={null} />);
    const slot = container.querySelector("[data-hero-cards]");
    expect(slot).not.toBeNull();
    expect(slot?.hasAttribute("data-empty")).toBe(true);
    expect(slot?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelectorAll('[data-fr="card"]')).toHaveLength(0);
  });
});
