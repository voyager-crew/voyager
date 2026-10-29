/**
 * One cloud sync transfer, the same for the popup and the panel's cloud
 * sheet: the upload, a refusal's answer and its forced retry, and the download
 * that applies through the owners, restores catalog outlines and stars, and
 * records its baseline only after every owner finished. Each surface keeps
 * only its way of asking the person and of showing the result.
 */
import { CloudRestoreError, type CloudRestoreMode } from '@/core/services/CloudSyncApplyService';
import { completeCloudSyncDownload } from '@/core/services/CloudSyncDownloadCompletion';
import {
  applyPopupCatalogDownload,
  applyPopupCloudDownload,
  type CloudDownloadData,
} from '@/core/services/CloudSyncDownloadService';
import { logger } from '@/core/services/LoggerService';
import type { DownloadFailure } from '@/core/services/cloudSyncNotices';
import {
  pullCatalogTimeline,
  type PulledCatalogTimeline,
} from '@/features/timeline/catalogTimelineCloud';

import {
  type CloudSyncContext,
  type CloudSyncPayload,
  type SyncPageLookup,
  isCurrentCloudRestore,
  readLocalSyncData,
  sameCloudSyncAccounts,
} from './CloudSyncTransferContext';
import {
  type CloudDownloadReply,
  type CloudUploadReply,
  parseDownloadReply,
  parseUploadReply,
} from './cloudSyncTransferReplies';

export type CloudSyncSend = (message: { type: string; payload?: unknown }) => Promise<unknown>;

/** The upload payload: the page's live folders bring the page's own scope with them. */
export async function prepareCloudUpload(context: CloudSyncContext, page: SyncPageLookup) {
  const local = await readLocalSyncData(context, page, 'upload');
  // The background re-reads authoritative storage; the payload keeps its message contract.
  return {
    ...context.payload,
    accountScope: local.accountScope,
    folders: local.folders,
    prompts: local.prompts,
  };
}

/** One upload request; `retry` answers a refusal with force and the refusal's token. */
export async function sendCloudUpload(
  send: CloudSyncSend,
  payload: CloudSyncPayload,
  retry?: { readonly guardToken?: string },
): Promise<CloudUploadReply> {
  return parseUploadReply(
    await send({
      type: 'gv.sync.upload',
      payload: retry
        ? { ...payload, force: true, ...(retry.guardToken ? { guardToken: retry.guardToken } : {}) }
        : payload,
    }),
  );
}

/**
 * The person's answer to a refusal. Either one runs only while the page is on
 * the accounts the refusal was for. `force` retries the refused payload with
 * the refusal's token: a token that no longer matches (another account, other
 * files) brings a new refusal to ask about again. `merge` only clears the way.
 */
export async function answerUploadRefusal(input: {
  readonly send: CloudSyncSend;
  readonly refused: { readonly payload: CloudSyncPayload; readonly guardToken?: string };
  readonly answer: 'force' | 'merge';
  readonly prepare: () => Promise<CloudSyncPayload>;
}): Promise<CloudUploadReply | { readonly kind: 'merge' } | { readonly kind: 'accountChanged' }> {
  const again = await input.prepare().catch(() => null);
  if (!again || !sameCloudSyncAccounts(input.refused.payload, again))
    return { kind: 'accountChanged' };
  if (input.answer === 'merge') return { kind: 'merge' };
  return sendCloudUpload(input.send, input.refused.payload, {
    guardToken: input.refused.guardToken,
  });
}

/** Plans every owner before writing; the page and its account are checked between phases. */
async function restoreCloudDownload(
  input: PreparedInput,
  data: CloudDownloadData,
  mode: CloudRestoreMode,
  highlightsRestored: boolean,
  downloadedCatalog?: PulledCatalogTimeline | null,
) {
  const { context, page, send, signal } = input;
  const catalog = await (
    downloadedCatalog !== undefined
      ? Promise.resolve(downloadedCatalog)
      : pullCatalogTimeline((message) =>
          send({
            ...message,
            payload: {
              interactive: true,
              selection: context.payload.selection,
              platform: context.payload.platform,
            },
          }),
        )
  ).then(
    (value) => ({ status: 'pulled' as const, value }),
    (error: unknown) => ({ status: 'failed' as const, error }),
  );
  const local = await readLocalSyncData(context, page, 'restore');
  const result = await applyPopupCloudDownload({
    context,
    local,
    data: { ...data, selection: data.selection ?? context.included },
    mode,
    highlightsRestored,
    catalog,
    send,
    current: () => isCurrentCloudRestore(context, page, signal),
    signal,
  });
  if (!signal.aborted) {
    try {
      await (await page())?.ask?.({ type: 'gv.folders.reload' });
    } catch (error) {
      logger.warn('Cloud sync could not reload the page folders', { error: String(error) });
    }
  }
  return result;
}

interface PreparedInput {
  readonly context: CloudSyncContext;
  readonly page: SyncPageLookup;
  readonly send: CloudSyncSend;
  readonly signal: AbortSignal;
}

/** A download ready to send for `context`, and its two ways to apply what comes back. */
export function prepareCloudDownload(input: PreparedInput) {
  const { context, page, send, signal } = input;
  return {
    payload: context.payload,
    restore: (
      data: CloudDownloadData,
      mode: CloudRestoreMode,
      highlightsRestored: boolean,
      snapshotId?: string,
      catalog?: PulledCatalogTimeline | null,
    ) =>
      restoreCloudDownload(
        input,
        snapshotId ? { ...data, snapshotId } : data,
        mode,
        highlightsRestored,
        catalog,
      ),
    /** Restores only the catalog outlines and stars, for a cloud without this site's files. */
    restoreCatalogTimeline: async (
      snapshotId?: string,
      catalog?: PulledCatalogTimeline | null,
      highlightsRestored = false,
    ) => {
      const { platform, selection, accountScope } = context.payload;
      const pulled =
        catalog !== undefined
          ? catalog
          : await pullCatalogTimeline((message) =>
              send({ ...message, payload: { interactive: true, selection, platform } }),
            );
      return applyPopupCatalogDownload({
        send,
        catalog: pulled,
        snapshotId,
        // Highlights the background already applied stay named in a partial result.
        highlightsRestored,
        current: () => isCurrentCloudRestore(context, page, signal),
        signal,
        snapshot: { source: 'popup-restore', platform, accountScope },
      });
    },
  };
}

export type PreparedCloudDownload = ReturnType<typeof prepareCloudDownload>;
type AppliedDownload = Awaited<ReturnType<PreparedCloudDownload['restore']>>;

/** What a download did. `statusRecorded: false`: the data landed but its baseline was not recorded. */
export type CloudDownloadRun =
  | {
      readonly kind: 'refused';
      readonly reply: CloudDownloadReply | null;
      readonly snapshotId?: string;
    }
  | {
      readonly kind: 'catalog';
      readonly restored: boolean;
      readonly reply: CloudDownloadReply;
      readonly snapshotId?: string;
      readonly statusRecorded: boolean;
    }
  | {
      readonly kind: 'applied';
      readonly result: AppliedDownload;
      readonly reply: CloudDownloadReply;
      readonly snapshotId?: string;
      readonly statusRecorded: boolean;
    }
  | { readonly kind: 'failed'; readonly failure: DownloadFailure; readonly snapshotId?: string };

/**
 * One download: the background reads the cloud and snapshots, the owners apply
 * it here (catalog outlines and stars too when the cloud has no folders for
 * the site), and the operation completes either way, before the next row of a
 * run may start. A completion failure after a finished apply keeps the result
 * and its Undo.
 */
export async function runCloudDownload(input: {
  readonly send: CloudSyncSend;
  readonly prepare: () => Promise<PreparedCloudDownload>;
  readonly mode: CloudRestoreMode;
  /**
   * One row of a run that several rows download in: `start` opens the run's
   * snapshot and every later row extends it by id, so one Undo covers the run.
   * Absent: a download on its own, with its own snapshot.
   */
  readonly snapshotRun?: 'start' | { readonly snapshotId: string };
  /** The reply's sync state, as soon as it arrives. */
  readonly onReply?: (reply: CloudDownloadReply) => void;
}): Promise<CloudDownloadRun> {
  let reply: CloudDownloadReply | null = null;
  let run: CloudDownloadRun;
  let completed = false;
  try {
    const download = await input.prepare();
    const { snapshotRun } = input;
    reply = parseDownloadReply(
      await input.send({
        type: 'gv.sync.download',
        payload: snapshotRun ? { ...download.payload, snapshotRun } : download.payload,
      }),
    );
    input.onReply?.(reply);
    if (!reply.ok) {
      logger.error('Cloud sync download failed', { error: reply.error });
      run = { kind: 'refused', reply, snapshotId: reply.snapshotId };
    } else if (!reply.data) {
      // Catalog outlines and stars have files of their own; restore them without folders too.
      const catalog = await download.restoreCatalogTimeline(
        reply.snapshotId,
        reply.catalog,
        reply.highlights.synced,
      );
      completed = true;
      const snapshotId = catalog.snapshotId ?? reply.snapshotId;
      run = {
        kind: 'catalog',
        restored: catalog.restored,
        reply,
        snapshotId,
        statusRecorded: true,
      };
    } else {
      const result = await download.restore(
        reply.data,
        input.mode,
        reply.highlights.synced,
        reply.snapshotId,
        reply.catalog,
      );
      completed = true;
      const snapshotId = result.snapshotId ?? reply.snapshotId;
      run = { kind: 'applied', result, reply, snapshotId, statusRecorded: true };
    }
  } catch (error) {
    logger.error('Cloud sync download failed', { error: String(error) });
    run =
      error instanceof CloudRestoreError
        ? {
            kind: 'failed',
            failure: {
              cause: error.cause,
              restored: error.restored,
              failed: error.failed,
              skipped: error.skipped,
              reason: error.reason,
            },
            snapshotId: error.snapshotId ?? reply?.snapshotId,
          }
        : { kind: 'failed', failure: { cause: error }, snapshotId: reply?.snapshotId };
  }
  try {
    await completeCloudSyncDownload(input.send, reply?.operationId, completed);
  } catch (error) {
    logger.error('Cloud sync download completion failed', { error: String(error) });
    if (run.kind === 'catalog' || run.kind === 'applied') run = { ...run, statusRecorded: false };
  }
  return run;
}
