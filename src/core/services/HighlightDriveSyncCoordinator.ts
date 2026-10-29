import {
  type HighlightAccountSnapshot,
  type HighlightImportMergeOptions,
  highlightAnnotationService,
} from '@/core/services/HighlightAnnotationService';
import {
  type HighlightScope,
  compareHighlightRecords,
} from '@/core/services/highlightAnnotationData';
import type {
  HighlightExportPayloadV1,
  HighlightImportStats,
  HighlightRecordV1,
} from '@/core/types/highlight';
import { HIGHLIGHT_EXPORT_FORMAT } from '@/core/types/highlight';
import type { SyncAccountScope } from '@/core/types/sync';
import { EXTENSION_VERSION } from '@/core/utils/version';

export interface HighlightDrivePort {
  readonly kind: 'sync-turn';
  downloadHighlightsOnly(
    accountScope: SyncAccountScope,
    interactive?: boolean,
    purpose?: 'download' | 'upload',
  ): Promise<HighlightExportPayloadV1 | null>;
  uploadHighlightsOnly(
    payload: HighlightExportPayloadV1,
    accountScope: SyncAccountScope,
    interactive?: boolean,
  ): Promise<boolean>;
  getState(): Promise<{ error: string | null }>;
}

export interface HighlightLocalPort {
  getAccountSnapshot(scope: HighlightScope): Promise<HighlightAccountSnapshot>;
  importMerge(
    scope: HighlightScope,
    records: readonly HighlightRecordV1[],
    options?: HighlightImportMergeOptions,
  ): Promise<HighlightImportStats>;
}

export type HighlightPushPlan =
  | { ok: true; commit(): Promise<HighlightDriveSyncResult> }
  | { ok: false; result: HighlightDriveSyncResult };

export interface HighlightDriveSyncResult {
  ok: boolean;
  empty?: boolean;
  count: number;
  stats?: HighlightImportStats;
  error?: string;
}

function toHighlightScope(scope: SyncAccountScope): HighlightScope {
  return { ...scope, platform: 'gemini' };
}

function payloadFromSnapshot(snapshot: HighlightAccountSnapshot): HighlightExportPayloadV1 {
  return {
    format: HIGHLIGHT_EXPORT_FORMAT,
    exportedAt: new Date().toISOString(),
    version: EXTENSION_VERSION,
    accountScope: snapshot.accountScope,
    ...(snapshot.clearMarker ? { clearMarker: snapshot.clearMarker } : {}),
    items: snapshot.records,
  };
}

function clearMarkerCovers(
  actual: HighlightExportPayloadV1['clearMarker'],
  expected: HighlightExportPayloadV1['clearMarker'],
): boolean {
  if (!expected) return true;
  if (!actual) return false;
  if (actual.revision.counter !== expected.revision.counter) {
    return actual.revision.counter > expected.revision.counter;
  }
  if (actual.clearedAt !== expected.clearedAt) return actual.clearedAt > expected.clearedAt;
  return actual.revision.deviceId >= expected.revision.deviceId;
}

function payloadCovers(
  actual: HighlightExportPayloadV1,
  expected: HighlightExportPayloadV1,
): boolean {
  if (!clearMarkerCovers(actual.clearMarker, expected.clearMarker)) return false;
  const actualById = new Map(actual.items.map((record) => [record.id, record]));
  return expected.items.every((record) => {
    const actualRecord = actualById.get(record.id);
    return actualRecord !== undefined && compareHighlightRecords(actualRecord, record) >= 0;
  });
}

/**
 * Coordinates the required download -> merge -> upload sequence around the
 * Drive service's intentionally small last-write-wins primitives.
 */
export class HighlightDriveSyncCoordinator {
  constructor(
    private readonly drive: HighlightDrivePort,
    private readonly local: HighlightLocalPort = highlightAnnotationService,
  ) {}

  async pull(
    accountScope: SyncAccountScope,
    interactive: boolean = true,
  ): Promise<HighlightDriveSyncResult> {
    const remote = await this.drive.downloadHighlightsOnly(accountScope, interactive);
    if (!remote) {
      const state = await this.drive.getState();
      return state.error
        ? { ok: false, count: 0, error: state.error }
        : { ok: true, empty: true, count: 0 };
    }

    try {
      const stats = await this.local.importMerge(toHighlightScope(accountScope), remote.items, {
        clearMarker: remote.clearMarker,
      });
      return { ok: true, count: stats.total, stats };
    } catch (error) {
      return {
        ok: false,
        count: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /** Called with an unqueued port so a larger upload can prepare every kind first. */
  async preparePush(
    accountScope: SyncAccountScope,
    interactive: boolean = true,
  ): Promise<HighlightPushPlan> {
    try {
      const remote = await this.drive.downloadHighlightsOnly(accountScope, interactive, 'upload');
      const remoteState = await this.drive.getState();
      if (!remote && remoteState.error) {
        return { ok: false, result: { ok: false, count: 0, error: remoteState.error } };
      }
      // Planning must not apply cloud records or a clear marker before the main upload succeeds.
      const initial = payloadFromSnapshot(
        await this.local.getAccountSnapshot(toHighlightScope(accountScope)),
      );
      JSON.stringify(initial);
      return { ok: true, commit: () => this.commitPush(accountScope, interactive, remote) };
    } catch (error) {
      return {
        ok: false,
        result: {
          ok: false,
          count: 0,
          error: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }

  private async commitPush(
    accountScope: SyncAccountScope,
    interactive: boolean,
    remote: HighlightExportPayloadV1 | null,
  ): Promise<HighlightDriveSyncResult> {
    const highlightScope = toHighlightScope(accountScope);
    try {
      let stats: HighlightImportStats | undefined;
      if (remote) {
        stats = await this.local.importMerge(highlightScope, remote.items, {
          clearMarker: remote.clearMarker,
        });
      }
      const maximumAttempts = 3;
      for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
        // Include edits made while the main upload was transferring its other files.
        const payload = payloadFromSnapshot(await this.local.getAccountSnapshot(highlightScope));
        const uploaded = await this.drive.uploadHighlightsOnly(payload, accountScope, interactive);
        if (!uploaded) {
          const state = await this.drive.getState();
          return { ok: false, count: 0, error: state.error ?? 'Highlight upload failed' };
        }

        const verified = await this.drive.downloadHighlightsOnly(accountScope, interactive);
        if (verified) {
          stats = await this.local.importMerge(highlightScope, verified.items, {
            clearMarker: verified.clearMarker,
          });
          if (payloadCovers(verified, payload)) {
            return {
              ok: true,
              count: verified.items.filter((item) => !item.deletedAt).length,
              stats,
            };
          }
        } else {
          const state = await this.drive.getState();
          if (state.error) return { ok: false, count: 0, error: state.error };
        }
      }
      return {
        ok: false,
        count: 0,
        error: 'Highlight upload could not be verified after 3 merge attempts',
      };
    } catch (error) {
      return { ok: false, count: 0, error: error instanceof Error ? error.message : String(error) };
    }
  }
}
