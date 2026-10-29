import type { FolderData } from '@/core/types/folder';
import type { PromptItem } from '@/core/types/sync';
import { validateFolderData } from '@/features/folder/model/folderData';
import { isRestorablePluginState } from '@/features/plugins/storage/pluginState';
import { parsePromptLibraryOp } from '@/features/prompt/library/promptLibraryMessages';
import {
  type TimelineHierarchyData,
  isTimelineHierarchyData,
} from '@/features/timeline/hierarchyTypes';

export type CloudApplyKind = 'folders' | 'prompts' | 'settings' | 'plugins' | 'timelineHierarchy';
export type CloudPayloadStatus = 'found' | 'missing' | 'unrecognized';
export type CloudPayload<T> =
  | { status: 'found'; value: T }
  | { status: 'missing' }
  | { status: 'unrecognized' };
export interface CloudApplySkip {
  kind: CloudApplyKind;
  reason: 'missing' | 'unrecognized' | 'empty-plugin-map';
}

/** Transport statuses stay independent of the payload: null currently means missing. */
export interface CloudApplyDownload {
  folders?: unknown;
  prompts?: unknown;
  settings?: unknown;
  plugins?: unknown;
  timelineHierarchy?: unknown;
  kindStatus?: Partial<Record<CloudApplyKind, CloudPayloadStatus>>;
}

export function isCloudRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function payload<T>(
  raw: unknown,
  status: CloudPayloadStatus | undefined,
  read: (value: unknown) => T | null,
): CloudPayload<T> {
  if (status === 'missing' || status === 'unrecognized') return { status };
  if (raw == null) return { status: 'missing' };
  const value = read(raw);
  return value === null ? { status: 'unrecognized' } : { status: 'found', value };
}

function envelope(raw: unknown, format: string): Record<string, unknown> | null {
  return isCloudRecord(raw) && (raw.format === undefined || raw.format === format) ? raw : null;
}

/** Parse each kind once, keeping a recognized empty payload separate from absence. */
export function readCloudApplyPayloads(download: CloudApplyDownload) {
  const status = download.kindStatus;
  return {
    folders: payload(download.folders, status?.folders, (raw): FolderData | null => {
      const value = envelope(raw, 'gemini-voyager.folders.v1')?.data;
      // validateFolderData is the repository's legacy-compatible import boundary.
      return validateFolderData(value) ? (value as FolderData) : null;
    }),
    prompts: payload(download.prompts, status?.prompts, (raw): PromptItem[] | null => {
      const items = envelope(raw, 'gemini-voyager.prompts.v1')?.items;
      const op = parsePromptLibraryOp({ kind: 'restore', mode: 'overwrite', items });
      return op?.kind === 'restore' ? op.items : null;
    }),
    settings: payload(download.settings, status?.settings, (raw) => {
      const data = envelope(raw, 'gemini-voyager.settings.v1')?.data;
      return isCloudRecord(data) ? data : null;
    }),
    plugins: payload(download.plugins, status?.plugins, (raw) => {
      const data =
        isCloudRecord(raw) && raw.format === 'gemini-voyager.plugins.v1' ? raw.data : undefined;
      return isRestorablePluginState(data) ? data : null;
    }),
    timelineHierarchy: payload(
      download.timelineHierarchy,
      status?.timelineHierarchy,
      (raw): TimelineHierarchyData | null => {
        const data = envelope(raw, 'gemini-voyager.timeline-hierarchy.v1')?.data;
        return isTimelineHierarchyData(data) ? data : null;
      },
    ),
  };
}

type ApplyPayloads = ReturnType<typeof readCloudApplyPayloads>;

/** Pure overwrite policy. Merge callers retain their existing empty-source behavior. */
export function createCloudSyncApplyPlan(input: {
  mode: 'merge' | 'overwrite';
  payloads: ApplyPayloads;
  shared: boolean;
  conversationExtras: boolean;
}) {
  const skipped: CloudApplySkip[] = [];
  const select = <T>(kind: CloudApplyKind, value: CloudPayload<T>, included: boolean) => {
    if (!included) return undefined;
    if (value.status !== 'found') {
      if (input.mode === 'overwrite') skipped.push({ kind, reason: value.status });
      return undefined;
    }
    if (
      kind === 'plugins' &&
      input.mode === 'overwrite' &&
      isCloudRecord(value.value) &&
      Object.keys(value.value).length === 0
    ) {
      skipped.push({ kind, reason: 'empty-plugin-map' });
      return undefined;
    }
    return value.value;
  };
  return {
    folders: select('folders', input.payloads.folders, true),
    prompts: select('prompts', input.payloads.prompts, input.shared),
    settings: select('settings', input.payloads.settings, input.shared),
    plugins: select('plugins', input.payloads.plugins, input.shared),
    timelineHierarchy: select(
      'timelineHierarchy',
      input.payloads.timelineHierarchy,
      input.conversationExtras,
    ),
    skipped,
  };
}
