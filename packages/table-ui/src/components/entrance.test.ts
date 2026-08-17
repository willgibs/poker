import { describe, expect, it } from "vitest";
import { durationMs, spring } from "@poker/ui";
import { CARD_ARC_PX, DURATION } from "../tokens";
import { boardCardEntrance } from "./entrance";

describe("boardCardEntrance", () => {
  it("rides the spring/deal token, not an invented spring", () => {
    const { transition } = boardCardEntrance(0, DURATION.stagger, false);
    expect(transition).toEqual({
      type: "spring",
      duration: spring.deal.durationSec,
      bounce: spring.deal.bounce,
      delay: 0,
    });
  });

  it("animates a transform string, never the x/y shorthands", () => {
    const { initial, animate } = boardCardEntrance(0, DURATION.stagger, false);
    expect(initial.transform).toBe(`translateY(-${CARD_ARC_PX}px)`);
    expect(animate.transform).toBe("translateY(0px)");
    expect(Object.keys(animate).sort()).toEqual(["opacity", "transform"]);
  });

  it("staggers by slot, in seconds", () => {
    for (const index of [0, 1, 2, 3, 4]) {
      const { transition } = boardCardEntrance(index, DURATION.stagger, false);
      expect(transition.delay).toBeCloseTo((index * DURATION.stagger) / 1000, 10);
    }
  });

  it("collapses to a fade in place under reduce-motion", () => {
    const { initial, animate, transition } = boardCardEntrance(2, DURATION.stagger, true);
    expect(initial.transform).toBeUndefined();
    expect(initial.opacity).toBe(0);
    expect(animate.opacity).toBe(1);
    expect(transition).toEqual({ duration: durationMs.quick / 1000, delay: (2 * DURATION.stagger) / 1000 });
  });

  it("keeps the stagger under reduce-motion — rhythm without motion", () => {
    const reduced = boardCardEntrance(3, DURATION.stagger, true);
    const full = boardCardEntrance(3, DURATION.stagger, false);
    expect(reduced.transition.delay).toBe(full.transition.delay);
  });

  it("always settles on the same end-state, reduce-motion or not", () => {
    expect(boardCardEntrance(1, DURATION.stagger, true).animate).toEqual(
      boardCardEntrance(1, DURATION.stagger, false).animate,
    );
  });
});
