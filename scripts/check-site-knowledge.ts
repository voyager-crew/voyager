import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { inspectSiteKnowledge, isSiteKnowledgeSourceFile } from './lib/siteKnowledge';
import { siteKnowledgeIds } from './lib/siteKnowledgeCatalog';
import { SITE_KNOWLEDGE_EXCEPTION_TABLES } from './lib/siteKnowledgeExceptions';
import { SITE_KNOWLEDGE_OWNERS } from './lib/siteKnowledgeOwners';
import type { SiteKnowledgeTables } from './lib/siteKnowledgeTypes';

const DEFAULT_TABLES: SiteKnowledgeTables = {
  owners: { file: 'scripts/lib/siteKnowledgeOwners.ts', entries: SITE_KNOWLEDGE_OWNERS },
  exceptions: SITE_KNOWLEDGE_EXCEPTION_TABLES,
};

export function checkSiteKnowledge(root = process.cwd(), tables = DEFAULT_TABLES) {
  const manifests = [
    ...new Bun.Glob('src/features/plugins/catalog/sites/*/site.json').scanSync({ cwd: root }),
  ]
    .sort()
    .map((file) => ({ file, text: readFileSync(resolve(root, file), 'utf8') }));
  const siteIds = siteKnowledgeIds(manifests);
  const sources = [...new Bun.Glob('src/**/*.{ts,tsx}').scanSync({ cwd: root })]
    .sort()
    .filter(isSiteKnowledgeSourceFile)
    .map((file) => ({ file, text: readFileSync(resolve(root, file), 'utf8') }));
  return {
    ...inspectSiteKnowledge({
      sources,
      siteIds,
      ...tables,
    }),
    siteCount: siteIds.length,
    exceptionCount: tables.exceptions.reduce((total, table) => total + table.entries.length, 0),
  };
}

export function runSiteKnowledgeCheck(
  args: readonly string[],
  root = process.cwd(),
  tables = DEFAULT_TABLES,
): number {
  try {
    if (args.length)
      throw new Error('Usage: bun scripts/check-site-knowledge.ts (read-only; no arguments)');
    const result = checkSiteKnowledge(root, tables);
    for (const diagnostic of result.diagnostics)
      console.error(`${diagnostic.file}:${diagnostic.line}: ${diagnostic.reason}`);
    if (result.diagnostics.length) return 1;
    const literals = result.occurrences.filter(({ form }) => form === 'literal').length;
    const keys = result.occurrences.length - literals;
    const owned = result.occurrences.length - result.sharedOccurrences.length;
    process.stdout.write(
      `Site knowledge: ${result.scannedFiles} files, ${result.siteCount} site ids; ${result.occurrences.length} occurrences (${literals} literal, ${keys} key), ${owned} owned, ${result.sharedOccurrences.length} reviewed in ${result.exceptionCount} exception entries.\n`,
    );
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

if (import.meta.main) process.exitCode = runSiteKnowledgeCheck(process.argv.slice(2));
