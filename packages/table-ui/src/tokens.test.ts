/**
 * The cross-package motion rail.
 *
 * `packages/ui` owns the motion vocabulary; this package restates part of it as
 * a *scheduling* vocabulary (`DURATION`, `SpringToken`) so the headless
 * Presenter can reason about time without importing a renderer. That restating
 * is deliberate — and it is exactly the kind of duplication that drifts. This
 * file is the guard: `@poker/ui` is the source, `@poker/table-ui` is the
 * mirror, and a change on either side that the other does not follow fails
 * here rather than in a hand nobody is watching.
 *
 * `packages/ui/src/tokens/tokens.test.ts` holds the *within-package* twin of
 * this (`duration` ↔ `durationMs`, `scale` ↔ `scaleNum`). If `table-ui` ever
 * mirrors another axis — distances, scales, ambient loops — its lockstep
 * assertion belongs here too.
 */

import { duration, durationMs, spring } from "@poker/ui";
import type { SpringName } from "@poker/ui";
import { describe, expect, it } from "vitest";

import { DURATION } from "./tokens";
import type { SpringToken } from "./tokens";

const SPRING_PREFIX = "spring/";

/**
 * Every `SpringToken`, written out. `satisfies Record<SpringToken, true>` means
 * a token added to the union without a line here is a *compile* error; the
 * runtime comparison below then catches the reverse (a `spring` entry with no
 * token). Both objects are read by `Object.keys`, so neither is dead weight.
 */
const EVERY_SPRING_TOKEN = {
  "spring/deal": true,
  "spring/flip": true,
  "spring/chip": true,
  "spring/pot": true,
  "spring/muck": true,
  "spring/ui": true,
  "spring/celebrate": true,
  "spring/flush": true,
} as const satisfies Record<SpringToken, true>;

/** The mirror arm: a `spring` entry added in `@poker/ui` must be listed here. */
const EVERY_SPRING_NAME = {
  deal: true,
  flip: true,
  chip: true,
  pot: true,
  muck: true,
  ui: true,
  celebrate: true,
  flush: true,
} as const satisfies Record<SpringName, true>;

describe("table-ui ↔ ui token lockstep", () => {
  it("mirrors @poker/ui's durationMs exactly, key order included", () => {
    expect(Object.keys(DURATION)).toEqual(Object.keys(durationMs));
    for (const key of Object.keys(durationMs) as (keyof typeof durationMs)[]) {
      expect(DURATION[key], key).toBe(durationMs[key]);
    }
  });

  it("resolves every scheduling duration to the CSS time the renderer will use", () => {
    for (const key of Object.keys(DURATION) as (keyof typeof DURATION)[]) {
      expect(duration[key], key).toBe(`${DURATION[key]}ms`);
    }
  });

  it("names exactly the springs @poker/ui defines — both directions", () => {
    const fromTokens = Object.keys(EVERY_SPRING_TOKEN).map((token) => token.slice(SPRING_PREFIX.length));
    expect([...fromTokens].sort()).toEqual(Object.keys(spring).sort());
    expect(Object.keys(EVERY_SPRING_NAME).sort()).toEqual(Object.keys(spring).sort());
    expect([...fromTokens].sort()).toEqual(Object.keys(EVERY_SPRING_NAME).sort());
  });

  it("prefixes every spring token, so a bare spring name cannot pass as one", () => {
    for (const token of Object.keys(EVERY_SPRING_TOKEN)) {
      expect(token.startsWith(SPRING_PREFIX), token).toBe(true);
    }
  });
});
