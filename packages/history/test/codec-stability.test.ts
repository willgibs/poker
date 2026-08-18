/**
 * Compact-encoding byte-wise stability pin.
 *
 * docs/hand-format.md calls the compact tuple encoding "normative" and its
 * tuple layouts "frozen" (grow-only). `codec.test.ts` locks individual event
 * tuple shapes and checks round-trip/size-budget properties, but nothing
 * pins the *exact* serialized bytes of a full encoded envelope end to end
 * (field order, nesting, literal values). This fixture does — any change to
 * encodeHand's output shape for the committed fixture hand must show up as
 * a diff here and be a deliberate, reviewed regeneration (docs/testing.md:
 * "Golden fixtures regenerate only in reviewed commits").
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeHand, encodeHand } from "../src/index";
import { fixtureHand } from "./fixtures/hand001";

const golden = readFileSync(new URL("./fixtures/hand001.codec.golden.json", import.meta.url), "utf8");

describe("encodeHand compact-form stability pin", () => {
  it("matches the committed golden JSON byte-for-byte", () => {
    const serialized = JSON.stringify(encodeHand(fixtureHand), null, 2) + "\n";
    expect(serialized).toBe(golden);
  });

  it("the pinned golden bytes decode back to the fixture exactly", () => {
    const parsed: unknown = JSON.parse(golden);
    expect(decodeHand(parsed)).toStrictEqual(fixtureHand);
  });
});
