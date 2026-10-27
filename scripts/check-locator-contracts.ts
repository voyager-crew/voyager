import { readFileSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import ts from 'typescript';

import { getBundledSiteSelectorView } from '../src/core/selectors/bundle';
import { SITE_SELECTOR_CONTRACTS } from '../src/core/selectors/contracts';
import { readPublishedSiteLocators } from './lib/buildSiteLocators';
import { LOCATOR_LITERAL_EXCEPTIONS } from './lib/locatorLiteralExceptions';
import { selectorImportOwner } from './lib/selectorImportOwners';
import { inspectSiteFragmentOwnership } from './lib/siteFragmentOwnership';

const ROOT = process.cwd();
const TEST = /(?:^|\/)(?:__tests__|tests)\/|\.(?:test|spec)\.[cm]?[jt]sx?$/;

export interface LocatorViolation {
  readonly file: string;
  readonly line: number;
  readonly reason: string;
}

export function publishedLocatorValues(): ReadonlyMap<string, readonly string[]> {
  const values = new Map<string, string[]>();
  for (const [site, contract] of Object.entries(SITE_SELECTOR_CONTRACTS)) {
    const view = getBundledSiteSelectorView(site);
    for (const key of contract.keys) {
      const bundled = view.profiles[key];
      if (!bundled) throw new Error(`${site}:${key} has no bundled profile`);
      for (const value of bundled)
        values.set(value, [...(values.get(value) ?? []), `${site}:${key}`]);
    }
  }
  return values;
}

/** §6 DOM construction names are HTML protocol, never host lookup instructions. */
function isHtmlConstruction(node: ts.StringLiteralLike, file: string): boolean {
  if (!['textarea', 'h3', 'li', 'nav', 'form', 'main'].includes(node.text)) return false;
  const call = node.parent;
  if (!ts.isCallExpression(call)) return false;
  if (ts.isPropertyAccessExpression(call.expression))
    return call.expression.name.text === 'createElement' && call.arguments[0] === node;
  const index =
    file === 'src/features/plugins/verbs/siteCheck/panel.ts'
      ? 1
      : [
            'src/pages/content/researchPack/panel.ts',
            'src/pages/content/researchPack/templatesSection.ts',
          ].includes(file)
        ? 0
        : -1;
  return (
    index >= 0 &&
    ts.isIdentifier(call.expression) &&
    call.expression.text === 'el' &&
    call.arguments[index] === node
  );
}

function importedPath(node: ts.StringLiteralLike): boolean {
  return (
    ts.isImportDeclaration(node.parent) ||
    ts.isExternalModuleReference(node.parent) ||
    ts.isExportDeclaration(node.parent) ||
    (ts.isCallExpression(node.parent) &&
      (node.parent.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.parent.expression) && node.parent.expression.text === 'require')))
  );
}

function resolvedImport(file: string, specifier: string): string | null {
  const path = specifier.startsWith('@/')
    ? `src/${specifier.slice(2)}`
    : specifier.startsWith('@src/')
      ? `src/${specifier.slice(5)}`
      : specifier.startsWith('.')
        ? relative(ROOT, resolve(ROOT, file, '..', specifier))
        : null;
  return path?.replaceAll('\\', '/') ?? null;
}

export function inspectLocatorSource(
  file: string,
  text: string,
  values = publishedLocatorValues(),
): LocatorViolation[] {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const failures: LocatorViolation[] = [];
  function fail(node: ts.Node, reason: string) {
    failures.push({
      file,
      line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      reason,
    });
  }
  function visit(node: ts.Node): void {
    if (ts.isStringLiteralLike(node)) {
      const path = importedPath(node) ? resolvedImport(file, node.text) : null;
      const match = path?.match(
        /^src\/features\/plugins\/catalog\/sites\/([^/]+)\/selector-data\//,
      );
      const binding = ts.isImportDeclaration(node.parent)
        ? node.parent.importClause?.name?.text
        : undefined;
      if (match && !selectorImportOwner(file, match[1], binding))
        fail(node, `cross-site selector-data import ${node.text} (owner: ${match[1]})`);
      if (!TEST.test(file) && values.has(node.text) && !isHtmlConstruction(node, file)) {
        const exception = LOCATOR_LITERAL_EXCEPTIONS.find(
          (entry) => entry.file === file && entry.values.includes(node.text),
        );
        if (!exception)
          fail(
            node,
            `published locator ${JSON.stringify(node.text)} bypasses contract (${values.get(node.text)?.join(', ')})`,
          );
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return failures;
}

/** The publisher's site-owned fragment must be the data that site's runtime loader actually serves. */
export function inspectSiteLoaders(): LocatorViolation[] {
  const failures: LocatorViolation[] = [];
  for (const site of Object.keys(SITE_SELECTOR_CONTRACTS)) {
    const published = readPublishedSiteLocators(
      resolve(ROOT, 'src/features/plugins/catalog'),
      site,
    );
    const view = getBundledSiteSelectorView(site);
    for (const [key, expected] of Object.entries(published ?? {})) {
      if (JSON.stringify(view.profiles[key]) !== JSON.stringify(expected))
        failures.push({
          file: 'src/core/selectors/bundle.ts',
          line: 1,
          reason: `${site}:${key} does not load its own published fragment through the per-site loader`,
        });
    }
  }
  return failures;
}

export async function checkLocatorContracts(): Promise<readonly LocatorViolation[]> {
  const values = publishedLocatorValues();
  const failures = [...inspectSiteLoaders(), ...inspectSiteFragmentOwnership(ROOT)];
  const glob = new Bun.Glob('src/**/*.{ts,tsx}');
  for (const file of [...glob.scanSync({ cwd: ROOT })].sort()) {
    // Test fixtures may intentionally import multiple sites; shipped source has no such exception.
    if (TEST.test(file)) continue;
    failures.push(...inspectLocatorSource(file, readFileSync(resolve(ROOT, file), 'utf8'), values));
  }
  return failures;
}

if (import.meta.main) {
  const failures = await checkLocatorContracts();
  for (const failure of failures)
    console.error(`${failure.file}:${failure.line}: ${failure.reason}`);
  if (failures.length) process.exitCode = 1;
  else
    console.log('Locator contracts: published literals, site imports and per-site loaders pass.');
}
