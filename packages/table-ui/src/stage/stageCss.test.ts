/**
 * `stage.css`'s own contract.
 *
 * The stylesheet holds coordinates, which makes it the one sheet in the kit
 * that can silently disagree with a TypeScript module. So this file reads it
 * and checks, slot by slot, that every number in it is the number
 * `geometry.ts` computes — a seat nudged in CSS "just to line it up" is a
 * failing test, not a mystery two waves later.
 *
 * The token-purity checks mirror `components/componentsCss.test.ts`: the
 * `local/no-raw-colors` lint rule only sees TypeScript, so CSS gets its rule
 * asserted here.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { TableDensity } from "../components";
import { BET_AXIS_FRACTION, SEAT_SLOTS, dealerAnchor } from "./geometry";

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "stage.css"), "utf8");

/** Strip comments so prose about colours cannot fail the colour checks. */
const code = css.replace(/\/\*[\s\S]*?\*\//g, "");

const DENSITIES: readonly TableDensity[] = [2, 6, 9];

function slotRule(density: TableDensity, slot: number): string {
  const selector = `\\.fr-stage__scene\\[data-fr-density="${String(density)}"\\] \\.fr-stage-slot-${String(slot)}`;
  return code.match(new RegExp(`${selector}\\s*\\{[^}]+\\}`))?.[0] ?? "";
}

describe("stage.css — the ring is geometry.ts", () => {
  it("declares every slot of every density, and no others", () => {
    for (const density of DENSITIES) {
      SEAT_SLOTS[density].forEach((_, slot) => {
        expect(slotRule(density, slot), `density ${String(density)} slot ${String(slot)}`).not.toBe("");
      });
      expect(slotRule(density, SEAT_SLOTS[density].length)).toBe("");
    }
  });

  it("places each seat on the coordinate the module computes", () => {
    for (const density of DENSITIES) {
      SEAT_SLOTS[density].forEach((point, slot) => {
        const rule = slotRule(density, slot);
        expect(rule).toMatch(new RegExp(`--fr-slot-x:\\s*${String(point.x)};`));
        expect(rule).toMatch(new RegExp(`--fr-slot-y:\\s*${String(point.y)};`));
      });
    }
  });

  it("places each dealer button where `dealerAnchor` puts it", () => {
    for (const density of DENSITIES) {
      SEAT_SLOTS[density].forEach((point, slot) => {
        const rule = slotRule(density, slot);
        const button = dealerAnchor(point);
        expect(rule).toContain(`--fr-dealer-x: ${String(button.x)}%;`);
        expect(rule).toContain(`--fr-dealer-y: ${String(button.y)}%;`);
      });
    }
  });

  it("derives the bet axis as a rule, once, at the documented fraction", () => {
    const anchor = code.match(/\.fr-stage__anchor\s*\{[^}]+\}/)?.[0] ?? "";
    expect(anchor).toContain(`* ${String(BET_AXIS_FRACTION)})`);
    expect(anchor).toMatch(/--fr-bet-x:\s*calc\(\(var\(--fr-slot-x\)/);
    expect(anchor).toMatch(/--fr-bet-y:\s*calc\(\(var\(--fr-slot-y\)/);
    // One derivation, not seventeen copies of it.
    expect(code.match(/--fr-bet-x:/g)).toHaveLength(1);
  });

  it("pins the pot and the board to the study's anchors", () => {
    const scene = code.match(/\.fr-stage__scene\s*\{[^}]+\}/)?.[0] ?? "";
    expect(scene).toMatch(/--fr-pot-cx:\s*50;/);
    expect(scene).toMatch(/--fr-pot-cy:\s*56;/);
    expect(scene).toMatch(/--fr-board-cx:\s*50;/);
    expect(scene).toMatch(/--fr-board-cy:\s*39;/);
  });

  it("makes the scene the size container flights are measured against", () => {
    const scene = code.match(/\.fr-stage__scene\s*\{[^}]+\}/)?.[0] ?? "";
    expect(scene).toMatch(/container-type:\s*size/);
  });

  it("animates a flight with transform and opacity only (beats.md law #4)", () => {
    const flight = code.match(/\.fr-stage__flight\s*\{[^}]+\}/)?.[0] ?? "";
    expect(flight).toMatch(/will-change:\s*transform,\s*opacity/);
    // No layout property is ever handed to motion here.
    expect(flight).not.toMatch(/\b(?:width|height|margin|padding):/);
  });
});

describe("stage.css — token purity", () => {
  it("contains no hex colour literals", () => {
    expect(code.match(/#[0-9a-fA-F]{3,8}\b/g)).toBeNull();
  });

  it("contains no rgb/rgba/hsl/hsla literals", () => {
    expect(code.match(/\b(?:rgba?|hsla?)\s*\(/g)).toBeNull();
  });

  it("contains no named colours for paint", () => {
    expect(code.match(/:\s*(?:white|black|red|green|blue|gray|grey)\b/g)).toBeNull();
  });

  it("only ever reads --fr-* custom properties", () => {
    const referenced = [...code.matchAll(/var\(\s*(--[\w-]+)/g)].map((match) => match[1] ?? "");
    expect(referenced.length).toBeGreaterThan(10);
    expect(referenced.filter((name) => !name.startsWith("--fr-"))).toEqual([]);
  });

  it("never transitions a layout property", () => {
    for (const declaration of code.match(/transition:[^;]+;/g) ?? []) {
      expect(declaration).toMatch(/var\(--fr-duration-/);
      expect(declaration).toMatch(/var\(--fr-ease-/);
      expect(declaration).not.toMatch(/\b(?:width|height|top|left|margin|padding)\b/);
    }
  });
});
