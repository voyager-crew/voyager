import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import ts from 'typescript';

import { selectorImportOwner, selectorPatternImportOwner } from './selectorImportOwners';
import { selectorReexportOwner } from './selectorReexportOwners';

export type ModuleReader = (file: string) => string | undefined;

const SELECTOR_DATA = /^src\/features\/plugins\/catalog\/sites\/([^/]+)\/selector-data\//;

function resolvePath(file: string, specifier: string): string | null {
  const aliases: Readonly<Record<string, string>> = {
    '@/': 'src/',
    '@src/': 'src/',
    '@pages/': 'src/pages/',
    '@assets/': 'src/assets/',
    '@locales/': 'src/locales/',
  };
  const alias = Object.entries(aliases).find(([prefix]) => specifier.startsWith(prefix));
  const target = alias
    ? alias[1] + specifier.slice(alias[0].length)
    : specifier.startsWith('.')
      ? resolve(file, '..', specifier)
      : null;
  return target === null ? null : relative(process.cwd(), resolve(target)).replaceAll('\\', '/');
}

const diskReader: ModuleReader = (file) =>
  existsSync(file) && statSync(file).isFile() ? readFileSync(file, 'utf8') : undefined;

/** Follow data re-exports, without treating guarded functions' implementation imports as data. */
function exportedSites(
  path: string,
  names: readonly string[],
  readModule: ModuleReader,
  visited = new Set<string>(),
  includeDefault = true,
): ReadonlySet<string> {
  const direct = path.match(SELECTOR_DATA);
  if (direct) return new Set([direct[1]]);
  const identity = `${path}:${names.join(',')}:${includeDefault}`;
  if (visited.has(identity)) return new Set();
  visited.add(identity);
  // TypeScript resolves emitted .js specifiers back to their source .ts/.tsx modules.
  const typedPath = /\.[cm]?jsx?$/.test(path)
    ? path
        .replace(/\.mjs$/, '.mts')
        .replace(/\.cjs$/, '.cts')
        .replace(/\.jsx?$/, '.ts')
    : null;
  const file = [
    ...(typedPath ? [typedPath, typedPath.replace(/\.ts$/, '.tsx')] : []),
    path,
    `${path}.ts`,
    `${path}.tsx`,
    `${path}.mts`,
    `${path}.cts`,
    `${path}/index.ts`,
    `${path}/index.tsx`,
  ]
    .map((file) => ({ file, text: readModule(file) }))
    .find(({ text }) => text !== undefined);
  if (!file || file.text === undefined) return new Set();
  const source = ts.createSourceFile(file.file, file.text, ts.ScriptTarget.Latest, true);
  const sites = new Set<string>();
  const imports = new Map<string, { path: string; name: string }>();
  const locals = new Map<string, ts.Expression>();
  const wanted = (name: string) =>
    (names.includes('*') && (name !== 'default' || includeDefault)) || names.includes(name);
  const add = (specifier: string, exported: readonly string[], defaults = true) => {
    const target = resolvePath(file.file, specifier);
    if (target)
      for (const site of exportedSites(target, exported, readModule, visited, defaults))
        sites.add(site);
  };
  function recordBinding(name: ts.BindingName, value: ts.Expression): void {
    if (ts.isIdentifier(name)) {
      locals.set(name.text, value);
      return;
    }
    name.elements.forEach((element, index) => {
      if (ts.isOmittedExpression(element)) return;
      const property =
        element.propertyName ?? (ts.isIdentifier(element.name) ? element.name : undefined);
      const key = ts.isArrayBindingPattern(name)
        ? ts.factory.createNumericLiteral(index)
        : property && ts.isComputedPropertyName(property)
          ? property.expression
          : property && 'text' in property
            ? ts.factory.createStringLiteral(property.text)
            : undefined;
      recordBinding(
        element.name,
        element.dotDotDotToken || !key
          ? value
          : ts.factory.createElementAccessExpression(value, key),
      );
    });
  }
  for (const statement of source.statements) {
    if (ts.isVariableStatement(statement))
      for (const declaration of statement.declarationList.declarations)
        if (declaration.initializer) recordBinding(declaration.name, declaration.initializer);
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    const clause = statement.importClause;
    if (clause?.name)
      imports.set(clause.name.text, { path: statement.moduleSpecifier.text, name: 'default' });
    const bindings = clause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings))
      imports.set(bindings.name.text, { path: statement.moduleSpecifier.text, name: '*' });
    else if (bindings)
      for (const binding of bindings.elements)
        imports.set(binding.name.text, {
          path: statement.moduleSpecifier.text,
          name: binding.propertyName?.text ?? binding.name.text,
        });
  }
  const seenLocals = new Set<string>();
  function addLocal(name: string): void {
    if (seenLocals.has(name)) return;
    seenLocals.add(name);
    const imported = imports.get(name);
    if (imported) add(imported.path, [imported.name]);
    const local = locals.get(name);
    if (local) addData(local);
  }
  function addData(expression: ts.Expression): void {
    if (ts.isIdentifier(expression)) addLocal(expression.text);
    else if (
      ts.isParenthesizedExpression(expression) ||
      ts.isAsExpression(expression) ||
      ts.isSatisfiesExpression(expression) ||
      ts.isNonNullExpression(expression)
    )
      addData(expression.expression);
    else if (
      ts.isPropertyAccessExpression(expression) ||
      ts.isElementAccessExpression(expression)
    ) {
      const member = ts.isPropertyAccessExpression(expression)
        ? expression.name.text
        : expression.argumentExpression && ts.isStringLiteralLike(expression.argumentExpression)
          ? expression.argumentExpression.text
          : '*';
      addMember(expression.expression, member);
    } else if (ts.isObjectLiteralExpression(expression)) {
      for (const property of expression.properties) {
        if (ts.isShorthandPropertyAssignment(property)) addLocal(property.name.text);
        else if (ts.isPropertyAssignment(property)) addData(property.initializer);
        else if (ts.isSpreadAssignment(property)) addData(property.expression);
      }
    } else if (ts.isArrayLiteralExpression(expression)) {
      for (const element of expression.elements)
        if (ts.isSpreadElement(element)) addData(element.expression);
        else if (!ts.isOmittedExpression(element)) addData(element);
    } else if (ts.isConditionalExpression(expression)) {
      addData(expression.whenTrue);
      addData(expression.whenFalse);
    }
  }
  function addMember(expression: ts.Expression, member: string, visited = new Set<string>()): void {
    if (ts.isIdentifier(expression)) {
      if (visited.has(expression.text)) return;
      visited.add(expression.text);
      const imported = imports.get(expression.text);
      if (imported?.name === '*') {
        add(imported.path, [member]);
        return;
      }
      const local = locals.get(expression.text);
      if (local) {
        addMember(local, member, visited);
        return;
      }
    }
    addData(expression);
  }
  function bindingNames(name: ts.BindingName): string[] {
    return ts.isIdentifier(name)
      ? [name.text]
      : name.elements.flatMap((element) =>
          ts.isOmittedExpression(element) ? [] : bindingNames(element.name),
        );
  }
  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement)) {
      const specifier = statement.moduleSpecifier;
      if (!statement.exportClause) {
        if (specifier && ts.isStringLiteral(specifier)) {
          const forwarded = names.filter((name) => name !== 'default');
          if (forwarded.length) add(specifier.text, forwarded, false);
        }
      } else if (ts.isNamedExports(statement.exportClause)) {
        for (const binding of statement.exportClause.elements) {
          if (!wanted(binding.name.text)) continue;
          const name = binding.propertyName?.text ?? binding.name.text;
          if (specifier && ts.isStringLiteral(specifier)) add(specifier.text, [name]);
          else addLocal(name);
        }
      } else if (
        wanted(statement.exportClause.name.text) &&
        specifier &&
        ts.isStringLiteral(specifier)
      )
        add(specifier.text, ['*']);
    } else if (ts.isExportAssignment(statement) && wanted('default')) addData(statement.expression);
    else if (
      ts.isVariableStatement(statement) &&
      statement.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)
    ) {
      for (const declaration of statement.declarationList.declarations)
        for (const name of bindingNames(declaration.name)) if (wanted(name)) addLocal(name);
    }
  }
  return sites;
}

function importedNames(node: ts.ImportDeclaration | ts.ExportDeclaration): string[] {
  if (ts.isExportDeclaration(node)) {
    if (!node.exportClause || ts.isNamespaceExport(node.exportClause)) return ['*'];
    return node.exportClause.elements.map(
      (binding) => binding.propertyName?.text ?? binding.name.text,
    );
  }
  const names = node.importClause?.name ? ['default'] : [];
  const bindings = node.importClause?.namedBindings;
  if (bindings && ts.isNamespaceImport(bindings)) names.push('*');
  else if (bindings)
    names.push(
      ...bindings.elements.map((binding) => binding.propertyName?.text ?? binding.name.text),
    );
  return names;
}

function isGlob(node: ts.Expression): boolean {
  return (
    ts.isPropertyAccessExpression(node) &&
    ['glob', 'globEager'].includes(node.name.text) &&
    ts.isMetaProperty(node.expression) &&
    node.expression.keywordToken === ts.SyntaxKind.ImportKeyword
  );
}

function patternText(node: ts.Node): string | null {
  if (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node)
  )
    return patternText(node.expression);
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isTemplateExpression(node))
    return (
      node.head.text +
      node.templateSpans
        .map((span) => (patternText(span.expression) ?? '*') + span.literal.text)
        .join('')
    );
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const left = patternText(node.left);
    const right = patternText(node.right);
    return left !== null || right !== null ? `${left ?? '*'}${right ?? '*'}` : null;
  }
  return null;
}

function patternSites(file: string, pattern: string): string[] {
  const path = resolvePath(file, pattern);
  if (!path) return [];
  const direct = path.match(SELECTOR_DATA);
  const sites = ['gemini', 'aistudio', 'chatgpt', 'claude', 'deepseek', 'kimi'];
  const expression = path
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*\//g, '(?:.*/)?')
    .replace(/\*\*/g, '.*')
    .replace(/(?<!\.)\*/g, '[^/]*');
  const matcher = new RegExp(`^${expression}$`);
  return sites.filter((site) => {
    const dir = `src/features/plugins/catalog/sites/${site}/selector-data`;
    return direct?.[1] === site || readdirSync(dir).some((name) => matcher.test(`${dir}/${name}`));
  });
}

export function inspectLocatorImports(
  file: string,
  source: ts.SourceFile,
  fail: (node: ts.Node, reason: string) => void,
  readModule: ModuleReader = diskReader,
): void {
  function check(
    node: ts.Node,
    specifier: string,
    names: readonly string[],
    binding?: string,
  ): void {
    const path = resolvePath(file, specifier);
    if (!path) return;
    for (const site of exportedSites(path, names, readModule))
      if (
        !(SELECTOR_DATA.test(path)
          ? selectorImportOwner(file, site, binding)
          : selectorReexportOwner(file, site, path.replace(/\.[cm]?[jt]sx?$/, ''), names, binding))
      )
        fail(
          node,
          `cross-site selector-data import ${specifier} (owner: ${site}, including re-exports)`,
        );
  }
  function visit(node: ts.Node): void {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      check(
        node.moduleSpecifier,
        node.moduleSpecifier.text,
        importedNames(node),
        ts.isImportDeclaration(node) ? node.importClause?.name?.text : undefined,
      );
    } else if (
      ts.isExternalModuleReference(node) &&
      node.expression &&
      ts.isStringLiteral(node.expression)
    ) {
      check(node.expression, node.expression.text, ['*']);
    } else if (ts.isCallExpression(node)) {
      const dynamic = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const glob = isGlob(node.expression);
      const requireCall = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if ((dynamic || glob || requireCall) && node.arguments[0]) {
        const targets = ts.isArrayLiteralExpression(node.arguments[0])
          ? node.arguments[0].elements
          : [node.arguments[0]];
        for (const target of targets) {
          const pattern = patternText(target);
          if (pattern === null) continue;
          const sites = patternSites(file, pattern);
          if (
            (dynamic || glob || (requireCall && !ts.isStringLiteralLike(target))) &&
            (sites.length || pattern.includes('selector-data'))
          ) {
            if (!sites.length || sites.some((site) => !selectorPatternImportOwner(file, site)))
              fail(
                target,
                `dynamic/glob selector-data import ${pattern} is outside its per-site loader`,
              );
          } else if (!glob) check(target, pattern, ['*']);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
}
