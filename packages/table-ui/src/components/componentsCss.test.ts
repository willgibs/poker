/**
 * The stylesheet's own contract.
 *
 * `local/no-raw-colors` only lints TypeScript, so the rule that keeps this kit
 * inside the token layer — no colour literal, ever, anywhere — is asserted
 * here instead: every colour in `components.css` is a `--fr-*` custom property,
 * composed with `color-mix()` when it needs alpha.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("./components.css", import.meta.url), "utf8");

/** Strip comments so prose about colours cannot fail the colour checks. */
const code = css.replace(/\/\*[\s\S]*?\*\//g, "");

describe("components.css — token purity", () => {
  it("contains no hex colour literals", () => {
    expect(code.match(/#[0-9a-fA-F]{3,8}\b/g)).toBeNull();
  });

  it("contains no rgb/rgba/hsl/hsla literals", () => {
    expect(code.match(/\b(?:rgba?|hsla?)\s*\(/g)).toBeNull();
  });

  it("contains no named colours for paint", () => {
    // `transparent` and `currentColor` are keywords, not palette entries; a
    // bare `white`/`black` would be a palette decision made outside the tokens.
    expect(code.match(/:\s*(?:white|black|red|green|blue|gray|grey)\b/g)).toBeNull();
  });

  it("only ever reads --fr-* custom properties", () => {
    const referenced = [...code.matchAll(/var\(\s*(--[\w-]+)/g)].map((match) => match[1] ?? "");
    expect(referenced.length).toBeGreaterThan(40);
    expect(referenced.filter((name) => !name.startsWith("--fr-"))).toEqual([]);
  });

  it("sets tabular figures on every amount, without leaning on @poker/ui's .fr-num", () => {
    for (const selector of ["\\.fr-seat__stack", "\\.fr-pot__amount", "\\.fr-bet__amount", "\\.fr-seat__hud"]) {
      const rule = code.match(new RegExp(`${selector}\\s*\\{[^}]+\\}`))?.[0] ?? "";
      expect(rule).toMatch(/font-variant-numeric:\s*tabular-nums/);
    }
  });

  it("uses token durations and easings for every transition", () => {
    for (const declaration of code.match(/transition:[^;]+;/g) ?? []) {
      expect(declaration).toMatch(/var\(--fr-duration-/);
      expect(declaration).toMatch(/var\(--fr-ease-/);
    }
  });
});

describe("components.css — the locked metrics", () => {
  it("keeps the three card sizes: 72 / 56 / 24", () => {
    expect(code).toContain('.fr-card[data-size="hero"]');
    expect(code).toMatch(/--fr-card-w:\s*72px/);
    expect(code).toMatch(/--fr-card-w:\s*56px/);
    expect(code).toMatch(/--fr-card-w:\s*24px/);
  });

  it("derives the whole card from one width variable", () => {
    expect(code).toMatch(/height:\s*calc\(var\(--fr-card-w\)\s*\*\s*1\.4\)/);
    expect(code).toMatch(/border-radius:\s*calc\(var\(--fr-card-w\)\s*\*\s*0\.13\)/);
  });

  it("keeps the avatar ladder 34 / 26 / 21", () => {
    expect(code).toMatch(/\[data-fr-density="2"\][\s\S]*?--fr-seat-avatar:\s*34px/);
    expect(code).toMatch(/\[data-fr-density="6"\][\s\S]*?--fr-seat-avatar:\s*26px/);
    expect(code).toMatch(/\[data-fr-density="9"\][\s\S]*?--fr-seat-avatar:\s*21px/);
  });

  it("holds hero's plate at M+ when the table compresses to 9-max", () => {
    expect(code).toMatch(
      /\.fr-seat\[data-hero="true"\]\[data-fr-density="9"\]\s*\{[\s\S]*?--fr-seat-avatar:\s*26px/,
    );
  });

  it("keeps the read dot at a fixed 8px, top-right", () => {
    const dot = code.match(/\.fr-seat__read-dot\s*\{[^}]+\}/)?.[0] ?? "";
    expect(dot).toMatch(/width:\s*8px/);
    expect(dot).toMatch(/height:\s*8px/);
    expect(dot).toMatch(/top:\s*-2px/);
    expect(dot).toMatch(/right:\s*-1px/);
    expect(dot).not.toContain("var(--fr-seat-avatar");
  });

  it("keeps the dealer button a 16px disc", () => {
    const disc = code.match(/\.fr-dealer\s*\{[^}]+\}/)?.[0] ?? "";
    expect(disc).toMatch(/width:\s*16px/);
    expect(disc).toMatch(/height:\s*16px/);
  });

  it("fades mucked cards to 38% and folded plates to 42%", () => {
    expect(code).toMatch(/\.fr-card\[data-mucked="true"\]\s*\{[^}]*opacity:\s*0\.38/);
    expect(code).toMatch(/\[data-folded="true"\][^{]*\{[^}]*opacity:\s*0\.42/);
  });

  it("draws the empty slot as a 22% keyline over a 3% fill", () => {
    const slot = code.match(/\.fr-card-slot\s*\{[^}]+\}/g)?.join("") ?? "";
    expect(slot).toMatch(/dashed color-mix\(in srgb, var\(--fr-text\) 22%, transparent\)/);
    expect(slot).toMatch(/background:\s*color-mix\(in srgb, var\(--fr-text\) 3%, transparent\)/);
  });

  it("draws an open-plan felt: a pooled glow, no rail", () => {
    expect(code).toMatch(/\.fr-felt\s*\{[^}]*aspect-ratio:\s*16\s*\/\s*10/);
    const glow = code.match(/\.fr-felt__glow\s*\{[^}]+\}/)?.[0] ?? "";
    expect(glow).toContain("radial-gradient");
    expect(glow).toContain("var(--fr-felt1)");
    expect(glow).toContain("var(--fr-felt2)");
    expect(code).not.toContain("var(--fr-rail)");
  });

  it("respects reduce-motion for the think-pulse", () => {
    expect(code).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation:\s*none/);
  });
});
