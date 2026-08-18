/**
 * The font kit guard.
 *
 * `fonts.gen.css` carries two kits, copied verbatim from their sources — not
 * authored here:
 *
 * - General Sans 400/600, from poker-internal/design/gates/gate0/fonts/fonts.css
 * - Geist Mono 400/600, from poker-internal/design/fonts/geist-mono/geist-mono-faces.css
 *
 * These assertions protect the properties that make the file safe to ship:
 * it is self-contained (no network request, so no CSP hole and no FOUT from
 * a third party), it carries exactly the four faces the token layer
 * promises (two families, 400 + 600 each), and the Geist Mono faces are
 * documented as a numerals-only subset rather than a general-purpose one.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { fontWeight } from "./tokens/primitives";

const css = readFileSync(new URL("./fonts.gen.css", import.meta.url), "utf8");

describe("fonts.gen.css", () => {
  it("declares General Sans and Geist Mono at 400 and 600, and nothing else", () => {
    const faces = css.match(/@font-face\s*\{[^}]*\}/g) ?? [];
    expect(faces.length).toBe(4);

    const byFamily: Record<string, string[]> = { "General Sans": [], "Geist Mono": [] };
    for (const face of faces) {
      expect(face).toContain("font-style: normal");
      expect(face).toContain("font-display: swap");

      const familyMatch = face.match(/font-family:\s*'([^']+)'/);
      const weightMatch = face.match(/font-weight:\s*(\d+)/);
      expect(familyMatch, `face has a font-family: ${face.slice(0, 80)}`).not.toBeNull();
      expect(weightMatch, `face has a font-weight: ${face.slice(0, 80)}`).not.toBeNull();

      const family: string = familyMatch?.[1] ?? "";
      const weight: string = weightMatch?.[1] ?? "";
      expect(Object.keys(byFamily), `unexpected font-family '${family}'`).toContain(family);
      byFamily[family]?.push(weight);
    }

    // Exactly two families, two faces each, weights 400 then 600 in file order.
    expect(Object.keys(byFamily)).toEqual(["General Sans", "Geist Mono"]);
    expect(byFamily["General Sans"]).toEqual(["400", "600"]);
    expect(byFamily["Geist Mono"]).toEqual(["400", "600"]);
  });

  it("never asks a weight the kit cannot draw", () => {
    const drawn = new Set(["400", "600"]);
    for (const [name, weight] of Object.entries(fontWeight)) {
      // 500 is a legal request — CSS font matching falls it back to the 400
      // face rather than synthesising. A weight above 600 would be faux-bolded.
      expect(Number(weight), `fontWeight.${name}`).toBeLessThanOrEqual(600);
      if (!drawn.has(weight)) expect(Number(weight), `fontWeight.${name}`).toBeLessThan(600);
    }
  });

  it("is self-contained — every face is a data URI, no external request", () => {
    const sources = css.match(/src:\s*url\(([^)]*)\)/g) ?? [];
    expect(sources.length).toBe(4);
    for (const src of sources) {
      expect(src).toContain("data:font/woff2;base64,");
    }
    expect(css.includes("http")).toBe(false);
  });

  it("says out loud that General Sans is an ASCII subset (full set lands at Gate 5)", () => {
    expect(css).toContain("SUBSET WARNING");
    expect(css).toContain("Gate 5");
  });

  it("says out loud that Geist Mono is a numerals-only subset, not prose-capable", () => {
    expect(css).toContain("numerals-only");
    expect(css).toContain("cannot set prose");
  });
});
