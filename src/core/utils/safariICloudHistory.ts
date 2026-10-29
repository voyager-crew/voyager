import { isRecognizedHistoryContent } from '@/core/services/GoogleDriveHistoryPayload';
import { DRIVE_HISTORY_KEEP_COUNT } from '@/core/services/GoogleDriveUploadHistory';
import { logger } from '@/core/services/LoggerService';
import type { DriveHistoryRestoreFile } from '@/core/types/driveHistory';

import {
  invalidICloudResponse,
  isICloudRecord,
  readICloudUploadVersion,
  sendICloudRequest,
} from './safariICloudRequest';

interface ICloudHistoryFile {
  id: string;
  json: string;
  createdTime: number | null;
}

async function readHistory(
  fileName: string,
  includingHistoryId?: string,
): Promise<ICloudHistoryFile[]> {
  const data = await sendICloudRequest({
    action: 'iCloudReadHistory',
    fileName,
    ...(includingHistoryId ? { includingHistoryId } : {}),
  });
  if (!Array.isArray(data.files)) throw invalidICloudResponse();
  const files: ICloudHistoryFile[] = [];
  const ids = new Set<string>();
  for (const file of data.files) {
    if (
      !isICloudRecord(file) ||
      typeof file.id !== 'string' ||
      !file.id ||
      ids.has(file.id) ||
      typeof file.json !== 'string' ||
      (file.createdTime != null &&
        (typeof file.createdTime !== 'number' || !Number.isFinite(file.createdTime)))
    )
      throw invalidICloudResponse();
    files.push({
      id: file.id,
      json: file.json,
      createdTime: typeof file.createdTime === 'number' ? file.createdTime : null,
    });
    ids.add(file.id);
  }
  if (includingHistoryId && !ids.has(includingHistoryId)) throw invalidICloudResponse();
  return files.sort(
    (a, b) =>
      (b.createdTime ?? -Infinity) - (a.createdTime ?? -Infinity) || b.id.localeCompare(a.id),
  );
}

/** Called only after confirmed main writes; failed cleanup keeps extra bytes and a usable receipt. */
export async function retainICloudHistory(
  fileName: string,
  protectedHistoryId?: string,
): Promise<void> {
  try {
    const files = await readHistory(fileName, protectedHistoryId);
    const recognized = files.filter(
      (file) => file.createdTime !== null && isRecognizedHistoryContent(fileName, file.json),
    );
    // Protect the before-image this receipt needs, including timestamp ties and query indexing lag.
    const protectedFile = recognized.find((file) => file.id === protectedHistoryId);
    const ordered = protectedFile
      ? [protectedFile, ...recognized.filter((file) => file !== protectedFile)]
      : recognized;
    const cutoff = ordered[DRIVE_HISTORY_KEEP_COUNT - 1]?.createdTime;
    // Equal timestamps or a later device's archives cannot prove an entry is older; keep excess.
    const stale = ordered
      .slice(DRIVE_HISTORY_KEEP_COUNT)
      .filter(
        (file) =>
          file.id !== protectedHistoryId &&
          file.createdTime !== null &&
          cutoff != null &&
          file.createdTime < cutoff &&
          (protectedFile?.createdTime == null || file.createdTime < protectedFile.createdTime),
      );
    if (!stale.length) return;
    const result = await sendICloudRequest({
      action: 'iCloudPruneHistory',
      fileName,
      historyIds: stale.map((file) => file.id),
      ...(protectedHistoryId ? { protectedHistoryId } : {}),
    });
    if (!Array.isArray(result.errors) || result.errors.length || result.deleted !== stale.length)
      throw invalidICloudResponse();
  } catch (error) {
    logger.warn('[iCloud] History retention kept excess recovery copies', { fileName, error });
  }
}

export async function restoreICloudPreviousVersion(
  fileName: string,
  beforeWrite: () => Promise<void>,
): Promise<DriveHistoryRestoreFile> {
  let current: Awaited<ReturnType<typeof readICloudUploadVersion>>;
  let selected: ICloudHistoryFile | undefined;
  try {
    current = await readICloudUploadVersion(fileName);
    const files = await readHistory(fileName);
    const recognized = files.filter(
      (file) => file.createdTime !== null && isRecognizedHistoryContent(fileName, file.json),
    );
    selected = recognized.find((file) => file.json !== current.json);
    if (!selected)
      return {
        name: fileName,
        status: files.length && !recognized.length ? 'unrecognized_history' : 'no_history',
      };
  } catch {
    return { name: fileName, status: 'read_failed' };
  }
  try {
    await beforeWrite();
    const result = await sendICloudRequest({
      action: 'iCloudRestoreHistory',
      fileName,
      historyId: selected.id,
      expectedVersion: current.version,
    });
    if (result.name !== fileName) throw invalidICloudResponse();
    if (result.status === 'restored' && result.historyId === selected.id) {
      if (result.retentionHistoryId !== undefined && typeof result.retentionHistoryId !== 'string')
        throw invalidICloudResponse();
      await retainICloudHistory(fileName, result.retentionHistoryId);
      return { name: fileName, status: 'restored', historyId: selected.id };
    }
    switch (result.status) {
      case 'kept':
      case 'no_history':
      case 'read_failed':
      case 'write_failed':
        return { name: fileName, status: result.status };
      default:
        throw invalidICloudResponse();
    }
  } catch {
    return { name: fileName, status: 'write_failed' };
  }
}
