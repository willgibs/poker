import type { Rule } from "eslint";
import type {
  CallExpressionNode,
  EsNode,
  ExportAllDeclarationNode,
  ExportNamedDeclarationNode,
  ImportDeclarationNode,
  ImportExpressionNode,
  StringSourceNode,
} from "../ast.ts";
import { isTableUiPackagePath, isUiPackagePath } from "../paths.ts";

const BANNED = ["motion", "framer-motion"];

function isBannedSource(value: string | null): string | null {
  if (!value) return null;
  for (const pkg of BANNED) {
    if (value === pkg || value.startsWith(`${pkg}/`)) return pkg;
  }
  return null;
}

function isExempt(filename: string): boolean {
  return isUiPackagePath(filename) || isTableUiPackagePath(filename);
}

const rule: Rule.RuleModule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow importing 'motion'/'framer-motion' outside packages/ui and packages/table-ui.",
    },
    schema: [],
    messages: {
      directMotionImport:
        "Direct import of '{{source}}' is banned outside packages/ui and packages/table-ui. Consume motion through the system component/animation API instead.",
    },
  },
  create(context): Rule.RuleListener {
    if (isExempt(context.filename)) {
      return {};
    }

    function checkSource(node: EsNode, source: StringSourceNode): void {
      if (typeof source.value !== "string") return;
      const banned = isBannedSource(source.value);
      if (banned) {
        context.report({ node, messageId: "directMotionImport", data: { source: banned } });
      }
    }

    return {
      ImportDeclaration(node) {
        const decl = node as unknown as ImportDeclarationNode;
        checkSource(node, decl.source);
      },
      ImportExpression(node) {
        const expr = node as unknown as ImportExpressionNode;
        if (expr.source.type !== "Literal") return;
        checkSource(node, expr.source as unknown as StringSourceNode);
      },
      ExportNamedDeclaration(node) {
        const decl = node as unknown as ExportNamedDeclarationNode;
        if (!decl.source) return;
        checkSource(node, decl.source);
      },
      ExportAllDeclaration(node) {
        const decl = node as unknown as ExportAllDeclarationNode;
        checkSource(node, decl.source);
      },
      CallExpression(node) {
        const call = node as unknown as CallExpressionNode;
        if (call.callee.type !== "Identifier" || call.callee.name !== "require") return;
        const arg = call.arguments[0];
        if (!arg || arg.type !== "Literal") return;
        checkSource(node, arg as unknown as StringSourceNode);
      },
    };
  },
};

export default rule;
