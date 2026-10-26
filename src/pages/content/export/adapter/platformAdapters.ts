/**
 * Export adapter composition root.
 *
 * Host-specific DOM logic lives in one module per platform. Adding an exporter
 * takes a new platform module, its factory in `EXPORT_ADAPTER_FACTORIES`, and
 * its export site under the same id in `sites/resolveExportSite.ts` (the
 * `ExportHostId` type makes that second registration a compile error to skip).
 * Shared export services never check the host.
 */
import { SiteRegistry } from '@/features/plugins/sites/registry';
import type { SiteAdapter } from '@/features/plugins/types';

import { buildCatalogExportAdapter, hasCatalogExport } from './platform/catalog';
import { buildChatGptAdapter } from './platform/chatgpt';
import type { ExportPlatformAdapter } from './platform/contract';
import { buildGeminiAdapter } from './platform/gemini';
import { buildGenericExportAdapter } from './platform/generic';

export type { ExportPlatformAdapter } from './platform/contract';

type ExportAdapterFactory = (site: SiteAdapter) => ExportPlatformAdapter;

const EXPORT_ADAPTER_FACTORIES = {
  gemini: buildGeminiAdapter,
  chatgpt: buildChatGptAdapter,
  catalog: buildCatalogExportAdapter,
  generic: buildGenericExportAdapter,
} satisfies Record<string, ExportAdapterFactory>;

/** A site id with a registered exporter. */
export type ExportHostId = keyof typeof EXPORT_ADAPTER_FACTORIES;

export interface ExportHost {
  readonly id: ExportHostId;
  readonly adapter: ExportPlatformAdapter;
}

const siteRegistry = SiteRegistry.createDefault();

function isExportHostId(id: string): id is ExportHostId {
  return Object.hasOwn(EXPORT_ADAPTER_FACTORIES, id);
}

/**
 * The exporter for a bundled site: the packaged module registered under its id,
 * else the catalog exporter its `export` descriptor enables; null when it has
 * neither. Only for bundled adapters, whose id is not remote data.
 */
function exportHostForBundledSite(site: SiteAdapter): ExportHost | null {
  if (isExportHostId(site.id) && site.id !== 'catalog') {
    return { id: site.id, adapter: EXPORT_ADAPTER_FACTORIES[site.id](site) };
  }
  if (hasCatalogExport(site)) {
    return { id: 'catalog', adapter: buildCatalogExportAdapter(site) };
  }
  return null;
}

/**
 * The exporter `conversationExport` mounts for the page at `url` with the
 * plugin host's `site`, which may be a remote override. A packaged reader is
 * chosen by the bundled site the URL resolves to, never by `site.id`; the
 * override supplies that site's selectors only when it names the same id.
 */
export function exportHostForPage(
  site: SiteAdapter,
  url = window.location.href,
): ExportHost | null {
  const bundled = siteRegistry.resolveByUrl(url);
  if (bundled && isExportHostId(bundled.id) && bundled.id !== 'catalog') {
    // An override's id is untrusted data: `id: "gemini"` on ChatGPT must not mount Gemini's exporter.
    const data = site.id === bundled.id ? site : bundled;
    return { id: bundled.id, adapter: EXPORT_ADAPTER_FACTORIES[bundled.id](data) };
  }
  return hasCatalogExport(site)
    ? { id: 'catalog', adapter: buildCatalogExportAdapter(site) }
    : null;
}

/** The exporter registered for the current site. */
export function resolveExportHost(url = window.location.href): ExportHost {
  const site = siteRegistry.resolveByUrl(url);
  const host = site && exportHostForBundledSite(site);
  if (host) return host;

  // A catalog site without an exporter must not read its page with Gemini's rules.
  if (site) throw new Error('Conversation export is unavailable on this site');
  // Unknown hosts retain the historical reader without borrowing another site's online snapshot.
  return { id: 'generic', adapter: buildGenericExportAdapter() };
}

/** Resolve the export implementation for the current site. */
export function resolveExportAdapter(): ExportPlatformAdapter {
  return resolveExportHost().adapter;
}
