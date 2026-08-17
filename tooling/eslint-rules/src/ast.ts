/**
 * Minimal structural AST shapes for the node types our rules inspect.
 *
 * We deliberately do NOT depend on `@typescript-eslint/utils` (it is only a
 * transitive dep here, not declared by this package — pulling its types in
 * would be a phantom dependency). ESLint's own `Rule.RuleListener` index
 * signature accepts arbitrary selector keys (e.g. "JSXAttribute") typed
 * loosely; handlers below receive that loose node and narrow to these shapes
 * via a cast. Keep these interfaces limited to the fields each rule reads.
 */

export interface EsNode {
  type: string;
  loc?: { start: { line: number; column: number }; end: { line: number; column: number } } | null;
}

export interface LiteralNode extends EsNode {
  type: "Literal";
  value: string | number | boolean | null | bigint;
}

export interface TemplateElementNode extends EsNode {
  type: "TemplateElement";
  value: { raw: string; cooked: string | null };
}

export interface StringSourceNode extends EsNode {
  type: "Literal";
  value: string | null;
}

export interface ImportDeclarationNode extends EsNode {
  type: "ImportDeclaration";
  source: StringSourceNode;
}

export interface ImportExpressionNode extends EsNode {
  type: "ImportExpression";
  source: EsNode;
}

export interface ExportNamedDeclarationNode extends EsNode {
  type: "ExportNamedDeclaration";
  source: StringSourceNode | null;
}

export interface ExportAllDeclarationNode extends EsNode {
  type: "ExportAllDeclaration";
  source: StringSourceNode;
}

export interface CalleeIdentifierNode extends EsNode {
  type: string;
  name?: string;
}

export interface CallExpressionNode extends EsNode {
  type: "CallExpression";
  callee: CalleeIdentifierNode;
  arguments: EsNode[];
}

export interface JSXIdentifierNode extends EsNode {
  type: "JSXIdentifier";
  name: string;
}

export interface JSXOpeningElementNode extends EsNode {
  type: "JSXOpeningElement";
  name: EsNode & { name?: string };
}

export interface JSXExpressionContainerNode extends EsNode {
  type: "JSXExpressionContainer";
  expression: EsNode;
}

export interface JSXAttributeNode extends EsNode {
  type: "JSXAttribute";
  name: EsNode & { name?: string };
  value: JSXExpressionContainerNode | LiteralNode | null;
}
