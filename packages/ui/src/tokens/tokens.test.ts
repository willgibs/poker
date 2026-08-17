import { describe, expect, it } from "vitest";

import { duration, durationMs, ink, soundCueBus, soundCueDefaultDb, soundCues, space, spring } from "./primitives";
import { semantic, semanticTokenNames } from "./semantic";
import type { SemanticTokenName } from "./semantic";
import { DEFAULT_SKIN, resolveSkin, skinNames, skins } from "./skins";

/** Built from parts so this file trips no colour-literal scan of its own. */
const HEX = new RegExp("^" + "#" + "[0-9a-f]{6}$");

describe("semantic layer", () => {
  it("declares every token as a concrete lowercase hex colour", () => {
    expect(semanticTokenNames.length).toBeGreaterThan(0);
    for (const name of semanticTokenNames) {
      expect(semantic[name], name).toMatch(HEX);
    }
  });

  it("exposes names in declaration order", () => {
    expect(semanticTokenNames).toEqual(Object.keys(semantic));
  });
});

describe("skins", () => {
  it("resolves every semantic token to a concrete value under every skin", () => {
    for (const skin of skinNames) {
      const resolved = resolveSkin(skin);
      for (const name of semanticTokenNames) {
        expect(Object.hasOwn(resolved, name), `${skin}.${name} present`).toBe(true);
        expect(resolved[name], `${skin}.${name}`).toMatch(HEX);
      }
      // No stray keys: a skin cannot smuggle in a token the system does not own.
      expect(Object.keys(resolved).sort()).toEqual([...semanticTokenNames].sort());
    }
  });

  it("only overrides tokens that exist in the semantic layer", () => {
    const known = new Set<string>(semanticTokenNames);
    for (const skin of skinNames) {
      for (const name of Object.keys(skins[skin])) {
        expect(known.has(name), `${skin} overrides unknown token ${name}`).toBe(true);
      }
    }
  });

  it("treats the base semantic layer as the default skin", () => {
    expect(DEFAULT_SKIN).toBe("afterhours");
    expect(resolveSkin(DEFAULT_SKIN)).toEqual({ ...semantic });
    expect(Object.keys(skins.afterhours)).toEqual([]);
  });

  it("never lets a cosmetic reassign the money colours", () => {
    const money: readonly SemanticTokenName[] = ["pos", "neg"];
    for (const skin of skinNames) {
      const resolved = resolveSkin(skin);
      for (const name of money) {
        expect(resolved[name], `${skin}.${name}`).toBe(semantic[name]);
      }
    }
  });

  it("gives every skin its own felt and accents", () => {
    const fingerprints = skinNames.map((skin) => {
      const r = resolveSkin(skin);
      return [r.accentA, r.accentB, r.felt1, r.felt2].join("/");
    });
    expect(new Set(fingerprints).size).toBe(skinNames.length);
  });
});

describe("primitives", () => {
  it("keeps the ink ramp monotonically lighter", () => {
    const luminance = (hex: string): number => {
      const n = Number.parseInt(hex.slice(1), 16);
      return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
    };
    const values = Object.values(ink);
    for (let i = 1; i < values.length; i++) {
      const prev = values[i - 1] ?? "";
      const next = values[i] ?? "";
      expect(luminance(next), `${prev} -> ${next}`).toBeGreaterThan(luminance(prev));
    }
  });

  it("keeps the space scale 4-based", () => {
    for (const [step, value] of Object.entries(space)) {
      expect(value).toBe(`${Number(step) * 4}px`);
    }
  });

  it("keeps CSS durations in lockstep with their millisecond twins", () => {
    expect(Object.keys(duration)).toEqual(Object.keys(durationMs));
    for (const key of Object.keys(durationMs) as (keyof typeof durationMs)[]) {
      expect(duration[key]).toBe(`${durationMs[key]}ms`);
    }
  });

  it("derives each spring from its beats.md duration and bounce", () => {
    for (const [name, config] of Object.entries(spring)) {
      const omega = (2 * Math.PI) / config.durationSec;
      const zeta = 1 - config.bounce;
      expect(config.mass).toBe(1);
      expect(config.stiffness, `${name}.stiffness`).toBeCloseTo(omega * omega * config.mass, 0);
      expect(config.damping, `${name}.damping`).toBeCloseTo(2 * zeta * omega * config.mass, 0);
    }
  });

  it("routes every sound cue to exactly one bus with a default level", () => {
    expect(new Set(soundCues).size).toBe(soundCues.length);
    for (const cue of soundCues) {
      expect(soundCueBus[cue], cue).toBeTruthy();
      expect(soundCueDefaultDb[cue], cue).toBeLessThanOrEqual(0);
    }
    expect(Object.keys(soundCueBus).sort()).toEqual([...soundCues].sort());
    expect(Object.keys(soundCueDefaultDb).sort()).toEqual([...soundCues].sort());
  });
});
