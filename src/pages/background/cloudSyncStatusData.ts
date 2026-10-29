import { buildScopedStorageKey } from '@/core/services/AccountIsolationService';
import type { SyncStatusFileRequest } from '@/core/services/CloudSyncBookkeeping';
import { selectSyncScopeStars } from '@/core/services/GoogleDriveStarScope';
import {
  FORKS_FILE_NAME,
  HIGHLIGHTS_FILE_NAME,
  PLUGINS_FILE_NAME,
  PROMPTS_FILE_NAME,
  SETTINGS_FILE_NAME,
  STARRED_FILE_NAME,
  STARS_FILE_NAME,
  TIMELINE_HIERARCHY_FILE_NAME,
} from '@/core/services/GoogleDriveSyncFileNames';
import {
  HighlightAnnotationService,
  highlightAnnotationService,
} from '@/core/services/HighlightAnnotationService';
import {
  exportBackupableSyncSettings,
  filterBackupableSyncSettings,
} from '@/core/services/SettingsBackupService';
import { legacyStarredExport } from '@/core/services/legacyStarredExport';
import { StorageKeys } from '@/core/types/common';
import type { SyncAccountScope, SyncPlatform } from '@/core/types/sync';
import { FOLDER_PLATFORMS } from '@/features/folder/platforms';
import { NATIVE_SITE_IDS } from '@/features/plugins/sites/registry';
import {
  catalogStarsFileName,
  selectCatalogSiteStars,
} from '@/features/savedLibrary/starSitePolicy';
import { buildStarsV2 } from '@/features/savedLibrary/starSyncPayload';
import {
  catalogTimelineFileName,
  collectCatalogTimelineBuckets,
  isCatalogSiteId,
} from '@/features/timeline/catalogHierarchySync';

import {
  filterForkNodesByRouteScope,
  loadTimelineHierarchyForSync,
  readPluginStateForSync,
} from './cloudSyncLocalData';
import {
  assertCatalogSyncStatusReadable,
  readStarsForSyncStatus,
} from './cloudSyncStatusValidation';
import type { CloudSyncReaders } from './cloudSyncUpload';
import { createForkMessagesOwner } from './forkMessages';
import { isHighlightCloudSyncRequested, isHighlightPlatform } from './highlightMessages';
import { normalizeLocalPromptsForSync } from './localPromptSyncData';

/** Completion checks and hashes the same captured storage view. */
export interface SyncStatusStorageView {
  local: Record<string, unknown>;
  sync: Record<string, unknown>;
}

export async function readSyncStatusRow(input: {
  row: string;
  platform: SyncPlatform;
  accountScope: SyncAccountScope | null;
  timelineScope: SyncAccountScope | null;
  highlightScope: SyncAccountScope | null;
  readers: CloudSyncReaders;
  captured?: SyncStatusStorageView;
}): Promise<SyncStatusFileRequest[]> {
  const { row, platform, accountScope, timelineScope, highlightScope, readers, captured } = input;
  const files: SyncStatusFileRequest[] = [];
  const add = (name: string, content: unknown, scope: SyncAccountScope | null = null) => {
    files.push({ row, name, content, accountScope: scope });
  };
  if (row === 'shared') {
    const values =
      captured?.local ??
      (await chrome.storage.local.get<Record<string, unknown>>(StorageKeys.PROMPT_ITEMS));
    add(
      PROMPTS_FILE_NAME,
      normalizeLocalPromptsForSync(values[StorageKeys.PROMPT_ITEMS]),
      accountScope,
    );
    add(
      SETTINGS_FILE_NAME,
      captured
        ? filterBackupableSyncSettings(captured.sync)
        : (await exportBackupableSyncSettings()).data,
    );
    add(PLUGINS_FILE_NAME, await readPluginStateForSync(captured?.local));
    return files;
  }
  const definition = FOLDER_PLATFORMS[platform];
  const folderKey = accountScope
    ? buildScopedStorageKey(definition.folderStorageKey, accountScope.accountKey)
    : definition.folderStorageKey;
  const stored =
    captured?.local ?? (await chrome.storage.local.get<Record<string, unknown>>(folderKey));
  let folders: unknown =
    stored[folderKey] === undefined ? { folders: [], folderContents: {} } : stored[folderKey];
  if (typeof folders === 'string') folders = JSON.parse(folders) as unknown;
  add(definition.driveFoldersFileName, folders, accountScope);
  if (definition.syncsConversationExtras) {
    const stars = selectSyncScopeStars(
      await readStarsForSyncStatus(accountScope, captured?.local),
      [],
      true,
    );
    add(STARS_FILE_NAME, buildStarsV2(stars, accountScope, ''), accountScope);
    add(STARRED_FILE_NAME, legacyStarredExport(stars.data), accountScope);
    const frozenArea = captured
      ? {
          get: async () => captured.local,
          set: async () => {
            throw new Error('status_is_read_only');
          },
        }
      : undefined;
    const forks = await (frozenArea
      ? createForkMessagesOwner(frozenArea).getAllForkNodes()
      : readers.getAllForkNodes());
    add(
      FORKS_FILE_NAME,
      accountScope ? filterForkNodesByRouteScope(forks, accountScope.routeUserId) : forks,
      accountScope,
    );
    add(
      TIMELINE_HIERARCHY_FILE_NAME,
      await loadTimelineHierarchyForSync(timelineScope, captured?.local),
      timelineScope ?? accountScope,
    );
    if (
      highlightScope &&
      isHighlightPlatform(platform) &&
      (captured
        ? captured.local[StorageKeys.HIGHLIGHT_CLOUD_SYNC_ENABLED] !== false
        : await isHighlightCloudSyncRequested(platform, false))
    ) {
      const owner = frozenArea
        ? new HighlightAnnotationService({ storage: { ...frozenArea, remove: frozenArea.set } })
        : highlightAnnotationService;
      const snapshot = await owner.getAccountSnapshot({
        ...highlightScope,
        platform,
      });
      add(
        HIGHLIGHTS_FILE_NAME,
        {
          format: 'gemini-voyager.annotations.v1',
          items: snapshot.records,
          clearMarker: snapshot.clearMarker,
        },
        highlightScope,
      );
    }
  } else if (isCatalogSiteId(platform) && !NATIVE_SITE_IDS.has(platform)) {
    files.push(...(await readCatalogSyncStatusRow(platform, captured)));
  }
  return files;
}

export async function readCatalogSyncStatusRow(
  site: string,
  captured?: SyncStatusStorageView,
): Promise<SyncStatusFileRequest[]> {
  const values = captured?.local ?? (await chrome.storage.local.get<Record<string, unknown>>(null));
  assertCatalogSyncStatusReadable(values, site);
  const bySite = collectCatalogTimelineBuckets(values, new Set([site]));
  return [
    { row: site, name: catalogTimelineFileName(site), content: bySite[site] ?? {} },
    {
      row: site,
      name: catalogStarsFileName(site),
      content: buildStarsV2(
        selectCatalogSiteStars(await readStarsForSyncStatus(null, values), site),
        null,
        '',
      ),
    },
  ];
}
