/**
 * What a sync result says, shared by the popup, the Prompt Manager card and
 * the folder panel. It maps codes to reasons a person can act on and never
 * returns a raw message or code: unknown failures get the generic headline,
 * and their text goes to the log only.
 */
import { PLATFORM_LOGOS, type PlatformLogo } from '@/core/icons/platformLogos';
import type { CloudApplyKind, CloudApplySkip } from '@/core/services/CloudSyncApplyPlan';
import type { SyncScopeRow } from '@/core/services/CloudSyncScope';
import type { CloudSyncKind, CloudSyncUndoResult } from '@/core/services/cloudSyncSnapshotTypes';
import type { GuardedUploadKind, UploadGuardRefusedFile } from '@/core/types/syncUploadGuard';
import type { TranslationKey } from '@/utils/translations';

import { cloudSyncFailureCode } from './CloudSyncFailure';

export type Translate = (key: TranslationKey) => string;

export interface CloudSyncNotice {
  readonly tone: 'ok' | 'warn' | 'err';
  readonly headline: string;
  /** Reasons, skipped kinds and warnings, one short line each. */
  readonly lines: readonly string[];
}

export type CloudSyncNoticeKind = CloudSyncKind | CloudApplyKind | GuardedUploadKind;

const KIND_LABELS: Readonly<Record<CloudSyncNoticeKind, TranslationKey>> = {
  highlights: 'storageQuotaHighlights',
  plugins: 'pluginsTitle',
  settings: 'storageQuotaSync',
  folders: 'folder_title',
  hierarchy: 'syncKindTimelineLevels',
  timelineHierarchy: 'syncKindTimelineLevels',
  prompts: 'promptDataMigration',
  starred: 'savedLibraryStars',
  forks: 'syncRestoreForks',
  outlines: 'syncRestoreCatalogTimeline',
};

/** Kinds kept per site: the guard names the site beside them. */
const SITE_KINDS: ReadonlySet<CloudSyncNoticeKind> = new Set([
  'folders',
  'hierarchy',
  'timelineHierarchy',
  'forks',
]);

const REASONS: Readonly<Record<string, TranslationKey>> = {
  account_unconfirmed: 'syncReasonAccountUnconfirmed',
  account_changed: 'syncReasonAccountChanged',
  download_cancelled: 'syncReasonAccountChanged',
  local_read_failed: 'syncReasonLocalRead',
  cloud_read_failed: 'syncReasonCloudRead',
  metadata_read_failed: 'syncReasonCloudRead',
  invalid_drive_metadata: 'syncReasonCloudRead',
  invalid_sync_payload: 'syncReasonCloudRead',
  snapshot_failed: 'syncReasonSnapshot',
  snapshot_receipt_failed: 'syncReasonSnapshot',
  snapshot_superseded: 'syncReasonSuperseded',
  highlight_upload_failed: 'syncReasonHighlightsUpload',
  sync_metadata_unavailable: 'syncReasonStatusRecord',
  stale_download: 'syncReasonStatusRecord',
  sync_bookkeeping_failed: 'syncReasonStatusRecord',
  not_authenticated: 'syncReasonSignIn',
  google_drive_unavailable_on_device: 'syncGoogleDriveUnavailableAndroid',
};

/** Replaces each `{name}`; a replacer function keeps `$` in a value literal. */
function fill(text: string, values: Readonly<Record<string, string>>): string {
  return Object.entries(values).reduce(
    (result, [name, value]) => result.replaceAll(`{${name}}`, () => value),
    text,
  );
}

function joined(t: Translate, labels: readonly string[]): string {
  return [...new Set(labels)].join(t('syncRestoreListSeparator'));
}

export function kindLabel(t: Translate, kind: CloudSyncNoticeKind): string {
  return t(KIND_LABELS[kind]);
}

export function siteLabel(siteId: string): string {
  const logos: Readonly<Record<string, PlatformLogo>> = PLATFORM_LOGOS;
  return Object.hasOwn(logos, siteId) ? logos[siteId].label : siteId;
}

/**
 * The stable code behind an error or a response's error string, or `null` for
 * raw text. Codes without a reason here (a refused sender, a malformed request)
 * get the generic headline.
 */
export function cloudSyncNoticeCode(error: unknown): string | null {
  return cloudSyncFailureCode(error) ?? null;
}

function excludedRowsOf(error: unknown, rows?: readonly SyncScopeRow[]): readonly SyncScopeRow[] {
  if (rows?.length) return rows;
  const carried = (error as { rows?: unknown } | null)?.rows;
  return Array.isArray(carried) ? (carried as SyncScopeRow[]) : [];
}

/** The reason lines for a failure; empty when the cause is not one a person can act on. */
export function reasonLines(
  t: Translate,
  error: unknown,
  excludedRows?: readonly SyncScopeRow[],
): string[] {
  const code = cloudSyncNoticeCode(error);
  if (code === 'sync_scope_excluded') {
    return excludedRowsOf(error, excludedRows).map((row) =>
      row.kind === 'shared'
        ? t('syncReasonSharedExcluded')
        : fill(t('syncReasonSiteExcluded'), { site: siteLabel(row.siteId) }),
    );
  }
  return code && Object.hasOwn(REASONS, code) ? [t(REASONS[code])] : [];
}

/** One line per refused file: its count drop, or that the cloud copy is unreadable. */
export function guardDetails(
  t: Translate,
  platform: string,
  refusedFiles: readonly UploadGuardRefusedFile[],
): string[] {
  return refusedFiles.map((file) => {
    const kind = SITE_KINDS.has(file.kind)
      ? fill(t('syncGuardSiteKind'), { kind: kindLabel(t, file.kind), site: siteLabel(platform) })
      : kindLabel(t, file.kind);
    return file.cloudCount === null
      ? fill(t('syncGuardUnrecognized'), { kind })
      : fill(t('syncGuardCount'), {
          kind,
          cloud: String(file.cloudCount),
          local: String(file.localCount),
        });
  });
}

/** Merging needs a cloud copy this build can read, so an unreadable one offers no merge. */
export function guardCanMerge(refusedFiles: readonly UploadGuardRefusedFile[]): boolean {
  return refusedFiles.some((file) => file.reason !== 'unrecognized');
}

/** What an overwrite or a partial restore kept on this device, and why. */
export function skippedLines(t: Translate, skipped: readonly CloudApplySkip[]): string[] {
  const kinds = (reason: CloudApplySkip['reason']) =>
    skipped.filter((skip) => skip.reason === reason).map((skip) => kindLabel(t, skip.kind));
  const missing = kinds('missing');
  const unrecognized = kinds('unrecognized');
  return [
    ...(missing.length ? [fill(t('syncSkippedMissing'), { kinds: joined(t, missing) })] : []),
    ...(unrecognized.length
      ? [fill(t('syncSkippedUnrecognized'), { kinds: joined(t, unrecognized) })]
      : []),
    ...(skipped.some((skip) => skip.reason === 'empty-plugin-map')
      ? [t('syncSkippedEmptyPlugins')]
      : []),
  ];
}

export function uploadNotice(t: Translate, highlightsSkipped: boolean): CloudSyncNotice {
  return highlightsSkipped
    ? { tone: 'warn', headline: t('syncSuccessHighlightsSkipped'), lines: [] }
    : { tone: 'ok', headline: t('syncSuccess'), lines: [] };
}

/** A refused or failed upload; `error` is a response's code or a thrown error. */
export function uploadFailureNotice(
  t: Translate,
  error: unknown,
  options: { excludedRows?: readonly SyncScopeRow[]; partial?: boolean } = {},
): CloudSyncNotice {
  const code = cloudSyncNoticeCode(error);
  // The files landed; only the bookkeeping that records it did not.
  if (code === 'sync_metadata_unavailable')
    return { tone: 'warn', headline: t('uploadSuccess'), lines: [t('syncReasonStatusRecord')] };
  return {
    tone: 'err',
    headline: t(
      code === 'highlight_upload_failed' && options.partial
        ? 'syncUploadIncomplete'
        : 'syncUploadFailed',
    ),
    lines: reasonLines(t, error, options.excludedRows),
  };
}

export interface DownloadOutcome {
  readonly mode: 'merge' | 'overwrite';
  readonly foldersMissing?: boolean;
  readonly highlightsSkipped?: boolean;
  readonly nameConflicts?: number;
  readonly skipped?: readonly CloudApplySkip[];
  /** True when the download changed nothing on this device. */
  readonly nothingRestored?: boolean;
}

export function downloadNotice(t: Translate, outcome: DownloadOutcome): CloudSyncNotice {
  const foldersMissing = outcome.mode === 'merge' && outcome.foldersMissing === true;
  const lines = [
    ...(outcome.mode === 'overwrite' ? skippedLines(t, outcome.skipped ?? []) : []),
    ...((outcome.nameConflicts ?? 0) > 0
      ? [fill(t('promptNameConflictsDetected'), { count: String(outcome.nameConflicts) })]
      : []),
  ];
  // An overwrite that replaced nothing is not a success: what it kept is the result.
  if (outcome.mode === 'overwrite' && outcome.nothingRestored && lines.length > 0)
    return { tone: 'warn', headline: lines[0], lines: lines.slice(1) };
  return {
    tone: lines.length > 0 || foldersMissing || outcome.highlightsSkipped ? 'warn' : 'ok',
    headline: t(
      foldersMissing
        ? 'syncSuccessFoldersMissing'
        : outcome.highlightsSkipped
          ? 'syncSuccessHighlightsSkipped'
          : 'syncSuccess',
    ),
    lines,
  };
}

/** A failed download; with `restored`, a partial one that names what landed. */
export interface DownloadFailure {
  readonly cause: unknown;
  readonly restored?: readonly CloudSyncNoticeKind[];
  readonly failed?: readonly CloudSyncNoticeKind[];
  readonly skipped?: readonly CloudApplySkip[];
  /** A message key the failure already names, such as `folder_import_wrong_site`. */
  readonly reason?: TranslationKey;
  readonly excludedRows?: readonly SyncScopeRow[];
}

export function downloadFailureNotice(t: Translate, failure: DownloadFailure): CloudSyncNotice {
  const reasons = failure.reason
    ? [t(failure.reason)]
    : reasonLines(t, failure.cause, failure.excludedRows);
  const restored = (failure.restored ?? []).map((kind) => kindLabel(t, kind));
  const failed = (failure.failed ?? []).map((kind) => kindLabel(t, kind));
  if (restored.length > 0 && failed.length > 0) {
    return {
      tone: 'err',
      headline: fill(t('syncRestorePartial'), {
        restored: joined(t, restored),
        failed: joined(t, failed),
      }),
      lines: [...reasons, ...skippedLines(t, failure.skipped ?? [])],
    };
  }
  if (failure.reason && restored.length === 0)
    return { tone: 'err', headline: t(failure.reason), lines: [] };
  return { tone: 'err', headline: t('syncDownloadFailed'), lines: reasons };
}

/** A completion handshake that failed after the data landed: the result stays, with a warning. */
export function withStatusRecordWarning(t: Translate, notice: CloudSyncNotice): CloudSyncNotice {
  const line = t('syncReasonStatusRecord');
  return {
    tone: notice.tone === 'err' ? 'err' : 'warn',
    headline: notice.headline,
    lines: notice.lines.includes(line) ? notice.lines : [...notice.lines, line],
  };
}

/** What an Undo did; `retry` keeps the Undo offered after a failure. */
export function undoNotice(
  t: Translate,
  result: CloudSyncUndoResult,
): CloudSyncNotice & { readonly retry: boolean } {
  switch (result.status) {
    case 'restored': {
      const kept = result.kept.map((entry) => kindLabel(t, entry.kind));
      return {
        tone: kept.length > 0 ? 'warn' : 'ok',
        headline: t(result.restoredKeys > 0 ? 'syncUndoDone' : 'syncUndoNothing'),
        lines: kept.length > 0 ? [fill(t('syncUndoKept'), { kinds: joined(t, kept) })] : [],
        retry: false,
      };
    }
    case 'absent':
      return { tone: 'ok', headline: t('syncUndoNothing'), lines: [], retry: false };
    case 'superseded':
      return { tone: 'warn', headline: t('syncUndoReplaced'), lines: [], retry: false };
    case 'failed':
      return { tone: 'err', headline: t('syncUndoFailed'), lines: [], retry: true };
    default: {
      const exhaustive: never = result;
      return exhaustive;
    }
  }
}

/** The popup's line for the error a previous sync left in its state. */
export function persistedErrorText(t: Translate, error: string): string {
  const [reason] = reasonLines(t, error);
  return reason ? fill(t('syncError'), { error: reason }) : t('syncLastFailed');
}
