import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { VAR_PREFIX, buildCss, kebab, primitiveVars, semanticVars } from "./emit";
import { semanticTokenNames } from "./semantic";
import { DEFAULT_SKIN, resolveSkin, skinNames } from "./skins";

const css = buildCss();

/** The text between `selector {` and the next `}`. */
function blockBody(source: string, selector: string): string {
  const open = source.indexOf(`${selector} {`);
  expect(open, `${selector} block present`).toBeGreaterThanOrEqual(0);
  const close = source.indexOf("\n}", open);
  expect(close, `${selector} block closed`).toBeGreaterThan(open);
  return source.slice(open, close);
}

describe("kebab", () => {
  it("lowercases at capital boundaries and leaves digits alone", () => {
    expect(kebab("accentA")).toBe("accent-a");
    expect(kebab("verySlow")).toBe("very-slow");
    expect(kebab("offRecord")).toBe("off-record");
    expect(kebab("felt1")).toBe("felt1");
    expect(kebab("950")).toBe("950");
  });
});

describe("buildCss", () => {
  it("is deterministic across repeated builds", () => {
    expect(buildCss()).toBe(buildCss());
    expect(buildCss()).toBe(css);
  });

  it("emits every primitive custom property in :root", () => {
    const root = blockBody(css, ":root");
    const vars = primitiveVars();
    expect(vars.length).toBeGreaterThan(0);
    for (const { name, value } of vars) {
      expect(root, name).toContain(`  ${name}: ${value};`);
    }
  });

  it("emits every semantic custom property in :root, resolved for the default skin", () => {
    const root = blockBody(css, ":root");
    const resolved = resolveSkin(DEFAULT_SKIN);
    for (const token of semanticTokenNames) {
      expect(root, token).toContain(`  ${VAR_PREFIX}${kebab(token)}: ${resolved[token]};`);
    }
  });

  it("emits a self-contained block for every skin", () => {
    for (const skin of skinNames) {
      const body = blockBody(css, `[data-skin="${skin}"]`);
      const resolved = resolveSkin(skin);
      for (const token of semanticTokenNames) {
        expect(body, `${skin}.${token}`).toContain(`  ${VAR_PREFIX}${kebab(token)}: ${resolved[token]};`);
      }
      // Skin blocks carry the semantic layer and nothing else.
      expect(semanticVars(skin).length).toBe(semanticTokenNames.length);
      expect(body.match(/--fr-/g)?.length).toBe(semanticTokenNames.length);
    }
  });

  it("prefixes every declaration with --fr-", () => {
    const declarations = css.match(/^\s{2}--[a-z0-9-]+:/gm) ?? [];
    expect(declarations.length).toBeGreaterThan(0);
    for (const declaration of declarations) {
      expect(declaration.trim().startsWith(VAR_PREFIX)).toBe(true);
    }
  });

  it("emits no duplicate custom property names within a block", () => {
    const all = [...primitiveVars(), ...semanticVars(DEFAULT_SKIN)].map((v) => v.name);
    expect(new Set(all).size).toBe(all.length);
  });

  it("matches the committed tokens.gen.css", () => {
    const committed = readFileSync(new URL("../tokens.gen.css", import.meta.url), "utf8");
    expect(committed).toBe(css);
  });
});
