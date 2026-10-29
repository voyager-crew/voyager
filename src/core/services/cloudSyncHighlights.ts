import type { HighlightExportPayloadV1, HighlightImportStats } from '@/core/types/highlight';
import type { SyncAccountScope } from '@/core/types/sync';
import type { DriveReadResult } from '@/core/utils/driveReadResult';

import { CloudSyncFailure, cloudSyncFailureCode } from './CloudSyncFailure';
import {
  captureCloudSyncSnapshot,
  finishCloudSyncSnapshot,
  recordCloudSyncWrites,
  type SnapshotContext,
} from './CloudSyncSnapshotService';
import { highlightAnnotationService } from './HighlightAnnotationService';
import type { HighlightDrivePort, HighlightLocalPort } from './HighlightDriveSyncCoordinator';

interface HighlightDownloadPort extends HighlightDrivePort {
  downloadHighlightsResult?(
    accountScope: SyncAccountScope,
    interactive?: boolean,
  ): Promise<DriveReadResult<HighlightExportPayloadV1>>;
}

export type CloudSyncHighlightsResult =
  | {
      ok: true;
      status: 'found';
      count: number;
      stats: HighlightImportStats;
      snapshotId: string;
    }
  | { ok: true; status: 'missing' | 'unrecognized'; count: 0; empty: true }
  | { ok: false; status: 'failed'; count: 0; error: string; snapshotId?: string };

async function readHighlights(
  drive: HighlightDownloadPort,
  accountScope: SyncAccountScope,
  interactive: boolean,
): Promise<DriveReadResult<HighlightExportPayloadV1>> {
  if (drive.downloadHighlightsResult)
    return drive.downloadHighlightsResult(accountScope, interactive);
  const value = await drive.downloadHighlightsOnly(accountScope, interactive);
  if (value) return { kind: 'found', value };
  const state = await drive.getState();
  return state.error ? { kind: 'failed', error: state.error } : { kind: 'missing' };
}

/** The highlight owner captures its complete import footprint, then receipts each physical write. */
export async function pullCloudSyncHighlights(input: {
  drive: HighlightDownloadPort;
  accountScope: SyncAccountScope;
  interactive: boolean;
  context: SnapshotContext;
  /** A whole download may finish all cloud reads before beginning any local apply. */
  remote?: DriveReadResult<HighlightExportPayloadV1>;
  local?: HighlightLocalPort;
  /** Join a caller's explicit multi-row run rather than replacing its previous rows. */
  snapshotId?: string;
}): Promise<CloudSyncHighlightsResult> {
  let snapshotId = input.snapshotId;
  try {
    const remote =
      input.remote ?? (await readHighlights(input.drive, input.accountScope, input.interactive));
    if (remote.kind === 'failed') throw remote.error;
    if (remote.kind !== 'found') return { ok: true, status: remote.kind, count: 0, empty: true };
    if (remote.value.accountScope.platform !== input.context.platform)
      return { ok: true, status: 'unrecognized', count: 0, empty: true };
    const stats = await (input.local ?? highlightAnnotationService).importMerge(
      { ...input.accountScope, platform: remote.value.accountScope.platform },
      remote.value.items,
      {
        clearMarker: remote.value.clearMarker,
        prepareWrite: async (setItems, removeKeys) => {
          try {
            const snapshot = await captureCloudSyncSnapshot({
              context: input.context,
              snapshotId,
              keys: [...Object.keys(setItems), ...removeKeys].map((key) => ({
                area: 'local',
                key,
              })),
            });
            snapshotId = snapshot.id;
          } catch (cause) {
            if (cloudSyncFailureCode(cause) === 'snapshot_superseded') throw cause;
            throw new CloudSyncFailure(
              'snapshot_failed',
              cause instanceof Error ? cause.message : String(cause),
              { cause },
            );
          }
        },
        beforeWrite: async (values) => {
          if (!snapshotId) throw new Error('snapshot_failed');
          try {
            await recordCloudSyncWrites(
              snapshotId,
              Object.entries(values).map(([key, value]) => ({
                area: 'local',
                key,
                kind: 'highlights',
                value,
              })),
            );
          } catch (cause) {
            // A receipt failure must never fall through to the canonical write or its retry.
            if (cloudSyncFailureCode(cause) === 'snapshot_superseded') throw cause;
            throw new CloudSyncFailure(
              'snapshot_receipt_failed',
              cause instanceof Error ? cause.message : String(cause),
              { cause },
            );
          }
        },
      },
    );
    if (!snapshotId) throw new Error('snapshot_failed');
    return { ok: true, status: 'found', count: stats.total, stats, snapshotId };
  } catch (error) {
    if (snapshotId) await finishCloudSyncSnapshot(snapshotId).catch(() => undefined);
    return {
      ok: false,
      status: 'failed',
      count: 0,
      error:
        cloudSyncFailureCode(error) ?? (error instanceof Error ? error.message : String(error)),
      ...(snapshotId ? { snapshotId } : {}),
    };
  }
}
