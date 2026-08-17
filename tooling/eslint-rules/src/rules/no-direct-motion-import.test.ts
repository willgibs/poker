import { describe, it } from "vitest";
import { createRuleTester } from "../test-helpers.ts";
import rule from "./no-direct-motion-import.ts";

describe("no-direct-motion-import", () => {
  it("passes RuleTester valid/invalid cases", () => {
    createRuleTester().run("no-direct-motion-import", rule, {
      valid: [
        {
          name: "motion import allowed in packages/ui",
          code: 'import { motion } from "motion";',
          filename: "packages/ui/src/Button.tsx",
        },
        {
          name: "framer-motion subpath allowed in packages/table-ui",
          code: 'import { AnimatePresence } from "framer-motion";',
          filename: "packages/table-ui/src/Felt.tsx",
        },
        {
          name: "unrelated package import",
          code: 'import { z } from "zod";',
          filename: "apps/web/src/App.tsx",
        },
      ],
      invalid: [
        {
          name: "static import outside packages/ui and packages/table-ui",
          code: 'import { motion } from "motion";',
          filename: "packages/bots/src/persona.ts",
          errors: [{ messageId: "directMotionImport" }],
        },
        {
          name: "framer-motion static import in apps/web",
          code: 'import { motion } from "framer-motion";',
          filename: "apps/web/src/App.tsx",
          errors: [{ messageId: "directMotionImport" }],
        },
        {
          name: "subpath import of framer-motion",
          code: 'import { motion } from "framer-motion/dist/es";',
          filename: "apps/web/src/App.tsx",
          errors: [{ messageId: "directMotionImport" }],
        },
        {
          name: "dynamic import()",
          code: 'const m = await import("framer-motion");',
          filename: "apps/web/src/App.tsx",
          errors: [{ messageId: "directMotionImport" }],
        },
        {
          name: "re-export",
          code: 'export * from "motion";',
          filename: "apps/web/src/App.tsx",
          errors: [{ messageId: "directMotionImport" }],
        },
        {
          name: "require()",
          code: 'const fm = require("framer-motion");',
          filename: "apps/web/src/App.tsx",
          errors: [{ messageId: "directMotionImport" }],
        },
      ],
    });
  });
});
