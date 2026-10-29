import type { DriveFileMetadata } from './CloudSyncBookkeeping';
import type { DriveFilesPort } from './GoogleDriveFiles';
import type { GoogleDriveUploadHistory, PreparedDriveHistory } from './GoogleDriveUploadHistory';

/** Runs again on every transport attempt, immediately before the mutation. */
export type DriveWriteCheck = () => Promise<void>;

/** A current byte-identical file needs bookkeeping, but no mutation or Undo target. */
export class DriveWriteUnchanged extends Error {
  constructor(readonly metadata: DriveFileMetadata) {
    super('cloud_write_unchanged');
  }
}

export class DriveVersionChangedError extends Error {
  constructor() {
    super('cloud_version_changed');
  }
}

type Files = Pick<DriveFilesPort, 'metadata' | 'downloadText'>;

function sameVersion(a: DriveFileMetadata | null, b: DriveFileMetadata | null): boolean {
  return a?.md5Checksum === b?.md5Checksum && a?.modifiedTime === b?.modifiedTime;
}

/** A stable media read; never label old bytes with metadata fetched for a later write. */
export async function readDriveVersion(files: Files, token: string, id: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = await files.metadata(token, id);
    const text = before ? await files.downloadText(token, id) : null;
    const after = await files.metadata(token, id);
    if (sameVersion(before, after)) return { text, metadata: after };
  }
  throw new DriveVersionChangedError();
}

/** Drive v3's media path has no verified compare-and-swap transport here. */
export async function preserveLatestDriveVersion(options: {
  files: Files;
  history: GoogleDriveUploadHistory;
  plan: PreparedDriveHistory;
  token: string;
  name: string;
  id: string;
  next: string;
  created?: boolean;
}): Promise<{ metadata: DriveFileMetadata | null; historyId: string | null }> {
  const { files, history, plan, token, name, id, next } = options;
  for (let attempt = 0; attempt < 3; attempt++) {
    const current = await readDriveVersion(files, token, id);
    // A removed/trashed target is a conflict, never a stable destination for media PATCH.
    if (!current.metadata) throw new DriveVersionChangedError();
    plan.current = current.text;
    const archived =
      current.text !== next ? await history.preserve(token, name, plan, !options.created) : null;
    // Another device may have written while we archived. Re-plan instead of losing its body.
    const latest = await files.metadata(token, id);
    if (!latest) throw new DriveVersionChangedError();
    if (sameVersion(latest, current.metadata))
      return { metadata: latest, historyId: archived?.id ?? null };
  }
  throw new DriveVersionChangedError();
}
