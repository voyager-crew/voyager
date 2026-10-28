/** Published packaged-host repairs, retaining full selectors for released-client compatibility. */
import type { SiteAdapterData } from '../sites/siteAdapterData';
import type { SiteAdapter } from '../types';

export type PackagedSiteRecord = Pick<
  SiteAdapterData,
  'catalogRevision' | 'id' | 'label' | 'matches' | 'theme' | 'selectors' | 'locators'
>;

/** Publish full selectors; current clients enforce the packaged overlay boundary when reading. */
export function packagedSiteRecordToData(adapter: SiteAdapter): PackagedSiteRecord {
  return {
    ...(adapter.catalogRevision !== undefined ? { catalogRevision: adapter.catalogRevision } : {}),
    id: adapter.id,
    label: adapter.label,
    matches: [...adapter.matches],
    theme: { ...adapter.theme },
    selectors: { ...adapter.selectors },
    ...(adapter.locators ? { locators: { ...adapter.locators } } : {}),
  };
}
