/** Popup download planning. Transport and storage owners keep their existing formats. */
import type { FolderData } from '@/core/types/folder';
import type { SyncAccountScope, SyncPlatform } from '@/core/types/sync';
import { FOLDER_PLATFORMS } from '@/features/folder/platforms';
import { createRuntimePromptLibraryClient } from '@/features/prompt/library/promptLibraryMessages';
import { PROMPT_LIBRARY_KEY } from '@/features/prompt/library/promptLibraryOwner';
import { StarredMessagesService } from '@/features/savedLibrary/StarredMessagesService';
import {
  type PulledCatalogTimeline,
  restorePulledCatalogTimeline,
} from '@/features/timeline/catalogTimelineCloud';
import type { TimelineHierarchyData } from '@/features/timeline/hierarchyTypes';
import { ForkNodesService } from '@/pages/content/fork/ForkNodesService';
import { mergeFolderData, mergeTimelineHierarchy } from '@/utils/merge';

import {
  type CloudApplyDownload,
  createCloudSyncApplyPlan,
  readCloudApplyPayloads,
  isCloudRecord,
} from './CloudSyncApplyPlan';
import {
  CloudRestoreError,
  type CloudRestoreMode,
  type CloudRestorePart,
  type CloudRestoreStep,
  applyCloudRestore,
} from './CloudSyncApplyService';
import { STAR_RESTORE_KEYS, planCatalogRestore, planForkRestore } from './CloudSyncRestoreKeys';
import type { SnapshotContext } from './CloudSyncSnapshotService';

export interface CloudDownloadData extends CloudApplyDownload {
  starred?: unknown;
  starredAccountHash?: string;
  stars?: unknown;
  forks?: unknown;
  /** Background-owned highlights can start the same snapshot before returning their result. */
  snapshotId?: string;
}

export interface PopupRestoreContext {
  payload: { platform: SyncPlatform; accountScope: SyncAccountScope | null };
  timelineHierarchyStorageKey: string;
}

type CatalogDownload =
  | { status: 'pulled'; value: PulledCatalogTimeline | null }
  | { status: 'failed'; error: unknown };
type Send = (message: { type: string; payload?: unknown }) => Promise<unknown>;

async function catalogOwner(send: Send, catalog: CatalogDownload): Promise<CloudRestoreStep[]> {
  if (catalog.status === 'failed') {
    return [{ parts: ['outlines'], keys: [], run: () => Promise.reject(catalog.error) }];
  }
  const pulled = catalog.value;
  if (!pulled) return [];
  const plan = await planCatalogRestore(pulled);
  return [
    {
      parts: ['outlines'],
      keys: plan.keys,
      run: async (snapshotId) => {
        const restored = plan.pulled
          ? await restorePulledCatalogTimeline(send, plan.pulled, snapshotId)
          : false;
        if (plan.refused) throw new Error('Could not restore timeline outlines');
        return restored || plan.hadOutlines;
      },
    },
  ];
}

export async function applyPopupCloudDownload(input: {
  context: PopupRestoreContext;
  local: {
    folders: FolderData;
    timelineHierarchy: TimelineHierarchyData;
    folderStorageKey: string;
    accountChanged: boolean;
  };
  data: CloudDownloadData;
  mode: CloudRestoreMode;
  highlightsRestored: boolean;
  catalog: CatalogDownload;
  send: Send;
  current?: () => Promise<boolean>;
  signal?: AbortSignal;
}) {
  const { context, local, data, mode } = input;
  const definition = FOLDER_PLATFORMS[context.payload.platform];
  const payloads = readCloudApplyPayloads(data);
  if (
    definition.folderExport &&
    data.folders &&
    (mode === 'merge' || payloads.folders.status === 'found')
  ) {
    const validated = definition.folderExport.read(data.folders, mode);
    if (!validated.ok) {
      if (mode === 'overwrite') payloads.folders = { status: 'unrecognized' };
      else
        throw new CloudRestoreError(
          [],
          ['folders'],
          new Error(`Invalid ${definition.folderExport.platform} folder backup`),
          validated.reason === 'wrong-site'
            ? 'folder_import_wrong_site'
            : 'folder_import_invalid_format',
        );
    } else payloads.folders = { status: 'found', value: validated.payload.data };
  }
  const plan = createCloudSyncApplyPlan({
    mode,
    payloads,
    shared: definition.syncsSharedData,
    conversationExtras: definition.syncsConversationExtras,
  });
  const storageUpdate: Record<string, unknown> = {};
  const storageParts: CloudRestorePart[] = [];
  const storageKinds: Record<string, CloudRestorePart> = {};
  // Missing is never converted to an empty overwrite; a recognized empty list still applies.
  if (plan.folders !== undefined || mode === 'merge') {
    storageUpdate[local.folderStorageKey] =
      mode === 'overwrite'
        ? plan.folders
        : mergeFolderData(local.folders, plan.folders ?? { folders: [], folderContents: {} });
    storageParts.push('folders');
    storageKinds[local.folderStorageKey] = 'folders';
  }
  if (
    definition.syncsConversationExtras &&
    (plan.timelineHierarchy !== undefined || mode === 'merge')
  ) {
    storageUpdate[context.timelineHierarchyStorageKey] =
      mode === 'overwrite'
        ? plan.timelineHierarchy
        : mergeTimelineHierarchy(
            local.timelineHierarchy,
            plan.timelineHierarchy ?? { conversations: {} },
          );
    if (!storageParts.includes('folders')) storageParts.push('hierarchy');
    storageKinds[context.timelineHierarchyStorageKey] = 'hierarchy';
  }
  const owners: CloudRestoreStep[] = [];
  let nameConflicts = 0;
  if (definition.syncsSharedData && (plan.prompts !== undefined || mode === 'merge')) {
    owners.push({
      parts: ['prompts'],
      keys: [{ area: 'local', key: PROMPT_LIBRARY_KEY }],
      run: async (snapshotId) => {
        if (
          mode === 'merge' &&
          payloads.prompts.status === 'unrecognized' &&
          isCloudRecord(data.prompts) &&
          data.prompts.items != null
        )
          throw new Error('Prompt library update failed: invalid_op');
        const result = await createRuntimePromptLibraryClient().apply({
          kind: 'restore',
          mode,
          items: plan.prompts ?? [],
          snapshotId,
        });
        nameConflicts = result.nameConflicts;
        return true;
      },
    });
  }
  if (
    definition.syncsConversationExtras &&
    [data.starred, data.stars].some((value) => value !== null && typeof value === 'object')
  ) {
    owners.push({
      parts: ['starred'],
      keys: STAR_RESTORE_KEYS,
      run: async (snapshotId) =>
        (
          await StarredMessagesService.mergeSync(
            { v1: data.starred, v2: data.stars, v1AccountHash: data.starredAccountHash },
            context.payload.accountScope,
            snapshotId,
          )
        ).status === 'merged',
    });
  }
  if (definition.syncsConversationExtras && data.forks && typeof data.forks === 'object') {
    const forks = await planForkRestore(data.forks);
    owners.push({
      parts: ['forks'],
      keys: forks.keys,
      run: async (snapshotId) =>
        forks.skip ||
        (await ForkNodesService.mergeCloud(
          isCloudRecord(data.forks)
            ? { ...data.forks, cloudSyncSnapshotId: snapshotId }
            : data.forks,
        )) === 'merged',
    });
  }
  owners.push(...(await catalogOwner(input.send, input.catalog)));
  const result = await applyCloudRestore({
    mode,
    highlightsRestored: input.highlightsRestored,
    plugins: plan.plugins,
    settings: plan.settings,
    storageUpdate,
    storageParts,
    storageKinds,
    owners,
    snapshot: {
      source: 'popup-restore',
      platform: context.payload.platform,
      accountScope: context.payload.accountScope,
    },
    snapshotId: data.snapshotId,
    skipped: plan.skipped,
    current: input.current,
    signal: input.signal,
    refusal: local.accountChanged
      ? new Error('The tab switched to another account during the download')
      : undefined,
  });
  return { ...result, foldersMissing: payloads.folders.status !== 'found', nameConflicts };
}

/** The no-aggregate-data popup path still snapshots the catalog owners it will run. */
export async function applyPopupCatalogDownload(input: {
  send: Send;
  catalog: PulledCatalogTimeline | null;
  snapshot: SnapshotContext;
  snapshotId?: string;
  current?: () => Promise<boolean>;
  signal?: AbortSignal;
}): Promise<boolean> {
  if (!input.catalog) return false;
  const result = await applyCloudRestore({
    mode: 'merge',
    highlightsRestored: false,
    storageUpdate: {},
    owners: await catalogOwner(input.send, { status: 'pulled', value: input.catalog }),
    snapshot: input.snapshot,
    snapshotId: input.snapshotId,
    current: input.current,
    signal: input.signal,
  });
  return result.restored.includes('outlines');
}
