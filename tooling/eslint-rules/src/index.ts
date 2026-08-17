import type { ESLint } from "eslint";
import noDirectMotionImport from "./rules/no-direct-motion-import.ts";
import noInlineStyleObjects from "./rules/no-inline-style-objects.ts";
import noRawColors from "./rules/no-raw-colors.ts";
import noRawInteractiveElements from "./rules/no-raw-interactive-elements.ts";

/**
 * Tiny local flat-config ESLint plugin for Freeroll's design-system budgets.
 * Not published — eslint.config.js imports this by relative path. See
 * docs/design-system.md for the rationale behind each rule.
 */
const plugin: ESLint.Plugin = {
  rules: {
    "no-raw-colors": noRawColors,
    "no-inline-style-objects": noInlineStyleObjects,
    "no-direct-motion-import": noDirectMotionImport,
    "no-raw-interactive-elements": noRawInteractiveElements,
  },
};

export default plugin;
