import ts from 'typescript';

import type { SiteKnowledgeOccurrence, SiteKnowledgeSource } from './siteKnowledgeTypes';

function unwrap(
  node: ts.Node,
): { expression: ts.Expression; type: ts.TypeNode | undefined } | undefined {
  if (
    ts.isAsExpression(node) ||
    ts.isTypeAssertionExpression(node) ||
    ts.isSatisfiesExpression(node)
  )
    return { expression: node.expression, type: node.type };
  if (ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node))
    return { expression: node.expression, type: undefined };
  return undefined;
}

/** Ordinary templates keep their static-part counting; property names fold the whole value. */
function staticString(node: ts.Node, foldTemplates = false): string | undefined {
  if (ts.isStringLiteralLike(node)) return node.text;
  const wrapped = unwrap(node);
  if (wrapped) return staticString(wrapped.expression, foldTemplates);
  if (foldTemplates && ts.isTemplateExpression(node)) {
    let value = node.head.text;
    for (const span of node.templateSpans) {
      const part = staticString(span.expression, true);
      if (part === undefined) return undefined;
      value += part + span.literal.text;
    }
    return value;
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = staticString(node.left, foldTemplates);
    const right = staticString(node.right, foldTemplates);
    if (left !== undefined && right !== undefined) return left + right;
  }
  return undefined;
}

/** Module paths (including dynamic/type imports and require) are not site knowledge. */
function isModulePath(node: ts.Node): boolean {
  const parent = node.parent;
  if (ts.isModuleDeclaration(parent) && parent.name === node) return true;
  if (
    (ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent)) &&
    (parent.name === node || parent.propertyName === node)
  )
    return true;
  if (ts.isNamespaceExport(parent) && parent.name === node) return true;
  if (
    (ts.isImportDeclaration(parent) || ts.isExportDeclaration(parent)) &&
    parent.moduleSpecifier === node
  )
    return true;
  if (ts.isExternalModuleReference(parent) && parent.expression === node) return true;
  if (ts.isImportTypeNode(parent) && parent.argument === node) return true;
  return (
    ts.isCallExpression(parent) &&
    parent.arguments[0] === node &&
    (parent.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(parent.expression) && parent.expression.text === 'require'))
  );
}

export function siteKnowledgeOccurrences(
  input: SiteKnowledgeSource,
  siteIds: ReadonlySet<string>,
): SiteKnowledgeOccurrence[] {
  const source = ts.createSourceFile(input.file, input.text, ts.ScriptTarget.Latest, true);
  const occurrences: SiteKnowledgeOccurrence[] = [];
  function record(node: ts.Node, site: string, form: SiteKnowledgeOccurrence['form']): void {
    if (siteIds.has(site))
      occurrences.push({
        file: input.file,
        line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        site,
        form,
      });
  }
  function key(name: ts.PropertyName): void {
    if (ts.isIdentifier(name)) record(name, name.text, 'key');
    else if (ts.isComputedPropertyName(name)) {
      const value = staticString(name.expression, true);
      if (value !== undefined) {
        record(name, value, 'key');
        staticTypes(name.expression);
      } else visit(name.expression);
    } else if (ts.isStringLiteralLike(name)) record(name, name.text, 'key');
  }
  // Folding an expression must not hide the separate string-literal types in its wrappers.
  function staticTypes(expression: ts.Node): void {
    const wrapped = unwrap(expression);
    if (wrapped) {
      if (wrapped.type) visit(wrapped.type);
      staticTypes(wrapped.expression);
    } else if (ts.isBinaryExpression(expression)) {
      staticTypes(expression.left);
      staticTypes(expression.right);
    } else if (ts.isTemplateExpression(expression))
      for (const span of expression.templateSpans) staticTypes(span.expression);
  }
  function modulePath(node: ts.Node): void {
    if (ts.isLiteralTypeNode(node)) return;
    if (staticString(node) !== undefined) {
      staticTypes(node);
      return;
    }
    const wrapped = unwrap(node);
    if (wrapped) {
      if (wrapped.type) visit(wrapped.type);
      modulePath(wrapped.expression);
    } else if (ts.isTemplateExpression(node)) {
      for (const span of node.templateSpans) modulePath(span.expression);
    } else if (
      ts.isBinaryExpression(node) &&
      (node.operatorToken.kind === ts.SyntaxKind.PlusToken ||
        node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
        node.operatorToken.kind === ts.SyntaxKind.BarBarToken)
    ) {
      modulePath(node.left);
      modulePath(node.right);
    } else if (ts.isConditionalExpression(node)) {
      visit(node.condition);
      modulePath(node.whenTrue);
      modulePath(node.whenFalse);
    } else scan(node);
  }
  function visit(node: ts.Node): void {
    if (isModulePath(node)) modulePath(node);
    else scan(node);
  }
  function concatenation(node: ts.BinaryExpression): void {
    let run: { node: ts.Node; text: string } | undefined;
    function flush(): void {
      if (run) record(run.node, run.text, 'literal');
      run = undefined;
    }
    function operand(part: ts.Node): void {
      const value = staticString(part);
      const wrapped = unwrap(part);
      if (value !== undefined) {
        if (run) run.text += value;
        else run = { node: part, text: value };
        staticTypes(part);
      } else if (
        ts.isBinaryExpression(part) &&
        part.operatorToken.kind === ts.SyntaxKind.PlusToken
      ) {
        operand(part.left);
        operand(part.right);
      } else if (wrapped) {
        if (wrapped.type) visit(wrapped.type);
        operand(wrapped.expression);
      } else {
        flush();
        visit(part);
      }
    }
    operand(node);
    flush();
  }
  function scan(node: ts.Node): void {
    if (ts.isPropertyAccessExpression(node)) {
      visit(node.expression);
      key(node.name);
      return;
    }
    if (ts.isElementAccessExpression(node)) {
      visit(node.expression);
      const value = staticString(node.argumentExpression, true);
      if (value !== undefined) {
        record(node.argumentExpression, value, 'key');
        staticTypes(node.argumentExpression);
      } else visit(node.argumentExpression);
      return;
    }
    if (
      ts.isPropertyAssignment(node) ||
      ts.isShorthandPropertyAssignment(node) ||
      ts.isPropertyDeclaration(node) ||
      ts.isPropertySignature(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isMethodSignature(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node) ||
      ts.isEnumMember(node)
    ) {
      key(node.name);
      ts.forEachChild(node, (child) => {
        if (child !== node.name) visit(child);
      });
      return;
    }
    if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
      const name =
        node.propertyName ??
        (!node.dotDotDotToken && ts.isIdentifier(node.name) ? node.name : undefined);
      if (name) key(name);
      ts.forEachChild(node, (child) => {
        if (child !== name) visit(child);
      });
      return;
    }
    if (ts.isQualifiedName(node)) {
      visit(node.left);
      key(node.right);
      return;
    }
    if (ts.isParameterPropertyDeclaration(node, node.parent)) {
      key(node.name);
      ts.forEachChild(node, (child) => {
        if (child !== node.name) visit(child);
      });
      return;
    }
    if (ts.isJsxAttribute(node)) {
      if (ts.isIdentifier(node.name)) key(node.name);
      if (node.initializer) visit(node.initializer);
      return;
    }
    const value = staticString(node);
    if (value !== undefined) {
      record(node, value, 'literal');
      staticTypes(node);
      return;
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      concatenation(node);
      return;
    }
    if (ts.isTemplateExpression(node)) {
      record(node.head, node.head.text, 'literal');
      for (const span of node.templateSpans) {
        visit(span.expression);
        record(span.literal, span.literal.text, 'literal');
      }
      return;
    }
    if (ts.isTemplateLiteralTypeNode(node)) {
      record(node.head, node.head.text, 'literal');
      for (const span of node.templateSpans) {
        visit(span.type);
        record(span.literal, span.literal.text, 'literal');
      }
      return;
    }
    ts.forEachChild(node, visit);
  }
  // SourceFile has no parent; its children do, as required by the syntax classifiers.
  ts.forEachChild(source, visit);
  return occurrences;
}
