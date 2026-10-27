import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { InputSiteId } from '@/core/services/composer/siteInputData';

import type { BundledOffEntry } from './bundledOffData';

const CATALOG_ROOT = join(process.cwd(), 'src/features/plugins/catalog/sites');
// Semantic selectors already have OFF snapshots; schema and display copy do not drive the page.
const SITE_OMITTED_FIELDS = new Set(['$schema', 'label', 'selectors']);
const PLUGIN_DISPLAY_FIELDS = new Set([
  '$schema',
  'name',
  'description',
  'author',
  'category',
  'license',
  'homepage',
  'changelog',
  'i18n',
]);

function runtimeData(file: string, omitted: ReadonlySet<string>): Record<string, unknown> {
  const data: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new Error(`Expected catalog data: ${file}`);
  // Keep nested data and every array intact, including unknown future runtime fields.
  return Object.fromEntries(Object.entries(data).filter(([key]) => !omitted.has(key)));
}

/** Pin declared data before validation can default, drop or reorder a field. */
export function bundledOffCatalogData(site: InputSiteId): BundledOffEntry[] {
  const dir = join(CATALOG_ROOT, site);
  const entries: BundledOffEntry[] = [
    ['site.json', runtimeData(join(dir, 'site.json'), SITE_OMITTED_FIELDS)],
  ];
  const plugins = join(dir, 'plugins');
  for (const plugin of readdirSync(plugins, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()) {
    const file = `plugins/${plugin}/plugin.json`;
    entries.push([file, runtimeData(join(dir, file), PLUGIN_DISPLAY_FIELDS)]);
  }
  return entries;
}
