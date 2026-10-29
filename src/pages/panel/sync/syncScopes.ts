import {
  type CloudSyncContext,
  type SyncPageLookup,
  resolveCloudSyncContext,
} from '@/core/services/CloudSyncTransferContext';
import type { SyncPlatform } from '@/core/types/sync';
import { FOLDER_PLATFORMS, isFolderPlatform } from '@/features/folder/platforms';
import type { TabRequester } from '@/pages/popup/hooks/currentTab';

/**
 * The sheet's rows on the shared transfer (src/core/services/CloudSyncTransfer.ts),
 * which decides each row's accounts and local data as the popup does. The panel
 * reaches only its own page, through its tab relay and never `tabs`.
 */
export interface SheetPage {
  readonly pageUrl: string;
  /** The page's own folder platform, or null on another website. */
  readonly ownPlatform: SyncPlatform | null;
  readonly requestTab: TabRequester | null;
}

/** The shared row travels with the page's platform when it carries shared data, else Gemini's. */
export function sharedRowPlatform(page: SheetPage): SyncPlatform {
  return page.ownPlatform && FOLDER_PLATFORMS[page.ownPlatform].syncsSharedData
    ? page.ownPlatform
    : 'gemini';
}

export function rowPlatform(row: string, page: SheetPage): SyncPlatform | null {
  if (row !== 'shared') return isFolderPlatform(row) ? row : null;
  return sharedRowPlatform(page);
}

/**
 * The page a row's transfer may read: the panel's own page for its own
 * platform, and none for another, so another site's page never names a row's
 * account (an isolated row elsewhere is `account_unconfirmed`).
 */
export function rowPage(page: SheetPage, platform: SyncPlatform): SyncPageLookup {
  const view =
    platform === page.ownPlatform
      ? {
          key: 'panel',
          url: page.pageUrl,
          ...(page.requestTab ? { ask: page.requestTab } : {}),
        }
      : undefined;
  return async () => view;
}

/** One row's transfer context; it throws when no page here names the row's account. */
export async function resolveRowContext(
  row: string,
  page: SheetPage,
  includeHighlights: boolean,
): Promise<CloudSyncContext> {
  const platform = rowPlatform(row, page);
  if (!platform) throw new Error('invalid_sync_request');
  const shared = row === 'shared';
  return resolveCloudSyncContext({
    platform,
    included: { site: !shared, shared },
    selection: shared ? 'shared' : 'site',
    // Highlights travel only with the page that names their account.
    includeHighlights: includeHighlights && platform === page.ownPlatform,
    page: rowPage(page, platform),
  });
}
