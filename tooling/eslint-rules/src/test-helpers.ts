import { RuleTester } from "eslint";
import { parser } from "typescript-eslint";

/** Shared RuleTester wired for TSX so JSX-bearing fixtures parse. */
export function createRuleTester(): RuleTester {
  return new RuleTester({
    languageOptions: {
      parser,
      ecmaVersion: 2022,
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
  });
}
