/**
 * The laws, as properties. These are the checks beats.md §8 calls conformance:
 * sequencing, the instant-mode orbit budget, and the reduce-motion contract.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { beatEnd, hasTranslation } from "./beats";
import { schedule } from "./schedule";
import { SPEEDS, type Speed } from "./tokens";
import { SCRIPTED_HAND, blockingGroups, fullOrbitHand, overlapViolations, randomHand } from "./test-helpers";

const seedArb = fc.integer({ min: 0, max: 0x7fffffff });
const speedArb = fc.constantFrom<Speed>(...SPEEDS);

describe("sequencing law (beats.md §5.1/§5.2)", () => {
  it("never overlaps two blocking phases illegally (property)", () => {
    fc.assert(
      fc.property(seedArb, speedArb, fc.boolean(), (seed, speed, reduceMotion) => {
        const beats = schedule(randomHand(seed), { speed, reduceMotion, heroSeat: 0 });
        expect(overlapViolations(beats)).toEqual([]);
      }),
      { numRuns: 400 },
    );
  });

  it("keeps the scripted hand legal at every speed", () => {
    for (const speed of SPEEDS) {
      for (const reduceMotion of [false, true]) {
        expect(overlapViolations(schedule(SCRIPTED_HAND, { speed, reduceMotion, heroSeat: 3 }))).toEqual([]);
      }
    }
  });

  it("orders blocking phases by their first event (property)", () => {
    fc.assert(
      fc.property(seedArb, speedArb, (seed, speed) => {
        const beats = schedule(randomHand(seed), { speed, reduceMotion: false, heroSeat: 0 });
        const groups = blockingGroups(beats);
        const indexOf = (group: string): number => Number(group.split("#")[1] ?? -1);
        const eventOrder = groups.map((g) => indexOf(g.group));
        // Phase order follows event order: a merge inferred at event i sorts
        // ahead of the board deal that triggered it, so ties are allowed.
        for (let i = 1; i < eventOrder.length; i++) {
          expect(eventOrder[i] ?? 0).toBeGreaterThanOrEqual(eventOrder[i - 1] ?? 0);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("never starts an actor beat before the dealer phase it waits on (property)", () => {
    fc.assert(
      fc.property(seedArb, speedArb, (seed, speed) => {
        const beats = schedule(randomHand(seed), { speed, reduceMotion: false, heroSeat: 0 });
        const groups = blockingGroups(beats);
        let dealerEnd = Number.NEGATIVE_INFINITY;
        for (const group of groups) {
          if (group.lane === "actor") expect(group.start).toBeGreaterThanOrEqual(dealerEnd);
          if (group.lane === "dealer") dealerEnd = Math.max(dealerEnd, group.end);
        }
      }),
      { numRuns: 200 },
    );
  });

  it("lets ambient beats overlap anything and delay nothing (property)", () => {
    fc.assert(
      fc.property(seedArb, speedArb, (seed, speed) => {
        const beats = schedule(randomHand(seed), { speed, reduceMotion: false, heroSeat: 0 });
        const ambient = beats.filter((b) => b.lane === "ambient");
        expect(ambient.every((b) => !b.blocking)).toBe(true);
        // Dropping every ambient beat leaves the blocking timeline untouched.
        const withoutAmbient = beats.filter((b) => b.lane !== "ambient");
        expect(overlapViolations(withoutAmbient)).toEqual([]);
        const blockingEnd = Math.max(0, ...withoutAmbient.filter((b) => b.blocking).map(beatEnd));
        const allBlockingEnd = Math.max(0, ...beats.filter((b) => b.blocking).map(beatEnd));
        expect(allBlockingEnd).toBe(blockingEnd);
      }),
      { numRuns: 200 },
    );
  });
});

describe("instant mode budget", () => {
  it("plays a full 8-handed orbit of engine beats in under 500ms", () => {
    const beats = schedule(fullOrbitHand(8), { speed: "instant", reduceMotion: false, heroSeat: 0 });
    const blocking = beats.filter((b) => b.blocking);
    const total = Math.max(...blocking.map(beatEnd));
    expect(total).toBeLessThanOrEqual(500);
    // Only the traces occupy any of it: showdown cross-fade + pot award slide.
    expect(beats.filter((b) => b.duration > 0).every((b) => b.keepsTrace || b.lane === "ambient")).toBe(true);
  });

  it("stays under budget for any hand shape (property)", () => {
    fc.assert(
      fc.property(seedArb, fc.boolean(), (seed, reduceMotion) => {
        const beats = schedule(randomHand(seed), { speed: "instant", reduceMotion, heroSeat: 0 });
        const blocking = beats.filter((b) => b.blocking);
        const total = blocking.length === 0 ? 0 : Math.max(...blocking.map(beatEnd));
        expect(total).toBeLessThanOrEqual(500);
      }),
      { numRuns: 300 },
    );
  });

  it("is monotone in speed: faster is never longer (property)", () => {
    fc.assert(
      fc.property(seedArb, (seed) => {
        const events = randomHand(seed);
        const span = (speed: Speed): number => {
          const beats = schedule(events, { speed, reduceMotion: false, heroSeat: 0 }).filter((b) => b.blocking);
          return beats.length === 0 ? 0 : Math.max(...beats.map(beatEnd));
        };
        const spans = SPEEDS.map(span);
        for (let i = 1; i < spans.length; i++) {
          expect(spans[i] ?? 0).toBeLessThanOrEqual(spans[i - 1] ?? 0);
        }
      }),
      { numRuns: 150 },
    );
  });
});

describe("reduce-motion contract (beats.md §5.4)", () => {
  it("emits no translation beat at any speed, for any hand (property)", () => {
    fc.assert(
      fc.property(seedArb, speedArb, (seed, speed) => {
        const beats = schedule(randomHand(seed), { speed, reduceMotion: true, heroSeat: 0 });
        expect(beats.filter(hasTranslation)).toEqual([]);
        expect(beats.every((b) => b.transforms.every((t) => t === "opacity" || t === "blur2px"))).toBe(true);
      }),
      { numRuns: 300 },
    );
  });

  it("delivers the same information on the same schedule shape (property)", () => {
    fc.assert(
      fc.property(seedArb, speedArb, (seed, speed) => {
        const events = randomHand(seed);
        const plain = schedule(events, { speed, reduceMotion: false, heroSeat: 0 });
        const reduced = schedule(events, { speed, reduceMotion: true, heroSeat: 0 });
        // Nothing is removed: every event that produced a beat still does.
        const kinds = (list: typeof plain): string[] => [...new Set(list.map((b) => b.kind))].sort();
        expect(kinds(reduced)).toEqual(kinds(plain));
        expect(overlapViolations(reduced)).toEqual([]);
      }),
      { numRuns: 200 },
    );
  });
});

describe("schedule purity", () => {
  it("is a pure function of (events, options) (property)", () => {
    fc.assert(
      fc.property(seedArb, speedArb, fc.boolean(), (seed, speed, reduceMotion) => {
        const events = randomHand(seed);
        const a = schedule(events, { speed, reduceMotion, heroSeat: 0 });
        const b = schedule(events, { speed, reduceMotion, heroSeat: 0 });
        expect(JSON.stringify(b)).toBe(JSON.stringify(a));
      }),
      { numRuns: 200 },
    );
  });

  it("produces non-negative, integral-or-exact times (property)", () => {
    fc.assert(
      fc.property(seedArb, speedArb, (seed, speed) => {
        const beats = schedule(randomHand(seed), { speed, reduceMotion: false, heroSeat: 0 });
        for (const beat of beats) {
          expect(beat.at).toBeGreaterThanOrEqual(0);
          expect(beat.duration).toBeGreaterThanOrEqual(0);
          expect(Number.isFinite(beat.at + beat.duration)).toBe(true);
        }
      }),
      { numRuns: 200 },
    );
  });
});
