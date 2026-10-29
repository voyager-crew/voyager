export type FolderCloudApplyPart = 'folders' | 'extras' | 'catalog';

export interface FolderCloudApplyProgress {
  readonly snapshotId?: string;
  readonly restored: readonly FolderCloudApplyPart[];
}

export type FolderCloudApplyResult = FolderCloudApplyProgress &
  (
    | { readonly status: 'applied'; readonly catalogRestored: boolean }
    | { readonly status: 'cancelled' }
  );

/** An issued owner settles before its download's error and undo target are reported. */
export class FolderCloudApplyError extends Error {
  constructor(
    readonly restored: readonly FolderCloudApplyPart[],
    cause: unknown,
    readonly snapshotId?: string,
  ) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = 'FolderCloudApplyError';
  }
}
