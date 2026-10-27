import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import type { InputSiteId } from '@/core/services/composer/siteInputData';
import type { SiteAdapterData } from '@/features/plugins/sites/siteAdapterData';
import type { PluginManifest } from '@/features/plugins/types';

import type { BundledOffEntry } from './bundledOffData';

const CATALOG_ROOT = join(process.cwd(), 'src/features/plugins/catalog/sites');
// Semantic selectors are pinned separately; the loader stamps catalogRevision itself.
const SITE_RUNTIME_FIELDS = {
  id: true,
  matches: true,
  theme: true,
  brandColor: true,
  capabilities: true,
  conversationIdPattern: true,
  routeWords: true,
  turnKeyAttributes: true,
  export: true,
  modelPicker: true,
  projects: true,
  pageHooks: true,
  bridge: true,
  folders: true,
  locators: true,
} satisfies Record<Exclude<keyof SiteAdapterData, 'label' | 'selectors' | 'catalogRevision'>, true>;

type PluginMetadata =
  | 'version'
  | 'name'
  | 'description'
  | 'author'
  | 'category'
  | 'license'
  | 'homepage'
  | 'changelog'
  | 'i18n';

const PLUGIN_RUNTIME_FIELDS = {
  id: true,
  engine: true,
  tier: true,
  matches: true,
  contributes: true,
  theme: true,
  format: true,
  requires: true,
} satisfies Record<Exclude<keyof PluginManifest, PluginMetadata>, true>;

/** Project runtime inputs without pinning release copy or unconsumed JSON metadata. */
export function catalogRuntimeData(
  data: unknown,
  kind: 'site' | 'plugin',
): Record<string, unknown> {
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new Error(`Expected ${kind} catalog data`);
  const fields = kind === 'site' ? SITE_RUNTIME_FIELDS : PLUGIN_RUNTIME_FIELDS;
  // Keep nested settings, native params, style references and array order before validation.
  return Object.fromEntries(Object.entries(data).filter(([key]) => Object.hasOwn(fields, key)));
}

function runtimeData(file: string, kind: 'site' | 'plugin'): Record<string, unknown> {
  return catalogRuntimeData(JSON.parse(readFileSync(file, 'utf8')), kind);
}

/** Pin declared data before validation can default, drop or reorder a field. */
export function bundledOffCatalogData(site: InputSiteId): BundledOffEntry[] {
  const dir = join(CATALOG_ROOT, site);
  const entries: BundledOffEntry[] = [['site.json', runtimeData(join(dir, 'site.json'), 'site')]];
  const plugins = join(dir, 'plugins');
  for (const plugin of readdirSync(plugins, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()) {
    const file = `plugins/${plugin}/plugin.json`;
    entries.push([file, runtimeData(join(dir, file), 'plugin')]);
  }
  return entries;
}
