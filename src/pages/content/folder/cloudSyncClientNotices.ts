/**
 * The folder panel's sync notices: one result toast per transfer, worded by
 * the shared sync notices, with Undo for the download that just ran when the
 * site can show a full notice. Undo holds while the pointer or focus is on it.
 */
import { CloudRestoreError } from '@/core/services/CloudSyncApplyService';
import { undoCloudSyncSnapshot } from '@/core/services/CloudSyncSnapshotService';
import {
  type CloudSyncNotice,
  type DownloadFailure,
  undoNotice,
} from '@/core/services/cloudSyncNotices';
import type { ToastAction, ToastInput, ToastTone } from '@/core/ui/toast/types';
import type {
  FolderCloudApplyError,
  FolderCloudApplyPart,
} from '@/features/folder/services/cloudDownloadApplyResult';

import type { CloudSyncSite } from './cloudSyncClient';

/** How long an Undo stays offered, not counting while the person is on it. */
export const UNDO_NOTICE_MS = 10_000;
const RESULT_MS: Readonly<Record<CloudSyncNotice['tone'], number>> = {
  ok: 3000,
  warn: 7000,
  err: 10_000,
};
const TONES: Readonly<Record<CloudSyncNotice['tone'], ToastTone>> = {
  ok: 'success',
  warn: 'warning',
  err: 'error',
};
const LINE_SEPARATOR = ' · ';

function noticeFields(notice: CloudSyncNotice): Pick<ToastInput, 'title' | 'message' | 'tone'> {
  return notice.lines.length > 0
    ? {
        title: notice.headline,
        message: notice.lines.join(LINE_SEPARATOR),
        tone: TONES[notice.tone],
      }
    : { title: undefined, message: notice.headline, tone: TONES[notice.tone] };
}

function undoAction(site: CloudSyncSite, snapshotId: string): ToastAction {
  const action: ToastAction = {
    label: site.t('syncUndo'),
    run: (handle) => {
      handle.update({
        title: undefined,
        message: site.t('syncUndoing'),
        tone: 'info',
        pending: true,
        action: undefined,
        durationMs: null,
      });
      // The handle goes quiet once a later transfer notice takes the channel.
      void undoCloudSyncSnapshot(snapshotId).then((result) => {
        const outcome = undoNotice(site.t, result);
        handle.update({
          ...noticeFields(outcome),
          pending: false,
          action: outcome.retry ? action : undefined,
          pauseOnHover: outcome.retry,
          durationMs: outcome.retry ? UNDO_NOTICE_MS : RESULT_MS[outcome.tone],
        });
      });
    },
  };
  return action;
}

/**
 * Shows a transfer result. With `undoFor`, the notice offers Undo for that
 * download, on sites that can show one; the others get the result alone.
 */
export function showCloudResult(
  site: CloudSyncSite,
  notice: CloudSyncNotice,
  undoFor?: string,
): void {
  if (site.notice) {
    site.notice({
      ...noticeFields(notice),
      ...(undoFor
        ? { action: undoAction(site, undoFor), pauseOnHover: true, durationMs: UNDO_NOTICE_MS }
        : { durationMs: RESULT_MS[notice.tone] }),
    });
    return;
  }
  site.notify(
    [notice.headline, ...notice.lines].join(LINE_SEPARATOR),
    notice.tone === 'ok' ? 'success' : notice.tone === 'warn' ? 'warning' : 'error',
  );
}

const APPLY_KINDS = { folders: 'folders', catalog: 'outlines' } as const;

/**
 * What a folder-panel apply that failed partway restored and did not. A
 * site's own restore names its kinds; the shared phases name theirs.
 */
export function folderApplyFailure(
  error: FolderCloudApplyError,
  planned: { readonly catalog: boolean },
): DownloadFailure {
  const inner = error.cause instanceof CloudRestoreError ? error.cause : null;
  if (inner) {
    return {
      cause: inner.cause,
      restored: inner.restored,
      failed: planned.catalog ? [...inner.failed, 'outlines'] : inner.failed,
      skipped: inner.skipped,
      reason: inner.reason,
    };
  }
  const phases: readonly Exclude<FolderCloudApplyPart, 'extras'>[] = [
    'folders',
    ...(planned.catalog ? (['catalog'] as const) : []),
  ];
  return {
    cause: error.cause,
    restored: error.restored.flatMap((part) => (part === 'extras' ? [] : [APPLY_KINDS[part]])),
    failed: phases
      .filter((part) => !error.restored.includes(part))
      .map((part) => APPLY_KINDS[part]),
  };
}
