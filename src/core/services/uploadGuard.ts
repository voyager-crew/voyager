import type { FolderData } from '@/core/types/folder';
import type {
  ForkNodesDataSync,
  PromptItem,
  SyncPlatform,
  TimelineHierarchyDataSync,
} from '@/core/types/sync';
import type {
  GuardedUploadKind,
  UploadGuardDecision,
  UploadGuardRefusedFile,
} from '@/core/types/syncUploadGuard';
import { FOLDER_PLATFORMS } from '@/features/folder/platforms';
import { FolderImportExportService } from '@/features/folder/services/FolderImportExportService';
import { sanitizePluginState, type PluginStateMap } from '@/features/plugins/storage/pluginState';
import { normalizeTimelineHierarchyData } from '@/features/timeline/hierarchyTypes';

import { decodePromptDrivePayload } from './drivePromptPayload';

export type GuardedUploadData =
  | { kind: 'folders'; data: FolderData }
  | { kind: 'prompts'; data: PromptItem[] }
  | { kind: 'timelineHierarchy'; data: TimelineHierarchyDataSync }
  | { kind: 'forks'; data: ForkNodesDataSync }
  | { kind: 'plugins'; data: PluginStateMap };

export interface UploadGuardCounts {
  kind: GuardedUploadKind;
  localCount: number;
  /** Null means an existing file is unrecognized; a missing file is zero. */
  cloudCount: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function countFolders(data: FolderData): number {
  return data.folders.reduce(
    (count, folder) =>
      count +
      1 +
      (Object.prototype.hasOwnProperty.call(data.folderContents, folder.id)
        ? data.folderContents[folder.id].length
        : 0),
    0,
  );
}

/** Counts user content, independently of export metadata and auxiliary indexes. */
export function countUploadItems(input: GuardedUploadData): number {
  switch (input.kind) {
    case 'folders':
      return countFolders(input.data);
    case 'prompts':
      return input.data.length;
    case 'timelineHierarchy':
      return Object.values(input.data.conversations).reduce(
        (sum, conversation) =>
          sum +
          Object.values(conversation.levels).filter(
            (level) => level === 1 || level === 2 || level === 3,
          ).length,
        0,
      );
    case 'forks':
      return Object.values(input.data.nodes).reduce((sum, nodes) => sum + nodes.length, 0);
    case 'plugins':
      return Object.keys(input.data).length;
    default: {
      const exhaustive: never = input;
      return exhaustive;
    }
  }
}

function countCloudFolders(raw: unknown, platform?: SyncPlatform): number | null {
  if (
    !isRecord(raw) ||
    raw.format !== 'gemini-voyager.folders.v1' ||
    !isRecord(raw.data) ||
    !isRecord(raw.data.folderContents)
  ) {
    return null;
  }
  const siteExport = platform ? FOLDER_PLATFORMS[platform].folderExport : null;
  if (siteExport) {
    const decoded = siteExport.read(raw);
    return decoded.ok ? countFolders(decoded.payload.data) : null;
  }
  const decoded = FolderImportExportService.validatePayload(raw);
  return decoded.success ? countFolders(decoded.data.data) : null;
}

function countCloudForks(data: Record<string, unknown>): number | null {
  if (!isRecord(data.nodes) || !isRecord(data.groups)) return null;
  let count = 0;
  for (const nodes of Object.values(data.nodes)) {
    if (!Array.isArray(nodes)) return null;
    for (const node of nodes) {
      if (
        !isRecord(node) ||
        typeof node.turnId !== 'string' ||
        typeof node.conversationId !== 'string' ||
        typeof node.conversationUrl !== 'string' ||
        typeof node.forkGroupId !== 'string' ||
        typeof node.forkIndex !== 'number' ||
        typeof node.createdAt !== 'number'
      ) {
        return null;
      }
      count++;
    }
  }
  if (
    Object.values(data.groups).some(
      (group) => !Array.isArray(group) || group.some((key) => typeof key !== 'string'),
    )
  ) {
    return null;
  }
  return count;
}

function countCloudHierarchy(data: Record<string, unknown>): number | null {
  if (!isRecord(data.conversations)) return null;
  if (
    Object.values(data.conversations).some(
      (conversation) =>
        !isRecord(conversation) ||
        !isRecord(conversation.levels) ||
        Object.values(conversation.levels).some(
          (level) => level !== 1 && level !== 2 && level !== 3,
        ) ||
        !Array.isArray(conversation.collapsed),
    )
  ) {
    return null;
  }
  return countUploadItems({
    kind: 'timelineHierarchy',
    data: normalizeTimelineHierarchyData(data),
  });
}

/** Parse the same content a download can consume; never mistake an unknown container for empty. */
export function countCloudUploadItems(
  kind: GuardedUploadKind,
  raw: unknown,
  platform?: SyncPlatform,
): number | null {
  if (kind === 'folders') return countCloudFolders(raw, platform);
  if (kind === 'prompts') return decodePromptDrivePayload(raw)?.items.length ?? null;
  if (!isRecord(raw) || !isRecord(raw.data)) return null;
  switch (kind) {
    case 'forks':
      return raw.format === 'gemini-voyager.forks.v1' ? countCloudForks(raw.data) : null;
    case 'timelineHierarchy':
      return raw.format === 'gemini-voyager.timeline-hierarchy.v1'
        ? countCloudHierarchy(raw.data)
        : null;
    case 'plugins': {
      if (raw.format !== 'gemini-voyager.plugins.v1') return null;
      const count = Object.keys(sanitizePluginState(raw.data)).length;
      return count === 0 && Object.keys(raw.data).length > 0 ? null : count;
    }
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

/** One refusal contains every kind; force bypasses this decision and cannot mask a read error. */
export function checkUploadGuard(
  files: readonly UploadGuardCounts[],
  force: boolean = false,
): UploadGuardDecision {
  if (force) return { kind: 'allowed' };
  const refusedFiles: UploadGuardRefusedFile[] = [];
  for (const { kind, localCount, cloudCount } of files) {
    if (cloudCount === null) {
      refusedFiles.push({ kind, localCount, cloudCount, reason: 'unrecognized' });
    } else if (localCount === 0 && cloudCount > 0) {
      refusedFiles.push({ kind, localCount, cloudCount, reason: 'empty_local' });
    } else if (cloudCount >= 4 && localCount < cloudCount / 2) {
      refusedFiles.push({ kind, localCount, cloudCount, reason: 'large_drop' });
    }
  }
  return refusedFiles.length > 0
    ? { kind: 'refused', error: 'upload_guard_refused', refusedFiles }
    : { kind: 'allowed' };
}
