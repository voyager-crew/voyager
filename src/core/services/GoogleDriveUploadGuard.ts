import type { UploadGuardDecision, UploadGuardOptions } from '@/core/types/syncUploadGuard';
import { readDriveValue } from '@/core/utils/driveReadResult';
import { FOLDER_PLATFORMS } from '@/features/folder/platforms';

import type { GoogleDriveUploadSnapshot } from './GoogleDriveSyncPayloads';
import { checkUploadGuard, countCloudUploadItems, countUploadItems } from './uploadGuard';
import type { GuardedUploadData } from './uploadGuard';

/** Check every selected kind before star merges, file creation or content replacement. */
export async function guardDriveUpload(
  snapshot: GoogleDriveUploadSnapshot,
  options: UploadGuardOptions,
  read: (kind: GuardedUploadData['kind']) => Promise<unknown | null>,
): Promise<UploadGuardDecision> {
  const definition = FOLDER_PLATFORMS[snapshot.platform];
  const files: GuardedUploadData[] = [{ kind: 'folders', data: snapshot.folders }];
  if (definition.syncsSharedData) {
    // Empty prompts are currently omitted from writes, but still need loss protection.
    files.push({ kind: 'prompts', data: snapshot.prompts });
    if (snapshot.plugins) files.push({ kind: 'plugins', data: snapshot.plugins });
    if (definition.syncsConversationExtras) {
      if (snapshot.forks) files.push({ kind: 'forks', data: snapshot.forks });
      if (snapshot.timelineHierarchy)
        files.push({ kind: 'timelineHierarchy', data: snapshot.timelineHierarchy });
    }
  }
  const counts = [];
  for (const file of files) {
    const cloud = await readDriveValue(() => read(file.kind));
    // Force only bypasses a refusal. A later failed read must still abort the operation.
    if (cloud.kind === 'failed') throw cloud.error;
    counts.push({
      kind: file.kind,
      localCount: countUploadItems(file),
      cloudCount:
        cloud.kind === 'missing'
          ? 0
          : cloud.kind === 'unrecognized'
            ? null
            : countCloudUploadItems(file.kind, cloud.value, snapshot.platform),
    });
  }
  return checkUploadGuard(counts, options.force === true);
}
