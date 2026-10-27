import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

import { getBundledSiteSelectorView } from '../src/core/selectors/bundle';
import { SITE_SELECTOR_CONTRACTS } from '../src/core/selectors/contracts';
import { readPublishedSiteLocators } from './lib/buildSiteLocators';
import { isHtmlConstruction } from './lib/locatorConstruction';
import { inspectLocatorImports, type ModuleReader } from './lib/locatorImports';
import { LOCATOR_LITERAL_EXCEPTIONS } from './lib/locatorLiteralExceptions';
import {
  locatorLiterals,
  matchedPublishedLocators,
  selectorListMembers,
} from './lib/locatorLiterals';
import { inspectSiteFragmentOwnership } from './lib/siteFragmentOwnership';

const ROOT = process.cwd();
const TEST = /(?:^|\/)__tests__\/|\.(?:test|spec)\.[cm]?[jt]sx?$/;

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
        for (const member of new Set([value, ...selectorListMembers(value)]))
          values.set(member, [...(values.get(member) ?? []), `${site}:${key}`]);
    }
  }
  return values;
}

export function inspectLocatorSource(
  file: string,
  text: string,
  values = publishedLocatorValues(),
  readModule?: ModuleReader,
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
  inspectLocatorImports(file, source, fail, readModule);
  if (TEST.test(file)) return failures;
  const literals = locatorLiterals(source)
    .filter(({ node, text }) => !isHtmlConstruction(node, file, text))
    .map((literal) => ({ literal, matched: matchedPublishedLocators(literal, values) }))
    .filter(({ matched }) => matched.length > 0);
  const counts = new Map<string, number>();
  for (const { matched } of literals)
    for (const value of matched) counts.set(value, (counts.get(value) ?? 0) + 1);
  for (const { literal, matched } of literals) {
    const unreviewed = matched.filter((value) => {
      const exception = LOCATOR_LITERAL_EXCEPTIONS.find(
        (entry) => entry.file === file && Object.hasOwn(entry.values, value),
      );
      return !exception || exception.values[value] !== counts.get(value);
    });
    if (!unreviewed.length) continue;
    const display = literal.text.length > 180 ? `${literal.text.slice(0, 177)}…` : literal.text;
    fail(
      literal.node,
      `published locator ${JSON.stringify(display)} bypasses contract (${unreviewed.map((value) => `${JSON.stringify(value)}: ${values.get(value)?.join(', ')}`).join('; ')}); missing review or reviewed occurrence count changed`,
    );
  }
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
    process.stdout.write(
      'Locator contracts: published literals, site imports and per-site loaders pass.\n',
    );
}
