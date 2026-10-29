/**
 * The background's replies to a cloud sync upload or download, parsed from
 * `unknown` where they arrive. A reply's raw message never becomes copy: only
 * its stable error code travels on, for the notices to name.
 */
import type { CloudApplyKind, CloudPayloadStatus } from '@/core/services/CloudSyncApplyPlan';
import type { CloudDownloadData } from '@/core/services/CloudSyncDownloadService';
import type { SyncScopeRow } from '@/core/services/CloudSyncScope';
import type { SyncState } from '@/core/types/sync';
import type { GuardedUploadKind, UploadGuardRefusedFile } from '@/core/types/syncUploadGuard';
import { type CloudUploadReceipt, parseCloudUploadReceipt } from '@/core/types/syncUploadReceipt';
import { readCatalogBucket } from '@/features/timeline/catalogHierarchySync';
import type { PulledCatalogTimeline } from '@/features/timeline/catalogTimelineCloud';

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}

/** The sync state a reply carries, for the surface's status line; the background owns its shape. */
function parseState(value: unknown): SyncState | undefined {
  return isSyncState(value) ? value : undefined;
}

function isSyncState(value: unknown): value is SyncState {
  return record(value) !== null;
}

function parseScopeRow(value: unknown): SyncScopeRow | null {
  const row = record(value);
  if (row?.kind === 'shared') return { kind: 'shared' };
  return row?.kind === 'site' && typeof row.siteId === 'string'
    ? { kind: 'site', siteId: row.siteId }
    : null;
}

function parseExcludedRows(value: unknown): SyncScopeRow[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map(parseScopeRow).filter((row): row is SyncScopeRow => row !== null);
}

const GUARDED_KINDS: readonly GuardedUploadKind[] = [
  'folders',
  'prompts',
  'timelineHierarchy',
  'forks',
  'plugins',
];

function parseRefusedFiles(value: unknown): UploadGuardRefusedFile[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((raw: unknown): UploadGuardRefusedFile[] => {
    const file = record(raw);
    const kind = GUARDED_KINDS.find((candidate) => candidate === file?.kind);
    if (!file || !kind || typeof file.localCount !== 'number') return [];
    const { localCount } = file;
    if (typeof file.cloudCount !== 'number')
      return [{ kind, localCount, cloudCount: null, reason: 'unrecognized' }];
    const reason = file.reason === 'empty_local' ? 'empty_local' : 'large_drop';
    return [{ kind, localCount, cloudCount: file.cloudCount, reason }];
  });
}

export type CloudUploadReply =
  | {
      readonly kind: 'uploaded';
      readonly state?: SyncState;
      readonly highlightsSkipped: boolean;
      readonly uploadReceipt: CloudUploadReceipt | null;
    }
  | {
      readonly kind: 'refused';
      readonly state?: SyncState;
      readonly refusedFiles: readonly UploadGuardRefusedFile[];
      /** Binds a forced retry to the refusal it answers. */
      readonly guardToken?: string;
    }
  | {
      readonly kind: 'failed';
      readonly state?: SyncState;
      readonly error: string | null;
      readonly excludedRows?: readonly SyncScopeRow[];
      /** The main files landed before a later part failed. */
      readonly partial?: boolean;
      readonly uploadReceipt: CloudUploadReceipt | null;
    };

export function parseUploadReply(value: unknown): CloudUploadReply {
  const reply = record(value);
  const state = parseState(reply?.state);
  if (reply?.ok === true)
    return {
      kind: 'uploaded',
      state,
      highlightsSkipped: record(reply.highlights)?.skipped === true,
      uploadReceipt: parseCloudUploadReceipt(reply.uploadReceipt),
    };
  const refusedFiles = parseRefusedFiles(reply?.refusedFiles);
  if (reply?.error === 'upload_guard_refused' && refusedFiles.length) {
    const token = reply.guardToken;
    return {
      kind: 'refused',
      state,
      refusedFiles,
      ...(typeof token === 'string' && token ? { guardToken: token } : {}),
    };
  }
  const excludedRows = parseExcludedRows(reply?.excludedRows);
  return {
    kind: 'failed',
    state,
    error: typeof reply?.error === 'string' ? reply.error : null,
    uploadReceipt: parseCloudUploadReceipt(reply?.uploadReceipt),
    ...(excludedRows ? { excludedRows } : {}),
    ...(reply?.partial === true ? { partial: true } : {}),
  };
}

const APPLY_KINDS: readonly CloudApplyKind[] = [
  'folders',
  'prompts',
  'settings',
  'plugins',
  'timelineHierarchy',
];
const PAYLOAD_STATUSES: readonly CloudPayloadStatus[] = [
  'found',
  'missing',
  'unrecognized',
  'failed',
];

function parseKindStatus(value: unknown): Partial<Record<CloudApplyKind, CloudPayloadStatus>> {
  const raw = record(value) ?? {};
  const kinds: Partial<Record<CloudApplyKind, CloudPayloadStatus>> = {};
  for (const kind of APPLY_KINDS) {
    const kindStatus = PAYLOAD_STATUSES.find((candidate) => candidate === raw[kind]);
    if (kindStatus) kinds[kind] = kindStatus;
  }
  return kinds;
}

/** Absent: an older background, so the apply pulls it; null or unreadable: no catalog files. */
function parseCatalog(value: unknown): PulledCatalogTimeline | null | undefined {
  if (value === undefined) return undefined;
  const catalog = record(value);
  const outlines = record(catalog?.outlines);
  const stars = record(catalog?.stars);
  return outlines && stars
    ? {
        outlines: Object.fromEntries(
          Object.entries(outlines).map(([key, bucket]) => [key, readCatalogBucket(bucket)]),
        ),
        stars,
      }
    : null;
}

export interface CloudDownloadReply {
  readonly ok: boolean;
  readonly error: string | null;
  readonly state?: SyncState;
  readonly excludedRows?: readonly SyncScopeRow[];
  /** The payload stays in its transport format; the apply plan validates each kind. */
  readonly data: CloudDownloadData | null;
  readonly snapshotId?: string;
  readonly operationId?: string;
  readonly catalog: PulledCatalogTimeline | null | undefined;
  readonly highlights: { readonly synced: boolean; readonly skipped: boolean };
}

export function parseDownloadReply(value: unknown): CloudDownloadReply {
  const reply = record(value);
  const data = record(reply?.data);
  const selection = record(reply?.selection);
  const highlights = record(reply?.highlights);
  const excludedRows = parseExcludedRows(reply?.excludedRows);
  return {
    ok: reply?.ok === true,
    error: typeof reply?.error === 'string' ? reply.error : null,
    state: parseState(reply?.state),
    ...(excludedRows ? { excludedRows } : {}),
    data: data
      ? {
          ...data,
          ...(selection
            ? {
                selection: {
                  site: selection.site === true,
                  shared: selection.shared === true,
                  conversationExtras: selection.conversationExtras === true,
                  timelineHierarchy: selection.timelineHierarchy === true,
                },
              }
            : {}),
          ...(record(reply?.kindStatus) ? { kindStatus: parseKindStatus(reply?.kindStatus) } : {}),
        }
      : null,
    snapshotId: typeof reply?.snapshotId === 'string' ? reply.snapshotId : undefined,
    operationId: typeof reply?.operationId === 'string' ? reply.operationId : undefined,
    catalog: parseCatalog(reply?.catalog),
    highlights: { synced: highlights?.synced === true, skipped: highlights?.skipped === true },
  };
}
