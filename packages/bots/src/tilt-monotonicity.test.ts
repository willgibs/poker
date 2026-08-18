/**
 * `tiltAdjust` monotonicity — authored direction only.
 *
 * `tilt.test.ts` already checks the two tilt ENDPOINTS (0 and 1) for a
 * handful of characters (Rocco, the Professor). What is untested is the
 * general claim `tiltAdjust` is actually built on: each gained parameter is
 * MONOTONIC in tilt, for every character on the roster, in whichever
 * direction that character's own bible authored — most gains are > 1
 * (tilt amplifies), but a few are deliberately < 1 (Priya's `aggressionGain:
 * 0.8` — "she shrinks, never spews"; Hank's `aggressionGain: 0.95`; Vera's
 * `callDownGain: 0.95` — "no loose calls, ever"). A test that only ever
 * checked "goes up" would have missed a regression that flattened or
 * reversed one of those deliberately-shrinking characters.
 *
 * This is provable directly from `tiltAdjust`'s own algebra — `gain(base, g)
 * = clamp01(base * (1 + f * (g - 1)))` where `f = clamp01(tilt) *
 * tiltSusceptibility` is nondecreasing in tilt (`tiltSusceptibility >= 0`
 * always), so the pre-clamp value is affine in `f` with slope `base * (g -
 * 1)` — nonnegative when `g >= 1`, nonpositive when `g <= 1` — and `clamp01`
 * preserves whatever order that affine map already established. The property
 * test below exists to pin that shape against every persona's actual
 * authored gains, not to re-derive the proof.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { CAST } from "./cast/index";
import { tiltAdjust } from "./tilt";
import type { PersonaConfig } from "./persona";

/** `actual` must move from `at(lo)` to `at(hi)` (lo <= hi) in the direction `gain` implies. */
function expectDirected(label: string, gain: number, at0: number, at1: number): void {
  if (gain > 1) expect(at1, label).toBeGreaterThanOrEqual(at0);
  else if (gain < 1) expect(at1, label).toBeLessThanOrEqual(at0);
  else expect(at1, label).toBeCloseTo(at0, 10);
}

describe("tiltAdjust — monotonicity in the authored direction", () => {
  it.each(CAST.map((p): [string, PersonaConfig] => [p.id, p]))(
    "%s moves every gained parameter only in its own bible's direction as tilt rises",
    (id, persona) => {
      fc.assert(
        fc.property(
          fc.double({ min: 0, max: 1, noNaN: true }),
          fc.double({ min: 0, max: 1, noNaN: true }),
          (t1, t2) => {
            const lo = Math.min(t1, t2);
            const hi = Math.max(t1, t2);
            const a = tiltAdjust(persona, lo);
            const b = tiltAdjust(persona, hi);

            expectDirected(`${id} aggression`, persona.tilt.aggressionGain, a.aggression, b.aggression);
            expectDirected(`${id} callDownTendency`, persona.tilt.callDownGain, a.callDownTendency, b.callDownTendency);
            // bluffFrequency's gain is 1 + (aggressionGain - 1) * 0.6 — same
            // sign relative to 1 as aggressionGain, so the same direction.
            expectDirected(`${id} bluffFrequency`, persona.tilt.aggressionGain, a.bluffFrequency, b.bluffFrequency);
            expectDirected(`${id} errorRate`, persona.tilt.errorGain, a.errorRate, b.errorRate);

            // Tightness has no persona-specific gain — tilt only ever
            // loosens discipline, for every character, by construction.
            expect(b.tightness, `${id} tightness`).toBeLessThanOrEqual(a.tightness);
            // The felt-tilt intensity itself never falls as tilt rises.
            expect(b.intensity, `${id} intensity`).toBeGreaterThanOrEqual(a.intensity);
            return true;
          },
        ),
        { numRuns: 30, seed: 20260818 },
      );
    },
  );

  it("never lets a gained parameter leave [0, 1], across the whole roster", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...CAST),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (persona, tilt) => {
          const adjusted = tiltAdjust(persona, tilt);
          for (const key of ["aggression", "callDownTendency", "bluffFrequency", "errorRate", "tightness"] as const) {
            const v = adjusted[key];
            expect(v, `${persona.id} ${key} at tilt ${tilt}`).toBeGreaterThanOrEqual(0);
            expect(v, `${persona.id} ${key} at tilt ${tilt}`).toBeLessThanOrEqual(1);
          }
          return true;
        },
      ),
      { numRuns: 200, seed: 20260818 },
    );
  });
});
