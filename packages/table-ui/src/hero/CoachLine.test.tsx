// @vitest-environment jsdom
/**
 * The coach budget is one line. The only way to break it is to let a second
 * one exist for even a frame, so that is what this suite hunts for.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CoachLine } from "./CoachLine";

afterEach(cleanup);

const FIRST = "The king changes less than it looks — your queens are still good.";
const SECOND = "Half pot keeps worse pairs in.";
const THIRD = "Quarter-pot from Rocco has meant surrender before.";

describe("CoachLine", () => {
  it("renders the line it is given", () => {
    render(<CoachLine line={FIRST} />);
    expect(screen.getByText(FIRST)).not.toBeNull();
  });

  it("holds its slot when there is nothing to say", () => {
    const { container } = render(<CoachLine line={null} />);
    const slot = container.querySelector("[data-coach-slot]");
    expect(slot).not.toBeNull();
    expect(slot?.hasAttribute("data-empty")).toBe(true);
    expect(slot?.textContent).toBe("");
  });

  it("is a polite live region, so a new line never steals focus", () => {
    render(<CoachLine line={FIRST} />);
    const slot = screen.getByRole("status");
    expect(slot.getAttribute("aria-live")).toBe("polite");
  });

  it("replaces rather than stacks — latest wins", () => {
    const { rerender, container } = render(<CoachLine line={FIRST} />);
    rerender(<CoachLine line={SECOND} />);

    expect(screen.queryByText(FIRST)).toBeNull();
    expect(screen.getByText(SECOND)).not.toBeNull();
    expect(container.querySelectorAll(".fr-coach__text")).toHaveLength(1);
  });

  it("keeps only the newest of a burst", () => {
    const { rerender, container } = render(<CoachLine line={FIRST} />);
    rerender(<CoachLine line={SECOND} />);
    rerender(<CoachLine line={THIRD} />);

    expect(container.querySelectorAll(".fr-coach__text")).toHaveLength(1);
    expect(screen.getByRole("status").textContent).toBe(THIRD);
    for (const stale of [FIRST, SECOND]) {
      expect(screen.queryByText(stale)).toBeNull();
    }
  });

  it("never renders two slots, whatever it is handed", () => {
    const { rerender } = render(<CoachLine line={FIRST} />);
    for (const line of [SECOND, null, THIRD, FIRST, null]) {
      rerender(<CoachLine line={line} />);
      expect(screen.getAllByRole("status")).toHaveLength(1);
    }
  });

  it("goes quiet when the line is cleared", () => {
    const { rerender } = render(<CoachLine line={FIRST} />);
    rerender(<CoachLine line={null} />);
    expect(screen.queryByText(FIRST)).toBeNull();
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("re-plays an unchanged line when its id is bumped", () => {
    const { rerender, container } = render(<CoachLine line={FIRST} lineId="a" />);
    const before = container.querySelector(".fr-coach__text");
    rerender(<CoachLine line={FIRST} lineId="b" />);
    const after = container.querySelector(".fr-coach__text");

    expect(after).not.toBe(before); // remounted, so the fade runs again
    expect(container.querySelectorAll(".fr-coach__text")).toHaveLength(1);
    expect(after?.textContent).toBe(FIRST);
  });
});
