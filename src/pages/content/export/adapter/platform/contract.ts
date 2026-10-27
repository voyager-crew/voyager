import type { ExportContentDialect } from '@/features/export/services/exportContentDialect';
import type { SiteAdapter } from '@/features/plugins/types';

import type { CanvasContentReader } from '../../canvasContent';

/**
 * How Voyager reads one host's conversation DOM: where turns are, and how
 * their content translates into export content.
 *
 * Platform modules translate host DOM into this contract. Shared export
 * services must not branch on a host name or depend on host-specific selectors.
 * How an export reaches the whole conversation is the export site's concern
 * (`sites/`).
 */
export interface ExportPlatformAdapter extends ExportContentDialect {
  readonly site: SiteAdapter;
  /** A compatibility reader can keep its own packaged content and Canvas profiles. */
  readonly selectAssistantExportElement?: (element: HTMLElement) => HTMLElement;
  readonly canvas?: CanvasContentReader;

  getUserSelectors: () => string[];
  getAssistantSelectors: () => string[];
  extractConversationTitle: () => string;
  extractConversationIdFromUrl: () => string | null;
  resolveConversationRoot: (userSelectors: string[], doc: Document) => HTMLElement;
}
