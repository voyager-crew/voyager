import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import ts from 'typescript';

import { resolveEngineVersion } from '../../src/features/plugins/engineVersion';

interface EngineFile {
  readonly path: string;
  readonly source: string;
  readonly kind: 'contract' | 'baseline' | 'plugin';
}

export interface PluginEngineReleasePlan {
  readonly engineVersion: string | null;
  readonly updates: readonly { readonly path: string; readonly source: string }[];
}

interface VersionField {
  readonly start: number;
  readonly end: number;
  readonly value: string;
  readonly name: string;
}

function parseSource(file: EngineFile): ts.SourceFile {
  if (file.kind !== 'contract') {
    JSON.parse(file.source);
    return ts.parseJsonText(file.path, file.source);
  }
  return ts.createSourceFile(file.path, file.source, ts.ScriptTarget.Latest, true);
}

function engineFiles(root: string): EngineFile[] {
  const files: EngineFile[] = [];
  const verbs = join(root, 'src/features/plugins/verbs');
  const visited = new Set<string>();
  function addContractData(path: string): void {
    if (visited.has(path)) return;
    visited.add(path);
    const file: EngineFile = { path, source: readFileSync(path, 'utf8'), kind: 'contract' };
    files.push(file);
    for (const statement of parseSource(file).statements) {
      if (!ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement)) continue;
      if (ts.isImportDeclaration(statement) && statement.importClause?.isTypeOnly) continue;
      if (ts.isExportDeclaration(statement) && statement.isTypeOnly) continue;
      const specifier = statement.moduleSpecifier;
      if (!specifier || !ts.isStringLiteral(specifier) || !specifier.text.startsWith('.')) continue;
      const base = resolve(dirname(path), specifier.text.replace(/\.js$/, '.ts'));
      const dependency = [base, `${base}.ts`, join(base, 'index.ts')].find(
        (candidate) => candidate.endsWith('.ts') && existsSync(candidate),
      );
      if (!dependency || !dependency.startsWith(`${verbs}${sep}`)) {
        throw new Error(`${path}: cannot discover contract data import ${specifier.text}`);
      }
      addContractData(dependency);
    }
  }
  for (const entry of readdirSync(verbs, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    for (const name of ['contract.ts', 'paramsBaseline.json']) {
      const path = join(verbs, entry.name, name);
      if (!existsSync(path)) continue;
      if (name === 'contract.ts') addContractData(path);
      else files.push({ path, source: readFileSync(path, 'utf8'), kind: 'baseline' });
    }
  }

  function walkCatalog(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walkCatalog(path);
      else if (entry.name === 'plugin.json') {
        files.push({ path, source: readFileSync(path, 'utf8'), kind: 'plugin' });
      }
    }
  }
  walkCatalog(join(root, 'src/features/plugins/catalog'));
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function literalField(
  node: ts.Expression,
  source: ts.SourceFile,
  name: string,
): VersionField | null {
  while (
    ts.isAsExpression(node) ||
    ts.isParenthesizedExpression(node) ||
    ts.isSatisfiesExpression(node)
  ) {
    node = node.expression;
  }
  if (!ts.isStringLiteral(node) && !ts.isNoSubstitutionTemplateLiteral(node)) return null;
  return { start: node.getStart(source), end: node.end, value: node.text, name };
}

function propertyName(node: ts.PropertyName): string | null {
  return ts.isIdentifier(node) || ts.isStringLiteral(node) ? node.text : null;
}

function versionFields(file: EngineFile): VersionField[] {
  const source = parseSource(file);
  const fields: VersionField[] = [];
  function visit(node: ts.Node, path: readonly string[]): void {
    if (ts.isPropertyAssignment(node)) {
      const name = propertyName(node.name);
      const fieldPath = [...path, name ?? ''];
      const isVersion =
        file.kind === 'contract'
          ? name === 'sinceEngine'
          : file.kind === 'plugin'
            ? fieldPath.length === 1 && name === 'engine'
            : name === 'sinceEngine' &&
              (fieldPath.length === 1 || (fieldPath.length === 3 && fieldPath[0] === 'params'));
      if (isVersion) {
        const field = literalField(node.initializer, source, fieldPath.join('.'));
        if (field) fields.push(field);
      }
      visit(node.initializer, fieldPath);
      return;
    }
    ts.forEachChild(node, (child) => visit(child, path));
  }
  visit(source, []);
  return fields;
}

function isNext(value: string): boolean {
  return value.trim() === 'next' || value.trim() === '>=next';
}

function stampFields(
  file: EngineFile,
  fields: readonly VersionField[],
  releaseVersion: string,
): string {
  let result = file.source;
  for (const field of [...fields].sort((a, b) => b.start - a.start)) {
    if (!isNext(field.value)) continue;
    const quote = file.source[field.start];
    const value = resolveEngineVersion(field.value, releaseVersion);
    result = `${result.slice(0, field.start)}${quote}${value}${quote}${result.slice(field.end)}`;
  }
  return result;
}

/** Scan raw declarations, before the loader resolves unpublished versions. */
export function unreleasedPluginEngineIssues(root: string): string[] {
  const issues: string[] = [];
  for (const file of engineFiles(root)) {
    for (const field of versionFields(file)) {
      if (isNext(field.value)) {
        issues.push(`${relative(root, file.path)}: ${field.name}: ${field.value}`);
      }
    }
  }
  return issues;
}

/**
 * Stamp every `next` declaration with the extension version being released, the
 * version that ships it. Every replacement is prepared before any write, so
 * malformed data cannot partly stamp a release.
 */
export function preparePluginEngineRelease(
  root: string,
  releaseVersion: string,
): PluginEngineReleasePlan {
  const updates: { path: string; source: string }[] = [];
  for (const file of engineFiles(root)) {
    const source = stampFields(file, versionFields(file), releaseVersion);
    if (source !== file.source) updates.push({ path: file.path, source });
  }
  return { engineVersion: updates.length > 0 ? releaseVersion : null, updates };
}

export function applyPluginEngineRelease(plan: PluginEngineReleasePlan): void {
  for (const update of plan.updates) writeFileSync(update.path, update.source);
}
