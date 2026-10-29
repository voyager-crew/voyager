import { cloudSyncFailureCode } from '@/core/services/CloudSyncFailure';
import { requireSyncScope, SyncScopeExcludedError } from '@/core/services/CloudSyncScope';
import { CloudSyncUploadGuardTokens } from '@/core/services/CloudSyncUploadGuardTokens';
import { AccountUnconfirmedError } from '@/core/services/GoogleDriveIdentity';
import { PROMPTS_FILE_NAME } from '@/core/services/GoogleDriveSyncFileNames';
import { googleDriveSyncService } from '@/core/services/GoogleDriveSyncService';
import type { GoogleDriveSyncTransfer } from '@/core/services/GoogleDriveSyncTransfer';
import { getHighlightAccountHash } from '@/core/services/highlightAnnotationData';
import type { SyncAccountScope, SyncMode, SyncPlatform, SyncProvider } from '@/core/types/sync';
import { getPromptNameConflictIds } from '@/core/utils/promptName';

import {
  handleCatalogTimelineSyncMessage,
  isCatalogTimelineSyncMessage,
} from './catalogTimelineSyncMessages';
import { handleCloudSyncDownload } from './cloudSyncDownload';
import { CloudSyncDownloadTracking } from './cloudSyncDownloadTracking';
import { resolveAccountScopeForMessage } from './cloudSyncRequest';
import {
  assertCloudSyncSnapshotRunRequest,
  captureCloudSyncSnapshotRun,
  parseCloudSyncSnapshotRun,
  settleCloudSyncRunRow,
} from './cloudSyncSnapshotRun';
import { handleCloudSyncStatus } from './cloudSyncStatusMessages';
import { handleCloudSyncUpload, type CloudSyncReaders } from './cloudSyncUpload';
import { handleDriveHistoryMessage, parseSyncScope } from './driveHistoryMessages';
import { notifyHighlightChanged } from './highlightMessages';
import { downloadCloudPrompts, mergeCloudPromptsForUpload } from './promptDriveMerge';
import { promptLibraryOwner } from './queueOwners';
import { isTrustedSharedDataSyncSender } from './runtimeMessageRouting';

function isSyncAccountScope(value: unknown): value is SyncAccountScope {
  return parseSyncScope(value) !== null;
}
type SyncPayload = {
  interactive?: boolean;
  platform?: unknown;
  accountScope?: unknown;
  mode?: SyncMode;
  provider?: SyncProvider;
  force?: boolean;
  guardToken?: string;
  snapshotRun?: unknown;
};
export function createCloudSyncMessageHandler(readers: CloudSyncReaders) {
  const tracking = new CloudSyncDownloadTracking();
  const guardTokens = new CloudSyncUploadGuardTokens();
  async function handle(
    message: { type: string; payload?: unknown },
    sender: chrome.runtime.MessageSender,
    drive: GoogleDriveSyncTransfer,
  ): Promise<unknown> {
    const payload = message.payload as SyncPayload | undefined;
    if (message.type === 'gv.sync.restorePreviousVersion')
      return handleDriveHistoryMessage(message.payload, sender, drive);
    if (isCatalogTimelineSyncMessage(message.type))
      return handleCatalogTimelineSyncMessage(
        message.type,
        payload,
        sender,
        readers.starStore,
        drive,
      );
    switch (message.type) {
      case 'gv.sync.upload':
        return handleCloudSyncUpload(
          message.payload,
          sender,
          drive,
          readers,
          guardTokens,
          async (scope) =>
            notifyHighlightChanged({
              platform: 'gemini',
              accountHash: getHighlightAccountHash({ ...scope, platform: 'gemini' }),
            }),
        );
      case 'gv.sync.download':
        return handleCloudSyncDownload(
          message.payload,
          sender,
          drive,
          readers,
          tracking,
          async (scope) =>
            notifyHighlightChanged({
              platform: 'gemini',
              accountHash: getHighlightAccountHash({ ...scope, platform: 'gemini' }),
            }),
        );
      case 'gv.sync.getStatus':
        return handleCloudSyncStatus(message.payload, sender, drive, readers);
      case 'gv.sync.completeDownload':
        return tracking.complete(message.payload, sender, drive);
      // Prompts-only cloud merge, run END-TO-END in the background so the
      // operation survives the extension popup closing when the Google
      // account picker steals focus during interactive auth. Merging in the
      // popup meant a first-time account selection abandoned the merge and
      // the user had to click again.
      case 'gv.sync.pullPromptsMerge': {
        if (!isTrustedSharedDataSyncSender(sender)) return { ok: false, error: 'untrusted_sender' };
        const snapshotRun = parseCloudSyncSnapshotRun(payload?.snapshotRun);
        await assertCloudSyncSnapshotRunRequest(snapshotRun, sender);
        await requireSyncScope({ kind: 'shared' });
        drive.beginDownloadBookkeeping();
        const { interactive, accountScope: rawScope } = (payload ?? {}) as {
          interactive?: boolean;
          accountScope?: unknown;
        };
        const platform = 'gemini' as const;
        const accountScope = await resolveAccountScopeForMessage(
          sender,
          platform,
          isSyncAccountScope(rawScope) ? rawScope : undefined,
          false,
        );
        await drive.confirmAccountScope(accountScope);
        const cloudRead = await drive.downloadPromptsOnly(accountScope, interactive !== false);
        if (cloudRead.kind === 'failed' || cloudRead.kind === 'unrecognized') {
          return {
            ok: false,
            error:
              cloudRead.kind === 'failed' &&
              cloudSyncFailureCode(cloudRead.error) === 'not_authenticated'
                ? 'not_authenticated'
                : 'cloud_read_failed',
            state: await drive.getState(),
          };
        }
        const cloudPayload = cloudRead.kind === 'found' ? cloudRead.value : null;
        const files = await drive.getDownloadBookkeeping();
        const context = {
          source: 'popup-restore' as const,
          platform,
          accountScope: accountScope ?? null,
          ...(snapshotRun ? { selection: 'shared' as const } : {}),
        };
        const run = await captureCloudSyncSnapshotRun(snapshotRun, sender, context);
        const { value: outcome, releaseFailed } = await settleCloudSyncRunRow(run, () =>
          downloadCloudPrompts(
            promptLibraryOwner,
            cloudPayload,
            context,
            async (items) => {
              await drive.commitAppliedBookkeeping(
                files.map((file) => ({ ...file, content: items })),
              );
            },
            { snapshotId: run?.snapshotId },
          ),
        );
        return {
          ...outcome,
          ...(releaseFailed && outcome.ok ? { warning: 'sync_bookkeeping_failed' } : {}),
          state: await drive.getState(),
        };
      }
      case 'gv.sync.pushPromptsMerge': {
        if (!isTrustedSharedDataSyncSender(sender)) return { ok: false, error: 'untrusted_sender' };
        await requireSyncScope({ kind: 'shared' });
        const platform: SyncPlatform = 'gemini';
        const { interactive, accountScope: rawScope } = (payload ?? {}) as {
          interactive?: boolean;
          accountScope?: unknown;
        };
        const accountScope = await resolveAccountScopeForMessage(
          sender,
          platform,
          isSyncAccountScope(rawScope) ? rawScope : undefined,
          false,
        );
        const accountIdentity = await drive.confirmAccountScope(accountScope);
        // Guard the merged list in the prompt-owner turn, before it writes locally.
        const cloudRead = await drive.downloadPromptsOnly(
          accountScope,
          interactive !== false,
          'upload',
        );
        if (cloudRead.kind === 'failed') {
          return {
            ok: false,
            error:
              cloudRead.kind === 'failed' &&
              cloudSyncFailureCode(cloudRead.error) === 'not_authenticated'
                ? 'not_authenticated'
                : 'cloud_read_failed',
            state: await drive.getState(),
          };
        }
        const cloudPayload =
          cloudRead.kind === 'found'
            ? cloudRead.value
            : cloudRead.kind === 'missing'
              ? null
              : undefined;
        const merged = await mergeCloudPromptsForUpload(
          promptLibraryOwner,
          cloudPayload,
          guardTokens.forRequest(
            {
              provider: (await drive.getState()).provider,
              operation: 'pushPromptsMerge',
              platform,
              accountScope,
              accountIdentity,
              files: [PROMPTS_FILE_NAME],
            },
            {
              force: payload?.force === true,
              guardToken: typeof payload?.guardToken === 'string' ? payload.guardToken : undefined,
            },
          ),
        );
        if (merged.kind === 'refused') {
          return {
            ok: false,
            error: merged.error,
            refusedFiles: merged.refusedFiles,
            guardToken: merged.guardToken,
            state: await drive.getState(),
          };
        }
        if (merged.kind === 'failed') {
          return { ok: false, error: 'local_read_failed', state: await drive.getState() };
        }
        const localPrompts = merged.items;
        const uploaded = await drive.uploadPromptsOnly(
          localPrompts,
          accountScope,
          interactive !== false,
          accountScope && !isSyncAccountScope(rawScope)
            ? async () => {
                await resolveAccountScopeForMessage(sender, platform);
              }
            : undefined,
        );
        if (uploaded) await drive.commitBookkeeping();
        return {
          ok: uploaded,
          ...(!uploaded ? { error: cloudSyncFailureCode((await drive.getState()).error) } : {}),
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
      : googleDriveSyncService
          .runExclusive((drive) => handle(message, sender, drive))
          .catch((error: unknown) => {
            if (
              error instanceof Error &&
              ['untrusted_sender', 'invalid_sync_request'].includes(error.message)
            )
              return { ok: false, error: error.message };
            if (error instanceof SyncScopeExcludedError)
              return { ok: false, error: error.code, excludedRows: error.rows };
            if (
              error instanceof AccountUnconfirmedError ||
              (error instanceof Error && error.message === 'account_unconfirmed')
            )
              return { ok: false, error: 'account_unconfirmed' };
            const code = cloudSyncFailureCode(error);
            if (code) return { ok: false, error: code };
            throw error;
          });
  };
}
