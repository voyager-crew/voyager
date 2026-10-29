import type { ForkExportPayload, TimelineHierarchyExportPayload } from '@/core/types/sync';
import { FOLDER_PLATFORMS } from '@/features/folder/platforms';

import { createDriveInitialPayloads } from './GoogleDriveInitialPayloads';
import type { GoogleDriveScopedFiles } from './GoogleDriveScopedFiles';
import {
  FORKS_FILE_NAME,
  PROMPTS_FILE_NAME,
  TIMELINE_HIERARCHY_FILE_NAME,
} from './GoogleDriveSyncFileNames';
import type { GoogleDriveUploadSnapshot } from './GoogleDriveSyncPayloads';

/** Copy authorized route-only content into the new email file without changing local buckets. */
export async function mergeLegacyUploadSnapshot(
  token: string,
  snapshot: GoogleDriveUploadSnapshot,
  scoped: GoogleDriveScopedFiles,
): Promise<GoogleDriveUploadSnapshot> {
  const definition = FOLDER_PLATFORMS[snapshot.platform];
  const initial = createDriveInitialPayloads(snapshot, new Date());
  const folderScope = definition.accountIsolationStorageKey === null ? null : snapshot.accountScope;
  const folders = await scoped.mergeForUpload(
    token,
    definition.driveFoldersFileName,
    folderScope,
    initial.folderPayload,
  );
  const next = { ...snapshot, folders: folders.data };
  if (!definition.syncsSharedData) return next;
  next.prompts = (
    await scoped.mergeForUpload(
      token,
      PROMPTS_FILE_NAME,
      snapshot.accountScope,
      initial.promptPayload,
    )
  ).items;
  if (definition.syncsConversationExtras && snapshot.forks) {
    const payload: ForkExportPayload = {
      format: 'gemini-voyager.forks.v1',
      exportedAt: initial.folderPayload.exportedAt,
      data: snapshot.forks,
    };
    next.forks = (
      await scoped.mergeForUpload(token, FORKS_FILE_NAME, snapshot.accountScope, payload)
    ).data;
  }
  if (definition.syncsConversationExtras && snapshot.timelineHierarchy) {
    const payload: TimelineHierarchyExportPayload = {
      format: 'gemini-voyager.timeline-hierarchy.v1',
      exportedAt: initial.folderPayload.exportedAt,
      data: snapshot.timelineHierarchy,
    };
    next.timelineHierarchy = (
      await scoped.mergeForUpload(
        token,
        TIMELINE_HIERARCHY_FILE_NAME,
        snapshot.timelineHierarchyAccountScope ?? snapshot.accountScope,
        payload,
      )
    ).data;
  }
  return next;
}
