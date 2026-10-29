import type { UploadGuardDecision, UploadGuardOptions } from '@/core/types/syncUploadGuard';
import { readDriveValue } from '@/core/utils/driveReadResult';
import { FOLDER_PLATFORMS } from '@/features/folder/platforms';

import { CloudSyncFailure } from './CloudSyncFailure';
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
  const selection = snapshot.selection ?? {};
  const files: GuardedUploadData[] = [];
  if (selection.site !== false) files.push({ kind: 'folders', data: snapshot.folders });
  if (definition.syncsSharedData && selection.shared !== false) {
    // Omitted empty libraries cannot replace the cloud file and need no confirmation.
    if (snapshot.prompts.length > 0) files.push({ kind: 'prompts', data: snapshot.prompts });
    if (snapshot.plugins) files.push({ kind: 'plugins', data: snapshot.plugins });
  }
  if (selection.site !== false && definition.syncsConversationExtras) {
    if (selection.conversationExtras !== false && snapshot.forks)
      files.push({ kind: 'forks', data: snapshot.forks });
    if (selection.timelineHierarchy !== false && snapshot.timelineHierarchy)
      files.push({ kind: 'timelineHierarchy', data: snapshot.timelineHierarchy });
  }
  const counts = [];
  for (const file of files) {
    const cloud = await readDriveValue(() => read(file.kind));
    // Force only bypasses a refusal. A later failed read must still abort the operation.
    if (cloud.kind === 'failed')
      throw new CloudSyncFailure(
        'cloud_read_failed',
        cloud.error instanceof Error ? cloud.error.message : String(cloud.error),
        { cause: cloud.error },
      );
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
  const decision = checkUploadGuard(
    counts,
    options.authorizeRefusal ? false : options.force === true,
  );
  return decision.kind === 'refused' && options.authorizeRefusal
    ? options.authorizeRefusal(decision)
    : decision;
}
