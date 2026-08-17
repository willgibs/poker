import type { Rule } from "eslint";
import type { EsNode, JSXOpeningElementNode } from "../ast.ts";
import { isUiPackagePath } from "../paths.ts";

const BANNED_TAGS = new Set(["button", "a"]);

function isExempt(filename: string): boolean {
  // .tsx only: this rule has nothing to check in plain .ts files (no JSX),
  // and applies "once React code exists" — wired now, flags nothing until
  // apps/**.tsx and packages/**.tsx components land.
  if (!filename.endsWith(".tsx")) return true;
  return isUiPackagePath(filename);
}

const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow raw JSX <button>/<a> elements outside packages/ui; use system components instead.",
    },
    schema: [],
    messages: {
      rawInteractiveElement:
        "Raw <{{tag}}> is banned outside packages/ui — use the system Button/Link component instead (see docs/design-system.md).",
    },
  },
  create(context): Rule.RuleListener {
    if (isExempt(context.filename)) {
      return {};
    }
    return {
      JSXOpeningElement(node: EsNode) {
        const el = node as unknown as JSXOpeningElementNode;
        if (el.name.type !== "JSXIdentifier") return;
        const tag = el.name.name;
        if (!tag || !BANNED_TAGS.has(tag)) return;
        context.report({ node, messageId: "rawInteractiveElement", data: { tag } });
      },
    };
  },
};

export default rule;
