import { siteKnowledgeOccurrences } from './siteKnowledgeSyntax';
import type {
  SiteKnowledgeDiagnostic,
  SiteKnowledgeInput,
  SiteKnowledgeOccurrence,
  SiteKnowledgeOwner,
  SiteKnowledgeResult,
} from './siteKnowledgeTypes';

const TEST_HELPERS = new Set([
  'src/features/plugins/verbs/catalogConsumerFixture.ts',
  'src/features/timeline/adapters/catalog/sendTimestampsHarness.ts',
]);

export function isSiteKnowledgeSourceFile(file: string): boolean {
  return (
    file.startsWith('src/') &&
    /\.tsx?$/.test(file) &&
    !file.endsWith('.d.ts') &&
    !/(?:^|\/)(?:__tests__|__fixtures__)\//.test(file) &&
    !/\.(?:test|spec|fixtures)\.[^/]+$/.test(file) &&
    !/^src\/(?:tests|locales)\//.test(file) &&
    !TEST_HELPERS.has(file)
  );
}

function ownerMatchesFile(file: string, owner: SiteKnowledgeOwner): boolean {
  return owner.kind === 'directory' ? file.startsWith(`${owner.path}/`) : file === owner.path;
}

function ownsSite(file: string, site: string, owners: readonly SiteKnowledgeOwner[]): boolean {
  return owners.some(
    (owner) =>
      ownerMatchesFile(file, owner) &&
      (owner.kind === 'table' ? owner.sites.includes(site) : owner.site === site),
  );
}

/** Sources and reviewed policy in; exact-count diagnostics out, without filesystem access. */
export function inspectSiteKnowledge(input: SiteKnowledgeInput): SiteKnowledgeResult {
  const diagnostics: SiteKnowledgeDiagnostic[] = [];
  const ids = new Set(input.siteIds);
  const sources = input.sources.filter(({ file }) => isSiteKnowledgeSourceFile(file));
  const files = new Set(sources.map(({ file }) => file));
  const owners = input.owners.entries;
  function config(file: string, reason: string): void {
    diagnostics.push({ kind: 'config', file, line: 1, reason });
  }
  for (const owner of owners) {
    function ownerConfig(reason: string): void {
      config(input.owners.file, `${owner.path}: ${reason}`);
    }
    if (!owner.reason.trim()) ownerConfig('owner has an empty reason');
    if (/[*?[\]{}]/.test(owner.path) || owner.path.endsWith('/'))
      ownerConfig('owner path must be an exact file or directory without globs/trailing slash');
    if (owner.kind === 'directory' && owner.path.split('/').at(-1) !== owner.site)
      ownerConfig('directory owner must end with its site id');
    if (!sources.some(({ file }) => ownerMatchesFile(file, owner)))
      ownerConfig('owner path matches no scanned source file; remove or correct the owner');
    const sites = owner.kind === 'table' ? owner.sites : [owner.site];
    if (!sites.length) ownerConfig('owner must list at least one site id');
    for (const site of sites)
      if (!ids.has(site)) ownerConfig(`owner lists unknown site id ${JSON.stringify(site)}`);
  }
  const reviewed = new Map<string, Readonly<Record<string, number>>>();
  for (const table of input.exceptions)
    for (const entry of table.entries) {
      function exceptionConfig(reason: string): void {
        config(table.file, `${entry.file}: ${reason}`);
      }
      if (reviewed.has(entry.file)) exceptionConfig('duplicate site-knowledge exception entry');
      reviewed.set(entry.file, entry.values);
      if (!entry.reason.trim()) exceptionConfig('site-knowledge exception has an empty reason');
      if (!isSiteKnowledgeSourceFile(entry.file))
        exceptionConfig('site-knowledge exception file is outside the production scan set');
      if (!Object.keys(entry.values).length)
        exceptionConfig('empty site-knowledge exception; remove its entry');
      for (const [site, count] of Object.entries(entry.values)) {
        if (!ids.has(site))
          exceptionConfig(`exception lists unknown site id ${JSON.stringify(site)}`);
        if (!Number.isSafeInteger(count) || count <= 0)
          exceptionConfig(
            `exception for ${JSON.stringify(site)} must have a positive integer count`,
          );
        if (ownsSite(entry.file, site, owners))
          exceptionConfig(
            `exception for ${JSON.stringify(site)} duplicates an owner's own permission`,
          );
      }
    }
  const occurrences = sources.flatMap((source) => siteKnowledgeOccurrences(source, ids));
  const sharedOccurrences = occurrences.filter(({ file, site }) => !ownsSite(file, site, owners));
  const byFile = new Map<string, Map<string, SiteKnowledgeOccurrence[]>>();
  for (const occurrence of sharedOccurrences) {
    let sites = byFile.get(occurrence.file);
    if (!sites) byFile.set(occurrence.file, (sites = new Map()));
    const uses = sites.get(occurrence.site) ?? [];
    uses.push(occurrence);
    sites.set(occurrence.site, uses);
  }
  for (const [file, sites] of byFile)
    for (const [site, uses] of sites) {
      const expected = reviewed.get(file)?.[site] ?? 0;
      if (uses.length <= expected) continue;
      for (const use of uses)
        diagnostics.push({
          kind: expected ? 'growth' : 'unreviewed',
          file,
          line: use.line,
          reason: `site id ${JSON.stringify(site)} (${use.form}): ${uses.length} occurrences, ${expected} reviewed; move the knowledge to an owner, or add a reviewed exception with the exact count`,
        });
    }
  // Iterate all reviews, including missing files, so retired knowledge leaves no reusable budget.
  for (const [file, values] of reviewed)
    for (const [site, expected] of Object.entries(values)) {
      const uses = byFile.get(file)?.get(site) ?? [];
      if (uses.length >= expected) continue;
      const forms = ['literal', 'key']
        .filter((form) => uses.some((use) => use.form === form))
        .join(' and ');
      diagnostics.push({
        kind: 'stale',
        file,
        line: uses[0]?.line ?? 1,
        reason: `stale site-knowledge exception for ${JSON.stringify(site)}${forms ? ` (${forms})` : ''}: ${uses.length} occurrences, ${expected} reviewed; ${files.has(file) ? '' : 'file is gone; '}${uses.length ? 'lower the reviewed count in the same change' : 'remove this value (and its entry if empty)'}`,
      });
    }
  return { diagnostics, occurrences, sharedOccurrences, scannedFiles: sources.length };
}
