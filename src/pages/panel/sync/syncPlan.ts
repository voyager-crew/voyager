import { FOLDER_PLATFORM_IDS, isFolderPlatform } from '@/features/folder/platforms';

import type { RowStatus, StatusFile, StatusRow } from './syncProtocol';
import type { UploadRefusal } from './syncTransfer';

/** A row the sheet lists: 通用, or a site with its own files. */
export interface SheetRowSpec {
  readonly key: string;
  readonly label: string;
}

export type StepOp = 'upload' | 'download';
export interface RunStep {
  readonly row: string;
  readonly op: StepOp;
  /**
   * After the guard: 仍然上传 (`force`, the refused upload with its token) or
   * 改为从云端合并 (`merge`, this step's download), each only for the refused accounts.
   */
  readonly answer?: { readonly choice: 'force' | 'merge'; readonly refusal: UploadRefusal };
}

export type RunKind = 'pending' | 'uploadAll' | 'mergeAll';

/** Rows the background can report on: 通用 and the folder platforms (catalog sites are among them). */
export function isSyncableRow(row: string): boolean {
  return row === 'shared' || isFolderPlatform(row);
}

export const SYNCABLE_SITE_IDS: readonly string[] = FOLDER_PLATFORM_IDS;

const UPLOADS: readonly RowStatus[] = ['newer_here', 'not_uploaded'];
const MERGES: readonly RowStatus[] = ['newer_in_cloud', 'to_merge'];

export function isPending(row: StatusRow): boolean {
  return row.included && (UPLOADS.includes(row.status) || MERGES.includes(row.status));
}

/** Whether a row can take part in a run at all: on, and its account confirmed. */
export function isRunnable(row: StatusRow): boolean {
  // A row whose status could not be read takes no part either: nothing is sent blind.
  return (
    row.included &&
    row.status !== 'account_unconfirmed' &&
    row.status !== 'excluded' &&
    row.status !== 'failed'
  );
}

/**
 * Each row in its own direction (spec): newer here or not uploaded → upload;
 * newer in cloud, both changed or first connect → merge download, then upload
 * the merged result. 全部上传 uploads every runnable row; 全部从云端合并 merges
 * every runnable row down and uploads nothing.
 */
export function planRun(kind: RunKind, rows: readonly StatusRow[]): RunStep[] {
  return rows.flatMap((row): RunStep[] => {
    if (kind === 'uploadAll') return isRunnable(row) ? [{ row: row.row, op: 'upload' }] : [];
    if (kind === 'mergeAll') return isRunnable(row) ? [{ row: row.row, op: 'download' }] : [];
    if (!isPending(row)) return [];
    return MERGES.includes(row.status)
      ? [
          { row: row.row, op: 'download' },
          { row: row.row, op: 'upload' },
        ]
      : [{ row: row.row, op: 'upload' }];
  });
}

/** The guard's two answers replace the refused upload, so nothing is written before the choice. */
export function resumeAfterGuard(
  steps: readonly RunStep[],
  index: number,
  choice: 'mergeInstead' | 'uploadAnyway',
  refusal: UploadRefusal,
): RunStep[] {
  const refused = steps[index];
  if (!refused) return [...steps];
  const replacement: RunStep[] =
    choice === 'uploadAnyway'
      ? [{ row: refused.row, op: 'upload', answer: { choice: 'force', refusal } }]
      : [
          { row: refused.row, op: 'download', answer: { choice: 'merge', refusal } },
          { row: refused.row, op: 'upload' },
        ];
  return [...steps.slice(0, index), ...replacement, ...steps.slice(index + 1)];
}

/**
 * Files whose cloud copy an upload of this row replaced and that have a copy
 * from before it: changed rows only (an unchanged file's copy may predate
 * this sync), and never a file the cloud did not have.
 */
export function revertibleFiles(row: StatusRow | undefined): string[] {
  return (row?.files ?? [])
    .filter((file: StatusFile) => file.md5 !== null && file.status !== 'synced')
    .map((file) => file.name);
}

/** The newest per-file baseline, for "Synced 12 min ago". */
export function lastSyncedAt(rows: readonly StatusRow[], fallback: number | null): number | null {
  const times = rows.flatMap((row) =>
    row.files.map((file) => file.syncedAt).filter((stamp): stamp is number => stamp !== null),
  );
  return times.length ? Math.max(...times) : fallback;
}

/** Sites that are off here but have files in the cloud, for the rows under the hairline. */
export function hasCloudData(row: StatusRow | undefined): boolean {
  return !!row && row.files.some((file) => file.md5 !== null);
}
