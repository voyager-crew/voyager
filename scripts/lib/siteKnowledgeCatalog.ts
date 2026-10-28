import type { SiteKnowledgeSource } from './siteKnowledgeTypes';

/** Parse only the id field this gate consumes; the catalog validator owns the rest. */
export function siteKnowledgeIds(manifests: readonly SiteKnowledgeSource[]): readonly string[] {
  if (!manifests.length) throw new Error('No bundled catalog/sites/*/site.json files found');
  const ids = new Set<string>();
  for (const manifest of manifests) {
    let data: unknown;
    try {
      data = JSON.parse(manifest.text);
    } catch {
      throw new Error(`${manifest.file}:1: invalid site.json JSON`);
    }
    if (
      typeof data !== 'object' ||
      data === null ||
      !('id' in data) ||
      typeof data.id !== 'string' ||
      !data.id.trim()
    )
      throw new Error(`${manifest.file}:1: site.json must declare a non-empty string id`);
    if (ids.has(data.id))
      throw new Error(`${manifest.file}:1: duplicate bundled site id ${JSON.stringify(data.id)}`);
    ids.add(data.id);
  }
  return [...ids].sort();
}
