import type { Rule } from "eslint";
import type { EsNode, JSXAttributeNode } from "../ast.ts";

// No path allowlist by design: the only escape hatch is a standard
// `// eslint-disable-line local/no-inline-style-objects` comment, so every
// exception is visible in a diff and requires a human to type it.

const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow JSX style={{...}} attributes. Use system component props / design tokens instead.",
    },
    schema: [],
    messages: {
      inlineStyle:
        "Inline style objects are banned — use system component props or design tokens. If truly unavoidable, silence this one line with `// eslint-disable-line local/no-inline-style-objects` and a comment explaining why.",
    },
  },
  create(context): Rule.RuleListener {
    return {
      JSXAttribute(node: EsNode) {
        const attr = node as unknown as JSXAttributeNode;
        if (attr.name.name !== "style") return;
        if (attr.value?.type !== "JSXExpressionContainer") return;
        if (attr.value.expression.type !== "ObjectExpression") return;
        context.report({ node, messageId: "inlineStyle" });
      },
    };
  },
};

export default rule;
