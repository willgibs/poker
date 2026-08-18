/**
 * The font kit guard.
 *
 * `fonts.gen.css` is copied from the Gate 0 kit
 * (poker-internal/design/gates/gate0/fonts/fonts.css), not authored here. These
 * assertions protect the two properties that make it safe to ship: it is
 * self-contained (no network request, so no CSP hole and no FOUT from a third
 * party), and it carries exactly the two General Sans weights the token layer
 * promises.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { fontWeight } from "./tokens/primitives";

const css = readFileSync(new URL("./fonts.gen.css", import.meta.url), "utf8");

describe("fonts.gen.css", () => {
  it("declares General Sans at 400 and 600, and nothing else", () => {
    const faces = css.match(/@font-face\s*\{[^}]*\}/g) ?? [];
    expect(faces.length).toBe(2);
    for (const face of faces) {
      expect(face).toContain("General Sans");
      expect(face).toContain("font-style: normal");
      expect(face).toContain("font-display: swap");
    }
    expect(css.match(/font-weight:\s*(\d+)/g)).toEqual(["font-weight: 400", "font-weight: 600"]);
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
    expect(sources.length).toBe(2);
    for (const src of sources) {
      expect(src).toContain("data:font/woff2;base64,");
    }
    expect(css.includes("http")).toBe(false);
  });

  it("says out loud that these are ASCII subsets (full set lands at Gate 5)", () => {
    expect(css).toContain("SUBSET WARNING");
    expect(css).toContain("Gate 5");
  });
});
