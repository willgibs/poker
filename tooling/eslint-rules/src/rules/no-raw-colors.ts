import type { Rule } from "eslint";
import type { LiteralNode, TemplateElementNode } from "../ast.ts";
import { isGeneratedFile, isTokensPath } from "../paths.ts";

// #fff, #ffff (w/ alpha), #ffffff, #ffffffaa — not followed by another hex digit.
const HEX_COLOR = /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})(?![0-9a-f])/i;
// rgb(...), rgba(...), hsl(...), hsla(...)
const FUNCTIONAL_COLOR = /\b(?:rgba?|hsla?)\s*\(/i;

function findColorLiteral(text: string): string | null {
  const hex = HEX_COLOR.exec(text);
  if (hex) return hex[0];
  const fn = FUNCTIONAL_COLOR.exec(text);
  if (fn) return fn[0];
  return null;
}

function isExempt(filename: string): boolean {
  return isTokensPath(filename) || isGeneratedFile(filename);
}

const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow raw hex/rgb()/hsl() color literals outside packages/ui/src/tokens and *.gen.* files.",
    },
    schema: [],
    messages: {
      rawColor:
        "Raw color literal '{{match}}' is banned outside design tokens. Reference a token from packages/ui/src/tokens instead (see docs/design-system.md).",
    },
  },
  create(context): Rule.RuleListener {
    if (isExempt(context.filename)) {
      return {};
    }
    return {
      Literal(node) {
        const lit = node as unknown as LiteralNode;
        if (typeof lit.value !== "string") return;
        const match = findColorLiteral(lit.value);
        if (match) {
          context.report({ node, messageId: "rawColor", data: { match } });
        }
      },
      TemplateElement(node) {
        const el = node as unknown as TemplateElementNode;
        const match = findColorLiteral(el.value.raw);
        if (match) {
          context.report({ node, messageId: "rawColor", data: { match } });
        }
      },
    };
  },
};

export default rule;
