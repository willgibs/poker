/**
 * The stylesheet guard.
 *
 * `local/no-raw-colors` only lints TypeScript, so a `.css` file is the one
 * place a stray hex could still slip into the design system. This test closes
 * that hole for the component stylesheets and asserts the two rules that make
 * the atoms behave: token-only paint, and a `:focus-visible` treatment on every
 * interactive selector.
 *
 * It also covers `packages/table-ui/src/hero/hero.css` — same rules, one guard,
 * because the hero zone is where the raw values would be most tempting.
 */

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const COMPONENTS_CSS = fileURLToPath(new URL("./components.css", import.meta.url));
const HERO_CSS = fileURLToPath(new URL("../../../table-ui/src/hero/hero.css", import.meta.url));

/**
 * Assembled from parts so this file does not flag itself — `local/no-raw-colors`
 * scans string literals, and a guard against colour literals is made of them.
 */
const HEX = new RegExp("#" + "(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\\b", "g");
const FUNCTIONAL_COLOUR = new RegExp("\\b(?:r" + "gba?|h" + "sla?|lab|lch|oklab|oklch)\\s*\\(", "g");
const FUNCTIONAL_COLOUR_NAME = "r" + "gb()/h" + "sl()";

const SHEETS: readonly { name: string; path: string }[] = [
  { name: "packages/ui/src/components/components.css", path: COMPONENTS_CSS },
  { name: "packages/table-ui/src/hero/hero.css", path: HERO_CSS },
];

/** Comments explain the rules (and quote the banned forms); only declarations are scanned. */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function sheets(): readonly { name: string; css: string }[] {
  return SHEETS.filter((s) => existsSync(s.path)).map((s) => ({
    name: s.name,
    css: stripComments(readFileSync(s.path, "utf8")),
  }));
}

describe("component stylesheets", () => {
  it("finds both sheets", () => {
    expect(sheets().map((s) => s.name)).toEqual(SHEETS.map((s) => s.name));
  });

  it("writes down no colour literal — every paint is a --fr-* lookup", () => {
    for (const { name, css } of sheets()) {
      expect(css.match(HEX), `hex literal in ${name}`).toBeNull();
      expect(css.match(FUNCTIONAL_COLOUR), `${FUNCTIONAL_COLOUR_NAME} literal in ${name}`).toBeNull();
    }
  });

  it("invents no duration or easing outside the token table", () => {
    for (const { name, css } of sheets()) {
      // Any bare time value (`200ms`, `.3s`) means a duration was hand-tuned
      // instead of looked up. Token references read `var(--fr-duration-*)`.
      const bareTime = css.match(/(?<![\w-])\d*\.?\d+m?s\b/g);
      expect(bareTime, `bare time value in ${name}`).toBeNull();

      const bareEase = css.match(/cubic-bezier\s*\(/g);
      expect(bareEase, `inline cubic-bezier in ${name}`).toBeNull();
    }
  });

  it("gives every interactive atom a :focus-visible ring", () => {
    const css = stripComments(readFileSync(COMPONENTS_CSS, "utf8"));
    for (const selector of [".fr-btn", ".fr-sizechip", ".fr-slider", ".fr-amount__input"]) {
      expect(css.includes(`${selector}:focus-visible`), `${selector} has no :focus-visible rule`).toBe(true);
    }
    // A ring that only exists as a colour change is invisible under
    // forced-colors; the system uses a real outline.
    expect(css).toContain("outline: 2px solid var(--fr-glow)");
  });

  it("never animates a layout property (beats.md law #4)", () => {
    for (const { name, css } of sheets()) {
      for (const match of css.matchAll(/transition:\s*([^;]+);/g)) {
        const declaration = match[1] ?? "";
        for (const banned of ["width", "height", "top", "left", "right", "bottom", "margin", "padding"]) {
          expect(
            new RegExp(`(^|[\\s,])${banned}[\\s,]`).test(declaration),
            `${name} transitions the layout property "${banned}"`,
          ).toBe(false);
        }
      }
    }
  });

  it("honours prefers-reduced-motion", () => {
    for (const { name, css } of sheets()) {
      expect(css.includes("prefers-reduced-motion"), `${name} has no reduced-motion block`).toBe(true);
    }
  });
});
