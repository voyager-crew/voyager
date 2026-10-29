import type { CatalogTimelineBuckets } from '@/features/timeline/catalogHierarchySync';

/** Explicit operation intent; omitted fields preserve the released service API. */
export interface DriveTransferSelection {
  site?: boolean;
  shared?: boolean;
  conversationExtras?: boolean;
  timelineHierarchy?: boolean;
  catalog?: {
    outlines: Record<string, CatalogTimelineBuckets>;
    starSites: readonly string[];
  };
  includedCatalogSites?: readonly string[];
}
