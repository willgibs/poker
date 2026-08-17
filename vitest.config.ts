import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "packages/*/src/**/*.test.ts",
      "packages/*/test/**/*.test.ts",
      "apps/web/src/**/*.test.ts",
      "apps/web/src/**/*.test.tsx",
    ],
    testTimeout: 30_000,
  },
});
