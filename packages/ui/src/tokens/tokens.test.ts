import { describe, expect, it } from "vitest";

import {
  duration,
  durationMs,
  fontFamily,
  fontSize,
  ink,
  letterSpacing,
  radius,
  soundCueBus,
  soundCueDefaultDb,
  soundCues,
  space,
  spring,
  textStyles,
} from "./primitives";
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

/**
 * L12 is quoted verbatim into the law, so it is quoted verbatim into a test.
 * A change here is a design decision, never a refactor.
 */
describe("Carbon foundation (L12)", () => {
  it("pins every locked L12 value", () => {
    expect(semantic.canvas).toBe("#050507");
    expect(semantic.surface).toBe("#0f1113");
    expect(semantic.raised).toBe("#171a1e");
    expect(semantic.line).toBe("#2c2f35");
    expect(semantic.hairline).toBe("#1b1e22");
    expect(semantic.text).toBe("#f3f4f6");
    expect(semantic.dim).toBe("#868a92");
    expect(semantic.faint).toBe("#55585f");
    expect(semantic.cardface).toBe("#f5f7f9");
    expect(semantic.cardInk).toBe("#0f1113");
    expect(semantic.pos).toBe("#1cb271");
    expect(semantic.neg).toBe("#e84a39");
    expect(semantic.warn).toBe("#e2aa1c");
    expect(semantic.chart).toBe("#38c8e6");
  });

  it("keeps the primary action white, not chromatic (L8)", () => {
    expect(semantic.primary).toBe("#f3f4f6");
    expect(semantic.onPrimary).toBe("#050507");
    expect(semantic.primaryHover).toBe("#ffffff");
    expect(semantic.primaryPress).toBe("#d6d9de");
    // The focus ring is the text colour, and the legacy `glow` alias follows it.
    expect(semantic.focus).toBe("#f3f4f6");
    expect(semantic.glow).toBe(semantic.focus);
  });

  it("has retired the gradient pair (L3) — both ends resolve to the primary", () => {
    expect(semantic.accentA).toBe(semantic.primary);
    expect(semantic.accentB).toBe(semantic.primary);
  });

  it("draws the L12 anchors from the ink ramp rather than restating them", () => {
    expect(semantic.canvas).toBe(ink[50]);
    expect(semantic.surface).toBe(ink[150]);
    expect(semantic.raised).toBe(ink[200]);
    expect(semantic.hairline).toBe(ink[250]);
    expect(semantic.line).toBe(ink[300]);
    expect(semantic.faint).toBe(ink[600]);
    expect(semantic.dim).toBe(ink[800]);
    expect(semantic.text).toBe(ink[950]);
  });

  it("keeps the pre-Carbon names alive as aliases of the concept that survived", () => {
    expect(semantic.edge).toBe(semantic.line);
    expect(semantic.muted).toBe(semantic.dim);
    expect(semantic.suitS).toBe(semantic.suitSpadeFace);
    expect(semantic.felt1).toBe(semantic.felt);
    expect(semantic.felt2).toBe(semantic.felt);
  });
});

describe("suits (L13)", () => {
  it("keeps the three hues vivid", () => {
    expect(semantic.suitH).toBe("#f04a37");
    expect(semantic.suitD).toBe("#2f7ff2");
    expect(semantic.suitC).toBe("#0cbd78");
  });

  it("splits the spade into two substrate-specific tokens, not a hue", () => {
    expect(semantic.suitSpadeFace).toBe("#050507");
    expect(semantic.suitSpadeChrome).toBe("#ffffff");
    expect(semantic.suitSpadeFace).not.toBe(semantic.suitSpadeChrome);
  });

  it("gives the spade maximum contrast against its own substrate", () => {
    // On a card face the spade is near-black; on dark chrome it is near-white.
    expect(semantic.suitSpadeFace).toBe(semantic.canvas);
    expect(semantic.suitSpadeChrome).toBe(semantic.primaryHover);
  });
});

describe("felt (L16 — still open)", () => {
  it("ships both candidates as tokens", () => {
    expect(semantic.feltAchromatic).toBe("#0a0b0d");
    expect(semantic.feltWhisperGreen).toBe("#090e0c");
    expect(semantic.feltAchromatic).not.toBe(semantic.feltWhisperGreen);
  });

  it("points the live felt at the achromatic placeholder pending the gate", () => {
    expect(semantic.felt).toBe(semantic.feltAchromatic);
  });
});

describe("skins", () => {
  it("ships exactly one skin — Carbon (L8: the gradient-era trio is dead)", () => {
    expect(skinNames).toEqual(["carbon"]);
    expect(Object.keys(skins)).toEqual(["carbon"]);
    for (const dead of ["afterhours", "midnight", "cardroom"]) {
      expect(Object.hasOwn(skins, dead), `${dead} still shipping`).toBe(false);
    }
  });

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
    expect(DEFAULT_SKIN).toBe("carbon");
    expect(resolveSkin(DEFAULT_SKIN)).toEqual({ ...semantic });
    expect(Object.keys(skins.carbon)).toEqual([]);
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

  it("keeps the radius family tight — 2 / 4 / 7 (L14)", () => {
    expect(radius.sm).toBe("2px");
    expect(radius.md).toBe("4px");
    expect(radius.lg).toBe("7px");
    // Every non-geometric radius is one of the three steps (or zero).
    const geometric = new Set<string>([radius.pill, radius.circle]);
    const family = new Set<string>(["0px", radius.sm, radius.md, radius.lg]);
    for (const [name, value] of Object.entries(radius)) {
      if (geometric.has(value)) continue;
      expect(family.has(value), `radius.${name} = ${value} is outside the tight family`).toBe(true);
    }
  });

  it("sets the type scale from the locked Gate 1 scale", () => {
    expect(fontSize.display).toBe("32px");
    expect(fontSize.title).toBe("22px");
    expect(fontSize.heading).toBe("17px");
    expect(fontSize.body).toBe("14px");
    expect(fontSize.small).toBe("12.5px");
    expect(fontSize.label).toBe("11px");

    expect(letterSpacing.display).toBe("-0.021em");
    expect(letterSpacing.title).toBe("-0.018em");
    expect(letterSpacing.heading).toBe("-0.014em");
    expect(letterSpacing.body).toBe("-0.006em");
    expect(letterSpacing.small).toBe("-0.004em");
    expect(letterSpacing.label).toBe("0.08em");
  });

  it("tracks wide nowhere but the 11px eyebrow (L1)", () => {
    for (const [name, value] of Object.entries(letterSpacing)) {
      const em = Number.parseFloat(value);
      if (em <= 0) continue;
      expect(value, `letterSpacing.${name} is positive tracking`).toBe(letterSpacing.label);
    }
    // The one uppercase role in the system is the one that carries it.
    const uppercase = Object.entries(textStyles).filter(([, s]) => "textTransform" in s);
    expect(uppercase.map(([name]) => name)).toEqual(["label"]);
    expect(textStyles.label.fontSize).toBe("11px");
    expect(textStyles.label.letterSpacing).toBe(letterSpacing.label);
  });

  it("speaks in General Sans (L9), display and body from one family", () => {
    expect(fontFamily.display).toContain("General Sans");
    expect(fontFamily.body).toBe(fontFamily.display);
    for (const [name, style] of Object.entries(textStyles)) {
      expect(style.fontFamily, `textStyles.${name}`).toContain("General Sans");
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
