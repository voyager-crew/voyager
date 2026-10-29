import { accountIsolationService } from '@/core/services/AccountIsolationService';
import { googleDriveSyncService } from '@/core/services/GoogleDriveSyncService';
import type { GoogleDriveSyncTransfer } from '@/core/services/GoogleDriveSyncTransfer';
import { HighlightDriveSyncCoordinator } from '@/core/services/HighlightDriveSyncCoordinator';
import { logger } from '@/core/services/LoggerService';
import { exportBackupableSyncSettings } from '@/core/services/SettingsBackupService';
import { getHighlightAccountHash } from '@/core/services/highlightAnnotationData';
import type { SyncAccountScope, SyncMode, SyncPlatform, SyncProvider } from '@/core/types/sync';
import { getPromptNameConflictIds } from '@/core/utils/promptName';
import { toSyncAccountScope } from '@/core/utils/syncAccountScope';
import { FOLDER_PLATFORMS, supportsAccountIsolation } from '@/features/folder/platforms';
import type { StarStore } from '@/features/savedLibrary/starStore';
import type { StarredMessagesData } from '@/features/savedLibrary/starTypes';
import type { ForkNodesData } from '@/pages/content/fork/forkTypes';

import {
  handleCatalogTimelineSyncMessage,
  isCatalogTimelineSyncMessage,
} from './catalogTimelineSyncMessages';
import {
  loadAuthoritativeSyncPayload,
  loadTimelineHierarchyForSync,
  readPluginStateForSync,
  filterStarredByRouteScope,
  filterForkNodesByRouteScope,
  retargetForkNodesToRoute,
} from './cloudSyncLocalData';
import { isHighlightCloudSyncRequested, notifyHighlightChanged } from './highlightMessages';
import { mergeCloudPrompts, mergeCloudPromptsForUpload } from './promptDriveMerge';
import { promptLibraryOwner } from './queueOwners';
import {
  isTrustedSharedDataSyncSender,
  isTrustedSyncMessageSender,
  parseSyncPlatform,
} from './runtimeMessageRouting';

function isSyncAccountScope(value: unknown): value is SyncAccountScope {
  if (typeof value !== 'object' || value === null) return false;
  const scope = value as Record<string, unknown>;
  return (
    typeof scope.accountKey === 'string' &&
    typeof scope.accountId === 'number' &&
    Number.isFinite(scope.accountId) &&
    (typeof scope.routeUserId === 'string' || scope.routeUserId === null)
  );
}

async function resolveAccountScopeForMessage(
  sender: chrome.runtime.MessageSender,
  platform: SyncPlatform,
  explicitScope?: SyncAccountScope,
): Promise<SyncAccountScope | null> {
  if (!supportsAccountIsolation(platform)) return null;
  const enabled = await accountIsolationService.isIsolationEnabled({
    platform,
    pageUrl: sender.tab?.url ?? null,
  });
  if (!enabled) return null;
  if (explicitScope) return explicitScope;

  const resolved = await accountIsolationService.resolveAccountScope({
    pageUrl: sender.tab?.url ?? null,
  });
  return toSyncAccountScope(resolved);
}

type SyncPayload = {
  interactive?: boolean;
  platform?: unknown;
  accountScope?: unknown;
  timelineHierarchyAccountScope?: unknown;
  highlightAccountScope?: unknown;
  includeHighlights?: boolean;
  mode?: SyncMode;
  provider?: SyncProvider;
};
export function createCloudSyncMessageHandler(readers: {
  getAllStarredMessages(): Promise<StarredMessagesData>;
  getAllForkNodes(): Promise<ForkNodesData>;
  starStore?: StarStore;
}) {
  async function handle(
    message: { type: string; payload?: unknown },
    sender: chrome.runtime.MessageSender,
    drive: GoogleDriveSyncTransfer,
  ): Promise<unknown> {
    const payload = message.payload as SyncPayload | undefined;
    if (isCatalogTimelineSyncMessage(message.type)) {
      return handleCatalogTimelineSyncMessage(
        message.type,
        payload,
        sender,
        readers.starStore,
        drive,
      );
    }
    switch (message.type) {
      case 'gv.sync.upload': {
        const {
          interactive,
          platform: rawPlatform,
          accountScope: rawScope,
          timelineHierarchyAccountScope: rawTimelineHierarchyScope,
          highlightAccountScope: rawHighlightScope,
          includeHighlights,
        } = payload as {
          interactive?: boolean;
          platform?: unknown;
          accountScope?: unknown;
          timelineHierarchyAccountScope?: unknown;
          highlightAccountScope?: unknown;
          includeHighlights?: boolean;
        };
        const platform = parseSyncPlatform(rawPlatform);
        if (!platform || !isTrustedSyncMessageSender(sender, platform)) {
          return { ok: false, error: 'untrusted_sender' };
        }
        const { syncsSharedData, syncsConversationExtras } = FOLDER_PLATFORMS[platform];
        const syncHighlights =
          syncsSharedData &&
          (await isHighlightCloudSyncRequested(platform, includeHighlights === true));
        const accountScope = await resolveAccountScopeForMessage(
          sender,
          platform,
          isSyncAccountScope(rawScope) ? rawScope : undefined,
        );
        const { folders, prompts } = await loadAuthoritativeSyncPayload(platform, accountScope);
        const timelineHierarchyAccountScope =
          syncsConversationExtras && isSyncAccountScope(rawTimelineHierarchyScope)
            ? rawTimelineHierarchyScope
            : null;
        const highlightAccountScope =
          syncsConversationExtras && isSyncAccountScope(rawHighlightScope)
            ? rawHighlightScope
            : (timelineHierarchyAccountScope ?? (isSyncAccountScope(rawScope) ? rawScope : null));
        const shouldSyncHighlights = syncHighlights && highlightAccountScope !== null;
        // Also get the conversation extras (stars, forks, timeline hierarchy) from local storage
        const starredDataRaw = syncsConversationExtras
          ? await readers.getAllStarredMessages()
          : null;
        const forksDataRaw = syncsConversationExtras ? await readers.getAllForkNodes() : null;
        const timelineHierarchyData = syncsConversationExtras
          ? await loadTimelineHierarchyForSync(timelineHierarchyAccountScope)
          : null;
        const starredData =
          starredDataRaw && accountScope
            ? filterStarredByRouteScope(starredDataRaw, accountScope.routeUserId)
            : starredDataRaw;
        const forksData =
          forksDataRaw && accountScope
            ? filterForkNodesByRouteScope(forksDataRaw, accountScope.routeUserId)
            : forksDataRaw;
        const settingsPayload = syncsSharedData ? await exportBackupableSyncSettings() : null;
        const pluginState = syncsSharedData ? await readPluginStateForSync() : null;
        const highlightPlan =
          shouldSyncHighlights && highlightAccountScope
            ? await new HighlightDriveSyncCoordinator(drive).preparePush(
                highlightAccountScope,
                interactive !== false,
              )
            : null;
        if (highlightPlan && !highlightPlan.ok) {
          return {
            ok: false,
            error: highlightPlan.result.error ?? 'Highlight upload failed',
            state: await drive.getState(),
          };
        }
        const success = await drive.upload(
          folders,
          prompts,
          starredData,
          interactive !== false,
          platform,
          forksData,
          timelineHierarchyData,
          accountScope,
          timelineHierarchyAccountScope,
          settingsPayload?.data ?? null,
          pluginState,
          ...(readers.starStore ? ([readers.starStore] as const) : []),
        );
        if (success && highlightPlan?.ok && highlightAccountScope) {
          const highlightResult = await highlightPlan.commit();
          if (!highlightResult.ok) {
            return {
              ok: false,
              error: highlightResult.error ?? 'Highlight upload failed',
              partial: true,
              state: await drive.getState(),
            };
          }
          await notifyHighlightChanged({
            platform: 'gemini',
            accountHash: getHighlightAccountHash({
              ...highlightAccountScope,
              platform: 'gemini',
            }),
          });
        }
        return {
          ok: success,
          highlights: syncHighlights
            ? { synced: success && shouldSyncHighlights, skipped: !shouldSyncHighlights }
            : undefined,
          state: await drive.getState(),
        };
      }
      case 'gv.sync.download': {
        const interactive = payload?.interactive !== false;
        const platform = parseSyncPlatform(payload?.platform);
        // Downloads hand cloud data back to the sender, so they need the same sender as uploads.
        if (!platform || !isTrustedSyncMessageSender(sender, platform)) {
          return { ok: false, error: 'unsupported_sync_platform' };
        }
        const { syncsSharedData, syncsConversationExtras } = FOLDER_PLATFORMS[platform];
        const syncHighlights =
          syncsSharedData &&
          (await isHighlightCloudSyncRequested(platform, payload?.includeHighlights === true));
        const rawScope = payload?.accountScope;
        const rawTimelineHierarchyScope = payload?.timelineHierarchyAccountScope;
        const rawHighlightScope = payload?.highlightAccountScope;
        const accountScope = await resolveAccountScopeForMessage(
          sender,
          platform,
          isSyncAccountScope(rawScope) ? rawScope : undefined,
        );
        const timelineHierarchyAccountScope =
          syncsConversationExtras && isSyncAccountScope(rawTimelineHierarchyScope)
            ? rawTimelineHierarchyScope
            : null;
        const highlightAccountScope =
          syncsConversationExtras && isSyncAccountScope(rawHighlightScope)
            ? rawHighlightScope
            : (timelineHierarchyAccountScope ?? (isSyncAccountScope(rawScope) ? rawScope : null));
        const shouldSyncHighlights = syncHighlights && highlightAccountScope !== null;
        const data = await drive.download(
          interactive,
          platform,
          accountScope,
          timelineHierarchyAccountScope,
        );
        if (!data) {
          const state = await drive.getState();
          if (state.error) return { ok: false, error: state.error, state };
        }
        const routeUserId = accountScope?.routeUserId;
        if (data?.forks?.data?.nodes && routeUserId) {
          data.forks = {
            ...data.forks,
            data: retargetForkNodesToRoute(data.forks.data, routeUserId),
          };
        }
        let highlightSyncResult: { synced: boolean; count: number; empty: boolean } | undefined;
        if (shouldSyncHighlights && highlightAccountScope) {
          const highlightResult = await new HighlightDriveSyncCoordinator(drive).pull(
            highlightAccountScope,
            interactive,
          );
          if (!highlightResult.ok) {
            return {
              ok: false,
              error: highlightResult.error ?? 'Highlight download failed',
              partial: data !== null,
              state: await drive.getState(),
            };
          }
          await notifyHighlightChanged({
            platform: 'gemini',
            accountHash: getHighlightAccountHash({
              ...highlightAccountScope,
              platform: 'gemini',
            }),
          });
          highlightSyncResult = {
            synced: true,
            count: highlightResult.count,
            empty: highlightResult.empty === true,
          };
        }
        // NOTE: We intentionally do NOT save to storage here.
        // The caller (Popup) is responsible for merging with local data and saving.
        // This prevents data loss from overwriting local changes.
        logger.info(`[Background] Downloaded data for ${platform}, returning to caller for merge`);
        return {
          ok: true,
          data,
          highlights:
            highlightSyncResult ??
            (syncHighlights ? { synced: false, skipped: !shouldSyncHighlights } : undefined),
          state: await drive.getState(),
        };
      }
      // Prompts-only cloud merge, run END-TO-END in the background so the
      // operation survives the extension popup closing when the Google
      // account picker steals focus during interactive auth. Merging in the
      // popup meant a first-time account selection abandoned the merge and
      // the user had to click again.
      case 'gv.sync.pullPromptsMerge': {
        if (!isTrustedSharedDataSyncSender(sender)) return { ok: false, error: 'untrusted_sender' };
        const { interactive, accountScope: rawScope } = (payload ?? {}) as {
          interactive?: boolean;
          accountScope?: unknown;
        };
        const accountScope = await resolveAccountScopeForMessage(
          sender,
          'gemini',
          isSyncAccountScope(rawScope) ? rawScope : undefined,
        );
        const cloudRead = await drive.downloadPromptsOnly(accountScope, interactive !== false);
        if (cloudRead.kind === 'failed' || cloudRead.kind === 'unrecognized') {
          return { ok: false, state: await drive.getState() };
        }
        const cloudPayload = cloudRead.kind === 'found' ? cloudRead.value : null;
        const outcome = await mergeCloudPrompts(promptLibraryOwner, cloudPayload);
        return { ...outcome, state: await drive.getState() };
      }
      case 'gv.sync.pushPromptsMerge': {
        if (!isTrustedSharedDataSyncSender(sender)) return { ok: false, error: 'untrusted_sender' };
        const { interactive, accountScope: rawScope } = (payload ?? {}) as {
          interactive?: boolean;
          accountScope?: unknown;
        };
        const accountScope = await resolveAccountScopeForMessage(
          sender,
          'gemini',
          isSyncAccountScope(rawScope) ? rawScope : undefined,
        );
        // Merge cloud into local first so both sides converge to the union.
        const cloudRead = await drive.downloadPromptsOnly(accountScope, interactive !== false);
        if (cloudRead.kind === 'failed' || cloudRead.kind === 'unrecognized') {
          return { ok: false, state: await drive.getState() };
        }
        const cloudPayload = cloudRead.kind === 'found' ? cloudRead.value : null;
        const localPrompts = await mergeCloudPromptsForUpload(promptLibraryOwner, cloudPayload);
        if (!localPrompts) {
          return { ok: false, state: await drive.getState() };
        }
        const uploaded = await drive.uploadPromptsOnly(
          localPrompts,
          accountScope,
          interactive !== false,
        );
        return {
          ok: uploaded,
          count: localPrompts.length,
          nameConflicts: getPromptNameConflictIds(localPrompts).size,
          state: await drive.getState(),
        };
      }
    }
  }
  async function configure(message: { type: string; payload?: unknown }): Promise<unknown> {
    const payload = message.payload as SyncPayload | undefined;
    switch (message.type) {
      case 'gv.sync.authenticate': {
        const ok = await googleDriveSyncService.authenticate(payload?.interactive !== false);
        return { ok, state: await googleDriveSyncService.getState() };
      }
      case 'gv.sync.signOut':
        await googleDriveSyncService.signOut();
        break;
      case 'gv.sync.setMode':
        if (payload?.mode) await googleDriveSyncService.setMode(payload.mode);
        break;
      case 'gv.sync.setProvider':
        if (payload?.provider === 'googleDrive' || payload?.provider === 'icloud') {
          await googleDriveSyncService.setProvider(payload.provider);
        }
        break;
    }
    return { ok: true, state: await googleDriveSyncService.getState() };
  }
  return (
    message: { type: string; payload?: unknown },
    sender: chrome.runtime.MessageSender,
  ): Promise<unknown> | null => {
    if (!message.type.startsWith('gv.sync.')) return null;
    const configuration = [
      'gv.sync.authenticate',
      'gv.sync.signOut',
      'gv.sync.getState',
      'gv.sync.setMode',
      'gv.sync.setProvider',
    ].includes(message.type);
    return configuration
      ? configure(message)
      : googleDriveSyncService.runExclusive((drive) => handle(message, sender, drive));
  };
}
