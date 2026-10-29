import type { DriveHistoryRestoreFile } from '@/core/types/driveHistory';
import {
  type CloudUploadWrittenFile,
  parseCloudUploadReceipt,
} from '@/core/types/syncUploadReceipt';

import { retainICloudHistory } from './safariICloudHistory';
import { invalidICloudResponse as invalid, sendICloudRequest as send } from './safariICloudRequest';

export { readICloudUploadVersion } from './safariICloudRequest';

export async function writeICloudUpload(
  fileName: string,
  data: unknown,
  expectedVersion: string | null,
): Promise<CloudUploadWrittenFile> {
  const json = JSON.stringify(data);
  if (typeof json !== 'string') throw invalid();
  const result = await send({ action: 'iCloudWriteUpload', fileName, json, expectedVersion });
  const receipt = parseCloudUploadReceipt({ complete: true, files: [result] });
  const file = receipt?.files[0];
  if (
    !file ||
    file.name !== fileName ||
    file.fileId !== fileName ||
    !/^[a-f0-9]{32}$/.test(file.md5Checksum)
  ) {
    throw invalid();
  }
  await retainICloudHistory(
    fileName,
    file.replaced.kind === 'history' ? file.replaced.historyId : undefined,
  );
  return file;
}

export async function undoICloudUpload(
  receipt: CloudUploadWrittenFile,
): Promise<DriveHistoryRestoreFile> {
  const data = await send({ action: 'iCloudUndoUpload', receipt });
  if (data.name !== receipt.name) throw invalid();
  switch (data.status) {
    case 'restored':
      if (receipt.replaced.kind === 'history' && data.historyId === receipt.replaced.historyId) {
        await retainICloudHistory(
          receipt.name,
          typeof data.retentionHistoryId === 'string' ? data.retentionHistoryId : undefined,
        );
        return { name: receipt.name, status: 'restored', historyId: receipt.replaced.historyId };
      }
      throw invalid();
    case 'removed':
      if (receipt.replaced.kind !== 'created') throw invalid();
      return { name: receipt.name, status: 'removed' };
    case 'kept':
    case 'no_history':
    case 'unrecognized_history':
    case 'read_failed':
    case 'write_failed':
    case 'unsupported_provider':
      return { name: receipt.name, status: data.status };
    default:
      throw invalid();
  }
}
