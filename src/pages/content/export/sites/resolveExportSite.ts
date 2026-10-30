import type { SiteAdapter } from '@/features/plugins/types';

import type { ExportPlatformAdapter } from '../adapter/platformAdapters';
import {
  type ExportHostId,
  exportHostForPage,
  resolveExportHost,
} from '../adapter/platformAdapters';
import type { ExportSite } from '../exportSite';
import { createCatalogExportSite } from './catalogSite';
import { createChatGptExportSite } from './chatgpt';
import { createGeminiExportSite } from './gemini';
import { createGenericExportSite } from './generic';

/** One export site per registered exporter, keyed like the adapter factories. */
const EXPORT_SITE_FACTORIES: Record<ExportHostId, (adapter: ExportPlatformAdapter) => ExportSite> =
  {
    gemini: createGeminiExportSite,
    chatgpt: createChatGptExportSite,
    catalog: (adapter) => createCatalogExportSite(adapter.site),
    generic: createGenericExportSite,
  };

/** The conversation export for the current host. */
export function resolveExportSite(): ExportSite {
  const { id, adapter } = resolveExportHost();
  return EXPORT_SITE_FACTORIES[id](adapter);
}

/**
 * The export `conversationExport` mounts for a site adapter on the page at
 * `url`: the packaged reader of the bundled site there (Gemini's mounted page or
 * ChatGPT's full-thread crawl), else the catalog reader the adapter's `export` descriptor configures.
 * Null when there is neither, or a catalog site lacks the `conversationIdPattern`
 * its toolbar gate reads.
 */
export function exportSiteFor(site: SiteAdapter, url = location.href): ExportSite | null {
  const host = exportHostForPage(site, url);
  if (!host || (host.id === 'catalog' && !site.conversationIdPattern)) return null;
  return EXPORT_SITE_FACTORIES[host.id](host.adapter);
}
