import { resolve } from 'node:path';
import ts from 'typescript';
import { build } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';

export interface PanelApiViolation {
  readonly file: string;
  readonly line: number;
  readonly reason: string;
}

const HOST = 1;
const API = 2;
const FORBIDDEN = 4;
const MODULE = 8;
const PROMISE = 16;
const CONTAINS_API = 32;
type MemberAccess = ts.PropertyAccessExpression | ts.ElementAccessExpression;

interface PanelGraphModule {
  readonly text: string;
  readonly imports: ReadonlyMap<string, string>;
}

function parseSource(file: string, text: string) {
  return ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function isPolyfillImport(value: string) {
  return /^webextension-polyfill(?:\/dist\/browser-polyfill(?:\.min)?\.js)?$/.test(value);
}

/** Share symbols across the graph so imports keep their API identity through re-exports. */
function inspectPanelGraph(modules: ReadonlyMap<string, PanelGraphModule>): PanelApiViolation[] {
  const options: ts.CompilerOptions = { allowJs: true, noLib: true, noResolve: true };
  // Vite virtual ids can contain nulls and queries; give the compiler stable file paths.
  const names = new Map(
    [...modules.keys()].map((file, index) => [
      file,
      `/panel-graph/${index}${file.endsWith('.tsx') ? '.tsx' : '.ts'}`,
    ]),
  );
  const originals = new Map([...names].map(([file, name]) => [name, file]));
  const sources = new Map(
    [...names].map(([file, name]) => [name, parseSource(name, modules.get(file)!.text)]),
  );
  const host = ts.createCompilerHost(options);
  host.getSourceFile = (name) => sources.get(name);
  host.resolveModuleNames = (imports, importer) =>
    imports.map((specifier) => {
      const original = originals.get(importer);
      const target = original && modules.get(original)?.imports.get(specifier);
      const resolvedFileName = target && names.get(target);
      return resolvedFileName ? { resolvedFileName } : undefined;
    });
  const checker = ts.createProgram([...sources.keys()], options, host).getTypeChecker();
  // Property lookups can synthesize a new Symbol on each pass. Source declarations are
  // stable, finite identities, so following wrappers must converge even for inferred objects.
  const aliases = new Map<ts.Declaration, number>();
  const propertyAliases = new Map<ts.Node, Map<string, number>>();
  const returnedValues = new Map<NonNullable<ts.Signature['declaration']>, number>();
  const returnExpressions = new Map<ts.SignatureDeclaration, readonly ts.Expression[]>();
  const forbiddenBindings = new Map<ts.Node, string>();
  let changed = false;
  const nodes: ts.Node[] = [];
  function collect(node: ts.Node) {
    nodes.push(node);
    ts.forEachChild(node, collect);
  }
  for (const source of sources.values()) collect(source);

  for (const node of nodes) {
    if (
      !(
        ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isGetAccessorDeclaration(node)
      ) ||
      !node.body
    )
      continue;
    const expressions: ts.Expression[] = [];
    function collectReturns(child: ts.Node) {
      // A nested callback's return belongs to that function, not the enclosing factory.
      if (ts.isFunctionLike(child)) return;
      if (ts.isReturnStatement(child) && child.expression) expressions.push(child.expression);
      else ts.forEachChild(child, collectReturns);
    }
    if (ts.isBlock(node.body)) collectReturns(node.body);
    else expressions.push(node.body);
    returnExpressions.set(node, expressions);
  }

  function symbolValue(symbol: ts.Symbol | undefined): number {
    let value = 0;
    const visited = new Set<ts.Symbol>();
    while (symbol && !visited.has(symbol)) {
      visited.add(symbol);
      for (const declaration of symbol.declarations ?? []) value |= aliases.get(declaration) ?? 0;
      symbol =
        symbol.flags & ts.SymbolFlags.Alias ? checker.getImmediateAliasedSymbol(symbol) : undefined;
    }
    return value;
  }

  function staticKey(expression: ts.Expression): string | undefined {
    if (ts.isStringLiteralLike(expression)) return expression.text;
    const type = checker.getTypeAtLocation(expression);
    return type.isStringLiteral() ? type.value : undefined;
  }

  function property(name: ts.PropertyName | undefined): string | undefined {
    if (!name) return undefined;
    if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
    if (ts.isComputedPropertyName(name)) return staticKey(name.expression);
    return undefined;
  }

  function member(parent: number, name: string | undefined): number {
    return (
      (parent & FORBIDDEN) |
      (parent & MODULE && name === 'default' ? API : 0) |
      (parent & HOST && (name === 'chrome' || name === 'browser') ? API : 0) |
      (parent & API && (name === 'tabs' || name === 'windows') ? FORBIDDEN : 0)
    );
  }

  function identifierValue(name: string, symbol: ts.Symbol | undefined): number {
    // TypeScript gives globalThis a builtin symbol even without DOM libraries.
    // Only source declarations shadow the real browser globals.
    if (symbol?.declarations?.length) return symbolValue(symbol);
    if (name === 'chrome' || name === 'browser') return API;
    if (name === 'window' || name === 'globalThis' || name === 'self') return HOST;
    return 0;
  }

  function accessKey(node: MemberAccess): string | undefined {
    return ts.isPropertyAccessExpression(node)
      ? node.name.text
      : staticKey(node.argumentExpression);
  }

  function objectDeclarations(node: ts.Expression): readonly ts.Node[] {
    return (
      checker.getTypeAtLocation(node).getSymbol()?.declarations ??
      checker.getSymbolAtLocation(node)?.declarations ??
      []
    );
  }

  function accessSymbol(node: MemberAccess): ts.Symbol | undefined {
    const key = accessKey(node);
    return key === undefined
      ? undefined
      : checker.getPropertyOfType(checker.getTypeAtLocation(node.expression), key);
  }

  function containerValue(node: ts.Expression): number {
    for (const owner of objectDeclarations(node))
      for (const value of propertyAliases.get(owner)?.values() ?? [])
        if (value & (API | CONTAINS_API)) return CONTAINS_API;
    return 0;
  }

  function thenCallback(node: ts.CallExpression) {
    const access = node.expression;
    if (
      !(ts.isPropertyAccessExpression(access) || ts.isElementAccessExpression(access)) ||
      accessKey(access) !== 'then'
    )
      return null;
    const input = reference(access.expression);
    if (!(input & PROMISE)) return null;
    const callback = node.arguments[0];
    const declarations = callback
      ? checker
          .getTypeAtLocation(callback)
          .getCallSignatures()
          .flatMap((signature) => (signature.declaration ? [signature.declaration] : []))
      : [];
    return { input: input & ~PROMISE, declarations };
  }

  function reference(node: ts.Expression): number {
    if (ts.isIdentifier(node)) {
      return identifierValue(node.text, checker.getSymbolAtLocation(node)) | containerValue(node);
    }
    if (ts.isObjectLiteralExpression(node))
      return checker
        .getTypeAtLocation(node)
        .getProperties()
        .some((symbol) => symbolValue(symbol) & (API | CONTAINS_API))
        ? CONTAINS_API
        : 0;
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const name = accessKey(node);
      let value = symbolValue(accessSymbol(node)) | member(reference(node.expression), name);
      if (name !== undefined)
        for (const owner of objectDeclarations(node.expression))
          value |= propertyAliases.get(owner)?.get(name) ?? 0;
      return value;
    }
    if (ts.isAwaitExpression(node)) return reference(node.expression) & ~PROMISE;
    if (
      ts.isParenthesizedExpression(node) ||
      ts.isAsExpression(node) ||
      ts.isTypeAssertionExpression(node) ||
      ts.isSatisfiesExpression(node) ||
      ts.isNonNullExpression(node)
    )
      return reference(node.expression);
    if (ts.isCallExpression(node)) {
      const specifier = node.arguments[0];
      if (
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        specifier &&
        isPolyfillImport(staticKey(specifier) ?? '')
      )
        return API | MODULE | PROMISE;
      const callback = thenCallback(node);
      if (callback)
        return (
          PROMISE |
          callback.declarations.reduce(
            (value, declaration) => value | (returnedValues.get(declaration) ?? 0),
            node.arguments[0] ? 0 : callback.input,
          )
        );
      const declaration = checker.getResolvedSignature(node)?.declaration;
      return declaration ? (returnedValues.get(declaration) ?? 0) : 0;
    }
    if (ts.isConditionalExpression(node))
      return reference(node.whenTrue) | reference(node.whenFalse);
    if (ts.isBinaryExpression(node)) return reference(node.left) | reference(node.right);
    return 0;
  }

  function bindSymbol(symbol: ts.Symbol | undefined, value: number) {
    for (const declaration of symbol?.declarations ?? []) {
      const previous = aliases.get(declaration) ?? 0;
      if ((previous | value) !== previous) {
        aliases.set(declaration, previous | value);
        changed = true;
      }
    }
  }

  function bindProperty(
    target: ts.Node,
    name: string | undefined,
    value: number,
    node: ts.Node,
    sourceType?: ts.Type,
  ) {
    if (value & API && (name === 'tabs' || name === 'windows')) forbiddenBindings.set(node, name);
    const symbol = sourceType && name ? checker.getPropertyOfType(sourceType, name) : undefined;
    bind(
      target,
      member(value, name) | symbolValue(symbol),
      symbol ? checker.getTypeOfSymbolAtLocation(symbol, node) : undefined,
    );
  }

  function bind(name: ts.Node, value: number, sourceType?: ts.Type) {
    if (ts.isIdentifier(name)) {
      bindSymbol(checker.getSymbolAtLocation(name), value);
    } else if (ts.isPropertyAccessExpression(name) || ts.isElementAccessExpression(name)) {
      bindSymbol(accessSymbol(name), value);
      const key = accessKey(name);
      // Untyped object expandos have no property Symbol; dot and bracket writes share a slot.
      if (key !== undefined && value)
        for (const owner of objectDeclarations(name.expression)) {
          const properties = propertyAliases.get(owner) ?? new Map<string, number>();
          const previous = properties.get(key) ?? 0;
          if ((previous | value) !== previous) {
            properties.set(key, previous | value);
            propertyAliases.set(owner, properties);
            changed = true;
          }
        }
    } else if (ts.isObjectBindingPattern(name)) {
      for (const element of name.elements) {
        if (element.dotDotDotToken) bind(element.name, value, sourceType);
        else
          bindProperty(
            element.name,
            property(
              element.propertyName ?? (ts.isIdentifier(element.name) ? element.name : undefined),
            ),
            value,
            element,
            sourceType,
          );
      }
    } else if (ts.isObjectLiteralExpression(name)) {
      for (const element of name.properties) {
        if (ts.isSpreadAssignment(element)) bind(element.expression, value, sourceType);
        if (ts.isShorthandPropertyAssignment(element))
          bindProperty(element.name, property(element.name), value, element, sourceType);
        if (ts.isPropertyAssignment(element))
          bindProperty(element.initializer, property(element.name), value, element, sourceType);
      }
    } else if (
      ts.isBinaryExpression(name) &&
      name.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      bind(name.left, value, sourceType);
    }
  }

  // CommonJS bundling erases this import's API identity. Seed original graph
  // imports and direct re-exports before following aliases through the shared checker.
  for (const node of nodes) {
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      isPolyfillImport(node.moduleSpecifier.text) &&
      node.importClause &&
      !node.importClause.isTypeOnly
    ) {
      const clause = node.importClause;
      if (clause.name) bind(clause.name, API);
      const bindings = clause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) bind(bindings.name, API | MODULE);
      if (bindings && ts.isNamedImports(bindings))
        for (const element of bindings.elements) {
          if (element.isTypeOnly) continue;
          const name = property(element.propertyName ?? element.name);
          if (name === 'default') bind(element.name, API);
          else bindProperty(element.name, name, API, element);
        }
    }
    if (
      ts.isExportDeclaration(node) &&
      !node.isTypeOnly &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      isPolyfillImport(node.moduleSpecifier.text) &&
      node.exportClause &&
      ts.isNamedExports(node.exportClause)
    )
      for (const element of node.exportClause.elements) {
        if (element.isTypeOnly) continue;
        const name = property(element.propertyName ?? element.name);
        if (name === 'default') bind(element.name, API);
        else bindProperty(element.name, name, API, element);
      }
  }

  // A finite fixed point tracks aliases, property slots and known function returns. Otherwise
  // wrapping chrome in an object or factory erases the same provenance as a plain alias.
  do {
    changed = false;
    for (const node of nodes) {
      if (ts.isCallExpression(node)) {
        const callback = thenCallback(node);
        if (callback)
          for (const declaration of callback.declarations) {
            const parameter = declaration.parameters[0];
            if (parameter) bind(parameter.name, callback.input);
          }
      }
      if (ts.isPropertyAssignment(node) || ts.isShorthandPropertyAssignment(node)) {
        const name = property(node.name);
        const symbol = name
          ? checker.getPropertyOfType(checker.getTypeAtLocation(node.parent), name)
          : undefined;
        const value = ts.isPropertyAssignment(node)
          ? reference(node.initializer)
          : identifierValue(node.name.text, checker.getShorthandAssignmentValueSymbol(node));
        bindSymbol(symbol, value);
      }
      if (ts.isVariableDeclaration(node) && node.initializer)
        bind(
          node.name,
          reference(node.initializer),
          ts.isObjectBindingPattern(node.name)
            ? checker.getTypeAtLocation(node.initializer)
            : undefined,
        );
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken)
        bind(
          node.left,
          reference(node.right),
          ts.isObjectLiteralExpression(node.left)
            ? checker.getTypeAtLocation(node.right)
            : undefined,
        );
    }
    for (const [declaration, expressions] of returnExpressions) {
      const previous = returnedValues.get(declaration) ?? 0;
      const value = expressions.reduce(
        (value, expression) => value | reference(expression),
        previous,
      );
      if (value !== previous) {
        returnedValues.set(declaration, value);
        changed = true;
      }
      if (ts.isGetAccessorDeclaration(declaration))
        bindSymbol(checker.getSymbolAtLocation(declaration.name), value);
    }
  } while (changed);

  const failures: PanelApiViolation[] = [];
  function fail(node: ts.Node, name: string | undefined) {
    const source = node.getSourceFile();
    failures.push({
      file: originals.get(source.fileName) ?? source.fileName,
      line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      reason: `panel module graph accesses forbidden browser API ${name ?? 'tabs/windows'}`,
    });
  }
  for (const node of nodes) {
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const name = accessKey(node);
      // Unknown keys on an extension API can be tabs/windows; only proven literal keys are safe.
      const value = reference(node.expression);
      if (
        (value & API && (name === 'tabs' || name === 'windows')) ||
        (name === undefined && value & (API | CONTAINS_API))
      )
        fail(node, name);
    }
  }
  for (const [node, name] of forbiddenBindings) fail(node, name);
  return failures;
}

/** Namespace access is forbidden too: extracting an alias must not hide a later call. */
export function inspectPanelSource(file: string, text: string): PanelApiViolation[] {
  return inspectPanelGraph(new Map([[file, { text, imports: new Map() }]]));
}

/** Bundle the actual page graph, including Vite glob/dynamic imports; write no build artifacts. */
export async function checkPanelApis(
  entry = resolve(process.cwd(), 'src/pages/panel/index.tsx'),
): Promise<readonly PanelApiViolation[]> {
  const failures: PanelApiViolation[] = [];
  const modules = new Map<string, PanelGraphModule>();
  await build({
    configFile: false,
    envFile: false,
    logLevel: 'silent',
    plugins: [
      tsconfigPaths(),
      {
        name: 'panel-api-contract',
        enforce: 'pre',
        async transform(code, id) {
          if (!/\.[cm]?[jt]sx?(?:\?|$)/.test(id)) return;
          const imports = new Map<string, string>();
          await Promise.all(
            parseSource(id, code).statements.map(async (node) => {
              if (
                (!ts.isImportDeclaration(node) && !ts.isExportDeclaration(node)) ||
                (ts.isImportDeclaration(node) && node.importClause?.isTypeOnly) ||
                (ts.isExportDeclaration(node) && node.isTypeOnly) ||
                !node.moduleSpecifier ||
                !ts.isStringLiteral(node.moduleSpecifier)
              )
                return;
              const specifier = node.moduleSpecifier.text;
              const target = await this.resolve(specifier, id);
              if (target) imports.set(specifier, target.id);
            }),
          );
          modules.set(id, { text: code, imports });
        },
        generateBundle(_options, bundle) {
          failures.push(...inspectPanelGraph(modules));
          for (const output of Object.values(bundle))
            if (output.type === 'chunk')
              failures.push(...inspectPanelSource(output.fileName, output.code));
        },
      },
    ],
    esbuild: { jsx: 'automatic' },
    build: {
      write: false,
      minify: false,
      reportCompressedSize: false,
      rollupOptions: {
        input: entry,
        treeshake: false,
        output: { inlineDynamicImports: true },
      },
    },
  });
  return failures;
}

if (import.meta.main) {
  const failures = await checkPanelApis(process.argv[2]);
  for (const failure of failures)
    console.error(`${failure.file}:${failure.line}: ${failure.reason}`);
  if (failures.length) process.exitCode = 1;
  else process.stdout.write('Panel API contract: no tabs or windows access in the page graph.\n');
}
