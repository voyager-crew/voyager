import type { SyncPlatform } from '@/core/types/sync';
import { readDriveValue } from '@/core/utils/driveReadResult';

import { isCloudRecord, readCloudApplyPayloads } from './CloudSyncApplyPlan';
import type { GoogleDriveDownload } from './GoogleDriveSyncPayloads';
import { countCloudUploadItems } from './uploadGuard';

export type DriveDownloadKind =
  | 'folders'
  | 'prompts'
  | 'settings'
  | 'plugins'
  | 'starred'
  | 'stars'
  | 'forks'
  | 'timelineHierarchy'
  | 'highlights';
export type DriveDownloadKindStatus = 'found' | 'missing' | 'unrecognized' | 'failed';
export type DriveDownloadStatuses = Partial<Record<DriveDownloadKind, DriveDownloadKindStatus>>;

/** Keep the transport classification even when the apply payload itself is null. */
export async function readDownloadKind<K extends Exclude<DriveDownloadKind, 'highlights'>>(
  kind: K,
  platform: SyncPlatform,
  read: () => Promise<GoogleDriveDownload[K]>,
  statuses: DriveDownloadStatuses,
): Promise<GoogleDriveDownload[K] | null> {
  const result = await readDriveValue(read);
  statuses[kind] = result.kind;
  if (result.kind === 'failed') throw result.error;
  if (result.kind !== 'found') return null;
  const value = result.value;
  let recognized: boolean;
  switch (kind) {
    case 'folders':
    case 'prompts':
    case 'plugins':
    case 'forks':
    case 'timelineHierarchy':
      recognized = countCloudUploadItems(kind, value, platform) !== null;
      break;
    case 'settings':
      recognized = readCloudApplyPayloads({ settings: value }).settings.status === 'found';
      break;
    case 'starred':
      recognized =
        isCloudRecord(value) &&
        value.format === 'gemini-voyager.starred.v1' &&
        isCloudRecord(value.data) &&
        isCloudRecord(value.data.messages);
      break;
    case 'stars':
      // The scoped stars reader already validates the envelope against its captured account.
      recognized = true;
      break;
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
  if (!recognized) {
    statuses[kind] = 'unrecognized';
    return null;
  }
  return value;
}
