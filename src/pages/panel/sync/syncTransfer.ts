import type { SyncScopeRow } from '@/core/services/CloudSyncScope';
import {
  answerUploadRefusal,
  prepareCloudDownload,
  prepareCloudUpload,
  runCloudDownload,
  sendCloudUpload,
} from '@/core/services/CloudSyncTransfer';
import type { CloudSyncContext, CloudSyncPayload } from '@/core/services/CloudSyncTransferContext';
import type { DownloadFailure } from '@/core/services/cloudSyncNotices';
import type { CloudUploadReply } from '@/core/services/cloudSyncTransferReplies';
import type { UploadGuardRefusedFile } from '@/core/types/syncUploadGuard';

import { type SyncSend, parseRestoredFiles } from './syncProtocol';
import { type SheetPage, rowPage } from './syncScopes';

/** A refused upload: the payload it refused and its token, which only a matching retry repeats. */
export interface UploadRefusal {
  readonly payload: CloudSyncPayload;
  readonly guardToken?: string;
}

/** One row's upload, through the shared transfer; the guard refuses before any cloud write. */
export type UploadOutcome =
  | {
      readonly kind: 'uploaded';
      readonly payload: CloudSyncPayload;
      /** The files landed but their sync status was not recorded (`sync_metadata_unavailable`). */
      readonly unrecorded: boolean;
    }
  | {
      readonly kind: 'refused';
      readonly files: readonly UploadGuardRefusedFile[];
      readonly refusal: UploadRefusal;
    }
  | {
      readonly kind: 'failed';
      readonly error: string;
      readonly excludedRows?: readonly SyncScopeRow[];
      readonly partial?: boolean;
    };

export type DownloadOutcome =
  | {
      readonly kind: 'downloaded';
      readonly snapshotId: string | undefined;
      /** The apply finished but its baseline was not recorded; the row may still show a change. */
      readonly unrecorded: boolean;
    }
  | {
      readonly kind: 'failed';
      readonly failure: DownloadFailure;
      readonly snapshotId: string | undefined;
    };

function uploadOutcome(reply: CloudUploadReply, payload: CloudSyncPayload): UploadOutcome {
  if (reply.kind === 'uploaded') return { kind: 'uploaded', payload, unrecorded: false };
  if (reply.kind === 'refused')
    return {
      kind: 'refused',
      files: reply.refusedFiles,
      refusal: { payload, ...(reply.guardToken ? { guardToken: reply.guardToken } : {}) },
    };
  // The content landed but its record did not: a success with a warning, never a retry.
  if (reply.error === 'sync_metadata_unavailable')
    return { kind: 'uploaded', payload, unrecorded: true };
  return {
    kind: 'failed',
    error: reply.error ?? 'sync_failed',
    ...(reply.excludedRows ? { excludedRows: reply.excludedRows } : {}),
    ...(reply.partial ? { partial: true } : {}),
  };
}

export async function uploadRow(
  send: SyncSend,
  context: CloudSyncContext,
  page: SheetPage,
): Promise<UploadOutcome> {
  const payload = await prepareCloudUpload(context, rowPage(page, context.payload.platform));
  return uploadOutcome(await sendCloudUpload(send, payload), payload);
}

/**
 * The guard's answer for a row, as the popup gives it: only for the accounts
 * the refusal was for; 仍然上传 retries the refused payload with its token, and a
 * token that no longer matches brings a new refusal.
 */
export async function answerRefusal(
  send: SyncSend,
  context: CloudSyncContext,
  page: SheetPage,
  answer: { readonly choice: 'force' | 'merge'; readonly refusal: UploadRefusal },
): Promise<UploadOutcome | { readonly kind: 'merge' }> {
  const next = await answerUploadRefusal({
    send,
    refused: answer.refusal,
    answer: answer.choice,
    prepare: () => prepareCloudUpload(context, rowPage(page, context.payload.platform)),
  });
  if (next.kind === 'merge') return next;
  if (next.kind === 'accountChanged') return { kind: 'failed', error: 'account_changed' };
  return uploadOutcome(next, answer.refusal.payload);
}

/**
 * One row's merge download, through the shared transfer: the background reads
 * the cloud and snapshots into the run's one snapshot, the owners apply it
 * here, and the row completes before the next one starts. Merge never
 * overwrites local data. A download from elsewhere since the run started
 * supersedes it: this row then fails with `snapshot_superseded` and writes nothing.
 */
export async function downloadRow(
  send: SyncSend,
  context: CloudSyncContext,
  page: SheetPage,
  signal: AbortSignal,
  snapshotRun: 'start' | { readonly snapshotId: string },
): Promise<DownloadOutcome> {
  const run = await runCloudDownload({
    send,
    mode: 'merge',
    snapshotRun,
    prepare: async () =>
      prepareCloudDownload({
        context,
        page: rowPage(page, context.payload.platform),
        send,
        signal,
      }),
  });
  switch (run.kind) {
    case 'refused':
      return {
        kind: 'failed',
        failure: {
          cause: run.reply?.error ?? 'sync_failed',
          excludedRows: run.reply?.excludedRows,
        },
        snapshotId: run.snapshotId,
      };
    case 'failed':
      return { kind: 'failed', failure: run.failure, snapshotId: run.snapshotId };
    default:
      // Decision E: a completion failure after a successful apply keeps the result and its undo.
      return { kind: 'downloaded', snapshotId: run.snapshotId, unrecorded: !run.statusRecorded };
  }
}

/** Puts each named cloud file back to its latest history copy; the current copy becomes history. */
export async function restoreRowFiles(
  send: SyncSend,
  payload: CloudSyncPayload,
  files: readonly string[],
): Promise<{ restored: number; failed: number }> {
  if (!files.length) return { restored: 0, failed: 0 };
  const reply = await send({
    type: 'gv.sync.restorePreviousVersion',
    payload: {
      files,
      platform: payload.platform,
      accountScope: payload.accountScope,
      interactive: true,
    },
  }).catch(() => undefined);
  const results = parseRestoredFiles(reply);
  const restored = results.filter((file) => file.restored).length;
  return { restored, failed: files.length - restored };
}
