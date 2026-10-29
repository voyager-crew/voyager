import type { CloudSyncPayload } from '@/core/services/CloudSyncTransferContext';
import {
  HIGHLIGHTS_FILE_NAME,
  PLUGINS_FILE_NAME,
  SETTINGS_FILE_NAME,
  TIMELINE_HIERARCHY_FILE_NAME,
} from '@/core/services/GoogleDriveSyncFileNames';
import type { DriveHistoryRestoreTarget } from '@/core/types/driveHistory';

/** The scope that named each file, preserved separately from the folder isolation setting. */
export function historyTargets(
  payload: CloudSyncPayload,
  files: readonly string[],
): DriveHistoryRestoreTarget[] {
  return files.map((name) => {
    const base = name.replace(/\.acct-[a-z0-9]+(?=\.json$)/, '');
    // The concrete filename is authoritative: a captured account never scopes a base file.
    if (base === name) return { name, accountScope: null };
    const accountScope =
      base === TIMELINE_HIERARCHY_FILE_NAME
        ? (payload.timelineHierarchyAccountScope ?? payload.accountScope)
        : base === HIGHLIGHTS_FILE_NAME
          ? (payload.highlightAccountScope ??
            payload.timelineHierarchyAccountScope ??
            payload.accountScope)
          : base === SETTINGS_FILE_NAME ||
              base === PLUGINS_FILE_NAME ||
              /^gemini-voyager-(?:timeline-hierarchy|stars)\.site-/.test(base)
            ? null
            : payload.accountScope;
    return { name, accountScope };
  });
}
