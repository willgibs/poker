import { defineConfig } from "vitest/config";

export default defineConfig({
  // React 19 automatic runtime: packages/ui + packages/table-ui ship .tsx that
  // never imports React itself. tsconfig.base.json carries the same setting for tsc.
  esbuild: { jsx: "automatic" },
  test: {
    include: [
      "packages/*/src/**/*.test.ts",
      "packages/*/src/**/*.test.tsx",
      "packages/*/test/**/*.test.ts",
      "packages/*/test/**/*.test.tsx",
      "apps/web/src/**/*.test.ts",
      "apps/web/src/**/*.test.tsx",
    ],
    testTimeout: 30_000,
  },
});
