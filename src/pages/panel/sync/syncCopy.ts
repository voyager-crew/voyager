import {
  downloadFailureNotice,
  guardDetails,
  kindLabel,
  siteLabel,
  undoNotice,
  uploadFailureNotice,
} from '@/core/services/cloudSyncNotices';
import type { GuardedUploadKind, UploadGuardRefusedFile } from '@/core/types/syncUploadGuard';
import type { AppLanguage } from '@/utils/language';
import {
  type TranslationKey,
  formatRelativeTime,
  getLoadedTranslations,
  getPluralTranslation,
} from '@/utils/translations';

import { fillPlaceholders } from '../panelText';
import type { RunUndoResult } from './syncActions';
import type { RowStatus } from './syncProtocol';
import type { RunFailure } from './syncRunMachine';

type T = (key: TranslationKey) => string;

/** The sheet's own copy (spec #1077 copy table); every value goes in through `{name}`. */
export const STATUS_LABELS: Readonly<Partial<Record<RowStatus | 'running', TranslationKey>>> = {
  synced: 'panelSyncStatusSynced',
  newer_here: 'panelSyncStatusNewerHere',
  newer_in_cloud: 'panelSyncStatusNewerInCloud',
  not_uploaded: 'panelSyncStatusNotUploaded',
  to_merge: 'panelSyncStatusToMerge',
  running: 'panelSyncStatusSyncing',
  failed: 'panelSyncStatusFailed',
};

function plural(language: AppLanguage, key: string, count: number): string {
  return getPluralTranslation({
    language,
    key,
    count,
    translations: getLoadedTranslations(language) ?? getLoadedTranslations('en'),
  });
}

/** 同步 N 项 / 合并 N 项 on the primary button. */
export function primaryLabel(language: AppLanguage, count: number, merge: boolean): string {
  return plural(language, merge ? 'panelSyncMerge' : 'panelSyncRun', count);
}

/** 已同步 N 项, the toast after a run. */
export function syncedLabel(language: AppLanguage, count: number): string {
  return plural(language, 'panelSyncDone', count);
}

/** "Synced 12 min ago" in Voyager's language; "Not synced yet" before any baseline. */
export function lastSyncedLabel(
  t: T,
  language: AppLanguage,
  at: number | null,
  now: number = Date.now(),
): string {
  if (!at) return t('panelSyncNever');
  const minutes = Math.round((now - at) / 60_000);
  if (minutes < 1) return t('panelSyncJustNow');
  const [value, unit]: [number, Intl.RelativeTimeFormatUnit] =
    minutes < 60
      ? [minutes, 'minute']
      : minutes < 60 * 24
        ? [Math.round(minutes / 60), 'hour']
        : [Math.round(minutes / (60 * 24)), 'day'];
  const time = formatRelativeTime(language, -value, unit, { numeric: 'auto', style: 'short' });
  return fillPlaceholders(t('panelSyncAgo'), { time });
}

export function siteAddedLabel(t: T, site: string): string {
  return fillPlaceholders(t('panelSyncSiteAdded'), { site });
}

/** Can't confirm this account (a row whose account no page here names). */
export function unconfirmedLabel(t: T): string {
  return t('syncReasonAccountUnconfirmed');
}

/**
 * The toast line for a run that stopped: the reason a person can act on when
 * the shared notice has one, else its headline. Never a raw message or code.
 */
export function runFailureText(t: T, failure: RunFailure): string {
  const notice =
    failure.op === 'upload'
      ? uploadFailureNotice(t, failure.error, {
          excludedRows: failure.excludedRows,
          partial: failure.partial,
        })
      : downloadFailureNotice(t, failure.failure);
  const generic = [t('syncUploadFailed'), t('syncDownloadFailed')].includes(notice.headline);
  return generic && notice.lines.length ? notice.lines[0] : notice.headline;
}

/** Kinds kept per site, named beside their site, as `guardDetails` names them. */
const SITE_GUARD_KINDS: ReadonlySet<GuardedUploadKind> = new Set([
  'folders',
  'timelineHierarchy',
  'forks',
]);

/**
 * One refused file of the shrink guard, in the shared guard copy: its
 * `{cloud}`/`{local}` template with the kind filled in, so the sheet can set
 * the counts as nodes (a zero in red); an unreadable cloud copy has no counts.
 * The text equals `guardDetails` (src/core/services/cloudSyncNotices.ts).
 */
export function guardLine(
  t: T,
  platform: string,
  file: UploadGuardRefusedFile,
): { readonly template: string } | { readonly text: string } {
  if (file.cloudCount === null) return { text: guardDetails(t, platform, [file])[0] ?? '' };
  const kind = SITE_GUARD_KINDS.has(file.kind)
    ? fillPlaceholders(t('syncGuardSiteKind'), {
        kind: kindLabel(t, file.kind),
        site: siteLabel(platform),
      })
    : kindLabel(t, file.kind);
  // `{cloud}` and `{local}` stay for the sheet to fill with nodes.
  return { template: fillPlaceholders(t('syncGuardCount'), { kind }) };
}

/** What 撤销 on a run's toast did; `retry` keeps the Undo offered after a failure. */
export function runUndoText(
  t: T,
  result: RunUndoResult,
): { readonly message: string; readonly error: boolean; readonly retry: boolean } {
  if (result.kind === 'stopped') {
    const notice = undoNotice(t, result.snapshot);
    return { message: notice.headline, error: notice.tone === 'err', retry: notice.retry };
  }
  // Undo stays offered: it works again once Drive is back on the account the run wrote to.
  if (result.accountChanged)
    return { message: t('syncUndoAccountChanged'), error: true, retry: true };
  if (result.failedFiles) return { message: t('syncUndoFailed'), error: true, retry: true };
  const kept = result.snapshot ? undoNotice(t, result.snapshot).lines[0] : undefined;
  if (kept) return { message: kept, error: false, retry: false };
  if (result.keptFiles) return { message: t('panelSyncUndonePartial'), error: false, retry: false };
  return {
    message: t(result.anything ? 'panelSyncUndone' : 'syncUndoNothing'),
    error: false,
    retry: false,
  };
}

export function restoredLabel(t: T, restored: number, failed: number): string {
  if (!restored) return t(failed ? 'panelSyncRestoreFailed' : 'panelSyncRestoreNone');
  return t(failed ? 'panelSyncRestoredPartial' : 'panelSyncRestored');
}
