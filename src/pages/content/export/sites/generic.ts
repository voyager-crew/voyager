import type { ExportPlatformAdapter } from '../adapter/platformAdapters';
import type { ExportSite } from '../exportSite';
import { createGeminiExportSite } from './gemini';

/** Reuse the existing export/star protocol, with the generic reader's own readiness profiles. */
export function createGenericExportSite(adapter: ExportPlatformAdapter): ExportSite {
  const site = createGeminiExportSite(adapter);
  if (site.entryPoints.kind !== 'gemini') return site;
  return {
    ...site,
    entryPoints: { ...site.entryPoints, userSelectors: adapter.getUserSelectors },
    history: {
      userSelectors: adapter.getUserSelectors,
      assistantSelectors: adapter.getAssistantSelectors,
    },
  };
}
