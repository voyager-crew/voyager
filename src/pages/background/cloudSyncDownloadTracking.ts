import type { SyncReadFile, SyncStatusFileRequest } from '@/core/services/CloudSyncBookkeeping';
import { readCloudSyncSnapshot } from '@/core/services/CloudSyncSnapshotService';
import type { DriveDownloadStatuses } from '@/core/services/GoogleDriveDownloadKinds';
import { driveHistoryBaseName } from '@/core/services/GoogleDriveHistoryTransfers';
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
import type { GoogleDriveSyncTransfer } from '@/core/services/GoogleDriveSyncTransfer';
import { hashCloudSyncContent } from '@/core/services/cloudSyncSnapshotHash';
import type { CloudSyncKind } from '@/core/services/cloudSyncSnapshotTypes';
import { FOLDER_PLATFORMS, FOLDER_PLATFORM_IDS } from '@/features/folder/platforms';

import { settleCloudSyncRunRow } from './cloudSyncSnapshotRun';
import type { SyncStatusStorageView } from './cloudSyncStatusData';

function senderIdentity(sender: chrome.runtime.MessageSender): string {
  return JSON.stringify([sender.id, sender.url, sender.tab?.id, sender.frameId, sender.documentId]);
}

function fileKind(name: string): CloudSyncKind | null {
  const base = driveHistoryBaseName(name);
  if (base === PROMPTS_FILE_NAME) return 'prompts';
  if (base === SETTINGS_FILE_NAME) return 'settings';
  if (base === PLUGINS_FILE_NAME) return 'plugins';
  if (base === FORKS_FILE_NAME) return 'forks';
  if (base === HIGHLIGHTS_FILE_NAME) return 'highlights';
  if (base === TIMELINE_HIERARCHY_FILE_NAME) return 'hierarchy';
  if (
    base === STARS_FILE_NAME ||
    base === STARRED_FILE_NAME ||
    base.startsWith('gemini-voyager-stars.site-')
  )
    return 'starred';
  if (base.startsWith('gemini-voyager-timeline-hierarchy.site-')) return 'outlines';
  if (FOLDER_PLATFORM_IDS.some((site) => FOLDER_PLATFORMS[site].driveFoldersFileName === base))
    return 'folders';
  return null;
}

/** A successful raw read of an unknown envelope is still not an applied file. */
export function recognizedDownloadFiles(
  files: SyncReadFile[],
  statuses: DriveDownloadStatuses,
  catalog: Record<string, { timelineHierarchy: string; stars: string }>,
): SyncReadFile[] {
  return files.filter((file) => {
    const base = driveHistoryBaseName(file.name);
    const site = /\.site-([a-z0-9-]+)\.json$/.exec(base)?.[1];
    if (site)
      return base.startsWith('gemini-voyager-stars.')
        ? catalog[site]?.stars === 'found'
        : catalog[site]?.timelineHierarchy === 'found';
    if (base === STARS_FILE_NAME) return statuses.stars === 'found';
    if (base === STARRED_FILE_NAME) return statuses.starred === 'found';
    const kind = fileKind(base);
    if (kind === 'hierarchy') return statuses.timelineHierarchy === 'found';
    if (kind === 'outlines' || kind === null) return false;
    return statuses[kind] === 'found';
  });
}

/** A one-shot acknowledgement belongs to the same sender and latest snapshot, never caller data. */
export class CloudSyncDownloadTracking {
  private pending: {
    id: string;
    sender: string;
    snapshotId: string;
    files: SyncReadFile[];
    local: (captured: SyncStatusStorageView) => Promise<SyncStatusFileRequest[]>;
    operationId?: string;
  } | null = null;

  begin(input: {
    sender: chrome.runtime.MessageSender;
    snapshotId: string;
    files: SyncReadFile[];
    local: (captured: SyncStatusStorageView) => Promise<SyncStatusFileRequest[]>;
    operationId?: string;
  }): string {
    const id = input.operationId ?? crypto.randomUUID();
    this.pending = { ...input, id, sender: senderIdentity(input.sender) };
    return id;
  }

  async complete(
    raw: unknown,
    sender: chrome.runtime.MessageSender,
    drive: GoogleDriveSyncTransfer,
  ) {
    if (
      !raw ||
      typeof raw !== 'object' ||
      !('operationId' in raw) ||
      typeof raw.operationId !== 'string' ||
      !('success' in raw) ||
      typeof raw.success !== 'boolean'
    )
      return { ok: false, error: 'invalid_sync_request' };
    const pending = this.pending;
    if (!pending || pending.id !== raw.operationId || pending.sender !== senderIdentity(sender))
      return { ok: false, error: 'stale_download' };
    this.pending = null;
    const { value: result, releaseFailed } = await settleCloudSyncRunRow(
      pending.operationId ? { snapshotId: pending.snapshotId, operationId: pending.id } : undefined,
      async () => {
        if (!raw.success) return { ok: true, recorded: false };
        const snapshot = await readCloudSyncSnapshot();
        // A fully skipped download has no receipts or baseline to advance.
        if (!snapshot) return { ok: true, recorded: false };
        if (snapshot.kind !== 'snapshot' || snapshot.id !== pending.snapshotId)
          return { ok: false, error: 'stale_download' };
        if (snapshot.run && snapshot.run.active?.operationId !== pending.id)
          return { ok: false, error: 'stale_download' };
        const appliedHashes = snapshot.run
          ? snapshot.appliedHashes.filter((receipt) => receipt.operationIds?.includes(pending.id))
          : snapshot.appliedHashes;
        const captured: SyncStatusStorageView = {
          local: await chrome.storage.local.get(null),
          sync: await chrome.storage.sync.get(null),
        };
        // One key can be written by several owners; Q12 retains every value, without write order.
        for (const area of ['local', 'sync'] as const) {
          const receipts = appliedHashes.filter((entry) => entry.area === area);
          const values = captured[area];
          for (const key of new Set(receipts.map((receipt) => receipt.key))) {
            const currentHash = await hashCloudSyncContent(values[key]);
            if (!receipts.some((receipt) => receipt.key === key && receipt.hash === currentHash))
              return { ok: true, recorded: false, reason: 'changed_since_download' };
          }
        }
        const local = await pending.local(captured);
        const kinds = new Set(appliedHashes.map((receipt) => receipt.kind));
        const files = pending.files.flatMap((file) => {
          const kind = fileKind(file.name);
          if (!kind || !kinds.has(kind)) return [];
          const request = local.find(
            (candidate) => candidate.name === driveHistoryBaseName(file.name),
          );
          return request ? [{ ...file, content: request.content }] : [];
        });
        await drive.commitAppliedBookkeeping(files);
        return { ok: true, recorded: files.length > 0 };
      },
    );
    return releaseFailed && result.ok ? { ok: false, error: 'sync_bookkeeping_failed' } : result;
  }
}
