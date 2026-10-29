import type { DriveHistoryRestoreFile } from '@/core/types/driveHistory';
import type { CloudUploadWrittenFile } from '@/core/types/syncUploadReceipt';
import { undoICloudUpload } from '@/core/utils/safariICloudUploadReceipt';

import type { DriveFilesPort } from './GoogleDriveFiles';
import { GoogleDriveUploadHistory } from './GoogleDriveUploadHistory';
import { DriveVersionChangedError } from './GoogleDriveWriteVersion';

/** Exact run Undo never selects history by recency and never overwrites a later cloud version. */
export async function undoDriveUploadFile(
  files: Pick<
    DriveFilesPort,
    | 'find'
    | 'metadata'
    | 'downloadText'
    | 'uploadText'
    | 'createHistory'
    | 'listHistory'
    | 'supportsHistory'
    | 'trash'
  >,
  token: string,
  receipt: CloudUploadWrittenFile,
  beforeWrite: () => Promise<void>,
): Promise<DriveHistoryRestoreFile> {
  const { name, fileId, md5Checksum, replaced } = receipt;
  const check = async () => {
    if ((await files.find(token, name)) !== fileId) throw new DriveVersionChangedError();
    const current = await files.metadata(token, fileId);
    if (!current || current.md5Checksum !== md5Checksum) throw new DriveVersionChangedError();
  };
  try {
    if (!files.supportsHistory()) {
      await beforeWrite();
      return await undoICloudUpload(receipt);
    }
    await check();
    if (replaced.kind === 'created') {
      await beforeWrite();
      await files.trash(token, fileId, check);
      return { name, status: 'removed' };
    }
    const history = new GoogleDriveUploadHistory(files);
    const plan = await history.prepare(token, name, fileId);
    if (!plan.entries.some((entry) => entry.id === replaced.historyId))
      return { name, status: 'no_history' };
    const text = plan.archived.get(replaced.historyId);
    if (text === undefined) return { name, status: 'read_failed' };
    await history.preserve(token, name, plan);
    await beforeWrite();
    // The final check is inside each transport attempt, after history and auth work.
    await files.uploadText(token, fileId, text, check);
    await history.retain(token, plan);
    return { name, status: 'restored', historyId: replaced.historyId };
  } catch (error) {
    return { name, status: error instanceof DriveVersionChangedError ? 'kept' : 'write_failed' };
  }
}
