import tseslint from "typescript-eslint";
// BEGIN design-system lint rules (tooling/eslint-rules) — see docs/design-system.md
import designSystemPlugin from "./tooling/eslint-rules/src/index.ts";
// END design-system lint rules import

export default tseslint.config(
  { ignores: ["**/dist/**", "**/node_modules/**", "**/*.gen.ts", "**/coverage/**"] },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-restricted-globals": ["error", "event", "name", "length"],
    },
  },
  {
    files: ["packages/core/**", "packages/rng/**", "packages/eval/**", "packages/engine/**", "packages/history/**", "packages/ranges/**", "packages/equity/**", "packages/charts/**", "packages/bots/**", "packages/analysis/**", "packages/sim/**"],
    rules: {
      "no-restricted-properties": [
        "error",
        { object: "Date", property: "now", message: "Engine code is deterministic: time is an input." },
        { object: "Math", property: "random", message: "Engine code is deterministic: use injected rng streams." },
      ],
    },
  },
  // ==== BEGIN design-system lint rules (tooling/eslint-rules) ====
  // Enforces the design budgets in CLAUDE.md / docs/design-system.md.
  // Rule source + RuleTester unit tests live in tooling/eslint-rules/src.
  // Path-based exemptions (tokens dir, *.gen.*, packages/ui, packages/table-ui)
  // are implemented inside each rule so they're covered by its own unit tests.
  {
    files: ["apps/**/*.{ts,tsx}", "packages/**/*.{ts,tsx}"],
    plugins: { local: designSystemPlugin },
    rules: {
      "local/no-raw-colors": "error",
      "local/no-inline-style-objects": "error",
      "local/no-direct-motion-import": "error",
      "local/no-raw-interactive-elements": "error",
    },
  }
  // ==== END design-system lint rules ====
);
