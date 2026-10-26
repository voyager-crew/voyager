import {
  getSiteSelectorView,
  withPageSemanticSelectors,
  type SiteSelectorView,
} from '@/core/selectors';
import { getSiteSelectorContract } from '@/core/selectors/contracts';
import { pageSemanticSelectorInView } from '@/core/selectors/semanticSnapshot';
import type { SiteAdapter } from '@/features/plugins/types';

const EXPORT_KEYS = [
  'userTurn',
  'assistantTurn',
  'thinkingBlock',
  'scrollContainer',
  'codeBlock',
] as const;

interface ExportSiteRead {
  readonly site: SiteAdapter;
  readonly remoteKeys: SiteSelectorView['remoteKeys'];
}

/** Freeze the claim's data while proving its remote reads against the current DOM. */
export function captureExportSite(
  site: SiteAdapter,
  doc: Document | undefined = typeof document === 'undefined' ? undefined : document,
): ExportSiteRead {
  const contract = getSiteSelectorContract(site.id);
  if (!contract) return { site, remoteKeys: new Set<string>() };
  const view = getSiteSelectorView(site.id);
  if (!doc || !EXPORT_KEYS.some((key) => view.remoteKeys.has(key))) {
    return { site: withPageSemanticSelectors(site, EXPORT_KEYS), remoteKeys: view.remoteKeys };
  }
  const original = { ...site.selectors };
  const selectors: Record<string, string> = { ...original };
  for (const key of EXPORT_KEYS) {
    // Catalog semantics outside the guarded migration retain their resolved override in both paths.
    if (!contract.keys.includes(key)) continue;
    Object.defineProperty(selectors, key, {
      enumerable: true,
      get: () => pageSemanticSelectorInView(key, view, doc) ?? original[key],
    });
  }
  return { site: { ...site, selectors }, remoteKeys: view.remoteKeys };
}

/** Export roles, roots and serialization share the page claim, never a later cached adapter. */
export function exportSiteSnapshot(site: SiteAdapter): SiteAdapter {
  return captureExportSite(site).site;
}
