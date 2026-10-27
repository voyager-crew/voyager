/**
 * Bundled catalog discovery.
 *
 * Layout, one directory per site:
 *
 *   catalog/sites/<site>/site.json                 the adapter as data
 *   catalog/sites/<site>/plugins/<id>/plugin.json  a declarative plugin
 *   catalog/sites/<site>/plugins/<id>/*.css        its style files
 *
 * Everything is found with `import.meta.glob` at build time, so adding a site
 * or a plugin is adding files — there is no hand-maintained mapping table.
 * `marketplace.json` next to this folder is an index kept only for the docs
 * plugin store; a test keeps it in sync with what this module discovers.
 *
 * Gemini and AI Studio live here as data too, but they are not plugin
 * platforms: `NATIVE_SITE_IDS` and `hostPolicy` decide what runs there, and
 * their official plugins remain packaged and are not listed in the store.
 * Every site receives its own guarded locators through the shared catalog.
 *
 * Vite-only: `import.meta.glob` is not available under Bun or Node, so this
 * module stays a thin shell over `loadBundledSites.ts`.
 * `scripts/build-plugin-catalog.ts` reads the same files from disk, and the
 * `create-voyager-plugin` CLI build replaces this module with one fed from disk.
 */
import { logger } from '@/core/services/LoggerService';

import type { SiteAdapter } from '../../types';
import { type BundledSiteEntry, loadBundledSiteAdapters } from './loadBundledSites';

export type { BundledSiteEntry } from './loadBundledSites';

// The publisher stamps its site data from the same source revision as every browser build.
const catalogRevision = Number(import.meta.env.VOYAGER_CATALOG_REVISION);

const siteModules = import.meta.glob('./*/site.json', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const pluginModules = import.meta.glob('./*/plugins/*/plugin.json', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const styleModules = import.meta.glob('./*/plugins/*/*.css', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export interface BundledPluginEntry {
  readonly siteDir: string;
  /** Directory name under `plugins/`. */
  readonly pluginDir: string;
  /** Catalog-relative path of the manifest, e.g. `sites/claude/plugins/reading-width/plugin.json`. */
  readonly path: string;
  readonly manifestJson: string;
  /** Style files next to the manifest, keyed by file name. */
  readonly styles: Readonly<Record<string, string>>;
}

const SITE_PATH = /^\.\/([^/]+)\/site\.json$/;
const PLUGIN_PATH = /^\.\/([^/]+)\/plugins\/([^/]+)\/plugin\.json$/;
const STYLE_PATH = /^\.\/([^/]+)\/plugins\/([^/]+)\/([^/]+\.css)$/;

function catalogRelative(globPath: string): string {
  return `sites/${globPath.replace(/^\.\//, '')}`;
}

export function listBundledSiteEntries(): readonly BundledSiteEntry[] {
  return Object.keys(siteModules)
    .sort()
    .flatMap((path) => {
      const match = SITE_PATH.exec(path);
      return match
        ? [{ siteDir: match[1], path: catalogRelative(path), siteJson: siteModules[path] }]
        : [];
    });
}

export function listBundledPluginEntries(): readonly BundledPluginEntry[] {
  const stylesByPlugin = new Map<string, Record<string, string>>();
  for (const [path, css] of Object.entries(styleModules)) {
    const match = STYLE_PATH.exec(path);
    if (!match) continue;
    const key = `${match[1]}/${match[2]}`;
    const styles = stylesByPlugin.get(key) ?? {};
    styles[match[3]] = css;
    stylesByPlugin.set(key, styles);
  }
  return Object.keys(pluginModules)
    .sort()
    .flatMap((path) => {
      const match = PLUGIN_PATH.exec(path);
      if (!match) return [];
      return [
        {
          siteDir: match[1],
          pluginDir: match[2],
          path: catalogRelative(path),
          manifestJson: pluginModules[path],
          styles: stylesByPlugin.get(`${match[1]}/${match[2]}`) ?? {},
        },
      ];
    });
}

/** Validated adapters of every bundled site, in directory order. */
export const BUNDLED_SITE_ADAPTERS: readonly SiteAdapter[] = loadBundledSiteAdapters(
  listBundledSiteEntries(),
  { catalogRevision, onInvalid: (message, details) => logger.error(message, details) },
);

/**
 * The thin-shell adapters in `sites/adapters/` export these by id. A missing or
 * invalid site.json is a packaging error that must fail the test suite rather
 * than hand the runtime a silently different site. The throw happens at module
 * load, so for Gemini and AI Studio it would stop the whole content script:
 * `index.test.ts` is the guard.
 */
export function requireBundledSiteAdapter(id: string): SiteAdapter {
  const adapter = BUNDLED_SITE_ADAPTERS.find((entry) => entry.id === id);
  if (!adapter) throw new Error(`Bundled site adapter "${id}" is missing or invalid`);
  return adapter;
}
