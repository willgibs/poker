import { defineConfig } from "vitest/config";

// Root vitest.config.ts does not (yet) include tooling/** in its `include`
// globs, so this package self-verifies with its own config:
//   npx vitest run --config tooling/eslint-rules/vitest.config.ts
// (run from the repo root, or `cd tooling/eslint-rules && npx vitest run`).
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
