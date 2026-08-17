import tseslint from "typescript-eslint";

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
  }
);
