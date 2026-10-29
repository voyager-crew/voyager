import { useCallback, useEffect, useRef, useState } from 'react';

import { CloudSyncFailure } from '@/core/services/CloudSyncFailure';
import {
  type CloudDownloadRun,
  answerUploadRefusal,
  runCloudDownload,
  sendCloudUpload,
} from '@/core/services/CloudSyncTransfer';
import { logger } from '@/core/services/LoggerService';
import {
  type CloudSyncNotice,
  downloadFailureNotice,
  downloadNotice,
  undoNotice,
  uploadFailureNotice,
  uploadNotice,
  withStatusRecordWarning,
} from '@/core/services/cloudSyncNotices';
import { canUndoCloudSync } from '@/core/services/cloudSyncUndoOffer';
import type { SyncPlatform, SyncState } from '@/core/types/sync';
import { askUploadGuard } from '@/core/ui/cloudSyncGuardConfirm';
import { askConfirm } from '@/core/ui/confirm';
import type { TranslationKey } from '@/utils/translations';

import { popupConfirmTheme } from '../utils/popupConfirmTheme';
import type { CloudRestoreMode } from './cloudRestore';
import type { useCloudSyncTransfer } from './useCloudSyncTransfer';
import { useCloudSyncUndo } from './useCloudSyncUndo';

export type CloudSyncStatus = {
  text: string;
  kind: 'ok' | 'warn' | 'err';
  /** Present only when there are reasons, kept kinds or warnings to list. */
  lines?: string[];
};

type Transfer = ReturnType<typeof useCloudSyncTransfer>;

export function toCloudSyncStatus(notice: CloudSyncNotice): CloudSyncStatus {
  return notice.lines.length > 0
    ? { text: notice.headline, kind: notice.tone, lines: [...notice.lines] }
    : { text: notice.headline, kind: notice.tone };
}

const send = (message: { type: string; payload?: unknown }) => chrome.runtime.sendMessage(message);

/** The popup's line for what a download did. */
function downloadRunNotice(
  t: (key: TranslationKey) => string,
  mode: CloudRestoreMode,
  run: CloudDownloadRun,
): CloudSyncNotice {
  switch (run.kind) {
    case 'refused':
      return downloadFailureNotice(t, {
        cause: run.reply?.error ?? null,
        excludedRows: run.reply?.excludedRows,
      });
    case 'failed':
      return downloadFailureNotice(t, run.failure);
    case 'catalog':
      return run.restored || run.reply.highlights.synced
        ? { tone: 'ok', headline: t('syncSuccess'), lines: [] }
        : { tone: 'err', headline: t('syncNoData'), lines: [] };
    case 'applied':
      return downloadNotice(t, {
        mode,
        foldersMissing: run.result.foldersMissing,
        highlightsSkipped: run.reply.highlights.skipped,
        nameConflicts: run.result.nameConflicts,
        skipped: run.result.skipped,
        nothingRestored: run.result.restored.length === 0,
      });
  }
}

export interface CloudSyncActionsOptions {
  readonly t: (key: TranslationKey) => string;
  readonly language: string;
  readonly platform: SyncPlatform;
  readonly transfer: Transfer;
  readonly setSyncState: (state: SyncState) => void;
  readonly setStatusMessage: (status: CloudSyncStatus | null) => void;
}

/**
 * The popup's upload and download: the guard confirmation and its account
 * check, the overwrite confirmation, results that name reasons and kept
 * kinds, and Undo for the download that just ran.
 */
export function useCloudSyncActions({
  t,
  language,
  platform,
  transfer,
  setSyncState,
  setStatusMessage,
}: CloudSyncActionsOptions) {
  const [isUploading, setIsUploading] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadMode, setDownloadMode] = useState<CloudRestoreMode | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const { prepareUpload, prepareDownload } = transfer;

  const undo = useCloudSyncUndo((result) => {
    setStatusMessage(toCloudSyncStatus(undoNotice(t, result)));
  });
  const { offer, withdraw } = undo;

  const handleDownloadFromDrive = useCallback(
    async (mode: CloudRestoreMode = 'merge', anchor?: HTMLElement) => {
      if (mode === 'overwrite') {
        const answer = await askConfirm({
          message: t('syncOverwriteConfirm'),
          anchor,
          align: 'end',
          ...popupConfirmTheme(language),
          tone: 'danger',
          choices: [{ id: 'confirm', label: t('syncOverwrite') }],
          cancelLabel: t('pm_cancel'),
        });
        if (answer !== 'confirm' || !mounted.current) return;
      }

      setStatusMessage(null);
      withdraw();
      setIsDownloading(true);
      setDownloadMode(mode);

      const run = await runCloudDownload({
        send,
        prepare: prepareDownload,
        mode,
        onReply: (reply) => {
          if (reply.state) setSyncState(reply.state);
        },
      });
      let notice = downloadRunNotice(t, mode, run);
      // The data landed: keep its result and Undo, and say the status was not recorded.
      if ((run.kind === 'catalog' || run.kind === 'applied') && !run.statusRecorded)
        notice = withStatusRecordWarning(t, notice);
      if (mounted.current) {
        setIsDownloading(false);
        setDownloadMode(null);
        setStatusMessage(toCloudSyncStatus(notice));
        const { snapshotId } = run;
        if (snapshotId && (await canUndoCloudSync(snapshotId)) && mounted.current)
          offer(snapshotId);
      }
    },
    [language, offer, prepareDownload, setStatusMessage, setSyncState, t, withdraw],
  );

  const handleSyncNow = useCallback(
    async (anchor?: HTMLElement) => {
      setStatusMessage(null);
      withdraw();
      setIsUploading(true);
      let mergeInstead = false;
      const show = (notice: CloudSyncNotice) => {
        if (mounted.current) setStatusMessage(toCloudSyncStatus(notice));
      };
      try {
        const payload = await prepareUpload();
        let reply = await sendCloudUpload(send, payload);
        // A token that no longer matches (another account, other files) brings a new refusal: ask again.
        while (reply.kind === 'refused') {
          if (reply.state) setSyncState(reply.state);
          const answer = await askUploadGuard({
            t,
            platform,
            refusedFiles: [...reply.refusedFiles],
            anchor,
            ...popupConfirmTheme(language),
            allowMerge: true,
          });
          if (!answer || !mounted.current) return;
          const next = await answerUploadRefusal({
            send,
            refused: { payload, guardToken: reply.guardToken },
            answer,
            prepare: prepareUpload,
          });
          if (next.kind === 'accountChanged') {
            show(
              uploadFailureNotice(
                t,
                new CloudSyncFailure('account_changed', 'The account changed during the confirm'),
              ),
            );
            return;
          }
          if (next.kind === 'merge') {
            mergeInstead = true;
            return;
          }
          reply = next;
        }
        if (reply.state) setSyncState(reply.state);
        if (reply.kind === 'uploaded') show(uploadNotice(t, reply.highlightsSkipped));
        else {
          logger.error('Cloud sync upload failed', { error: reply.error });
          show(
            uploadFailureNotice(t, reply.error, {
              excludedRows: reply.excludedRows,
              partial: reply.partial,
            }),
          );
        }
      } catch (error) {
        logger.error('Cloud sync upload failed', { error: String(error) });
        show(uploadFailureNotice(t, error));
      } finally {
        if (mounted.current) setIsUploading(false);
        // The early returns above pass through here, so the merge starts here too.
        if (mergeInstead && mounted.current) await handleDownloadFromDrive('merge');
      }
    },
    [
      handleDownloadFromDrive,
      language,
      platform,
      prepareUpload,
      setStatusMessage,
      setSyncState,
      t,
      withdraw,
    ],
  );

  return {
    isUploading,
    isDownloading,
    downloadMode,
    undo,
    handleSyncNow,
    handleDownloadFromDrive,
  };
}
