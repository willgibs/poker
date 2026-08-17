import { describe, it } from "vitest";
import { createRuleTester } from "../test-helpers.ts";
import rule from "./no-raw-colors.ts";

describe("no-raw-colors", () => {
  it("passes RuleTester valid/invalid cases", () => {
    createRuleTester().run("no-raw-colors", rule, {
      valid: [
        {
          name: "plain string, non-token file",
          code: 'export const label = "hello world";',
          filename: "packages/core/src/labels.ts",
        },
        {
          name: "hex literal allowed inside packages/ui/src/tokens/",
          code: 'export const felt = "#0b3d2e";',
          filename: "packages/ui/src/tokens/colors.ts",
        },
        {
          name: "rgb() allowed inside packages/ui/src/tokens/",
          code: 'export const felt = "rgb(11, 61, 46)";',
          filename: "packages/ui/src/tokens/colors.ts",
        },
        {
          name: "hex literal allowed in *.gen.* files",
          code: 'export const nash = "#ff00aa";',
          filename: "packages/charts/src/nash.gen.ts",
        },
        {
          name: "template literal without a color",
          code: "const greeting = `hello ${name}`;",
          filename: "packages/bots/src/persona.ts",
        },
      ],
      invalid: [
        {
          name: "hex literal outside tokens",
          code: 'const felt = "#0b3d2e";',
          filename: "packages/bots/src/persona.ts",
          errors: [{ messageId: "rawColor" }],
        },
        {
          name: "short hex literal",
          code: 'const felt = "#fff";',
          filename: "apps/web/src/App.tsx",
          errors: [{ messageId: "rawColor" }],
        },
        {
          name: "rgba() functional color",
          code: 'const felt = "rgba(11, 61, 46, 0.5)";',
          filename: "apps/web/src/App.tsx",
          errors: [{ messageId: "rawColor" }],
        },
        {
          name: "hsl() functional color",
          code: 'const felt = "hsl(140 60% 20%)";',
          filename: "apps/web/src/App.tsx",
          errors: [{ messageId: "rawColor" }],
        },
        {
          name: "hex color inside a template literal (one report per literal)",
          code: "const felt = `linear-gradient(#0b3d2e, #000)`;",
          filename: "apps/web/src/App.tsx",
          errors: [{ messageId: "rawColor" }],
        },
      ],
    });
  });
});
