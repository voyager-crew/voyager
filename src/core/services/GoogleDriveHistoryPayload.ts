import { parseDriveJson } from '@/core/utils/driveReadResult';
import { FOLDER_PLATFORMS, FOLDER_PLATFORM_IDS } from '@/features/folder/platforms';
import { isCatalogSiteId } from '@/features/timeline/catalogHierarchySync';

import {
  type SharedHistoryKind,
  hasFiniteHistoryNumbers,
  isLosslessCatalogHierarchyHistory,
  isLosslessFolderHistory,
  isLosslessHighlightHistory,
  isLosslessSharedHistory,
  isLosslessStarsHistory,
} from './GoogleDriveHistoryValidation';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function baseName(name: string): string {
  return name.replace(/\.acct-[a-z0-9]+(?=\.json$)/, '');
}

const sharedKinds = {
  'gemini-voyager-prompts.json': 'prompts',
  'gemini-voyager-plugins.json': 'plugins',
  'gemini-voyager-forks.json': 'forks',
  'gemini-voyager-timeline-hierarchy.json': 'timelineHierarchy',
  'gemini-voyager-settings.json': 'settings',
  'gemini-voyager-starred.json': 'starred',
} as const satisfies Record<string, SharedHistoryKind>;

/** Only exact sync names are restore targets; a history name can never become one. */
export function isDriveSyncFileName(name: string): boolean {
  const base = baseName(name);
  return (
    FOLDER_PLATFORM_IDS.some(
      (platform) => FOLDER_PLATFORMS[platform].driveFoldersFileName === base,
    ) ||
    Object.prototype.hasOwnProperty.call(sharedKinds, base) ||
    ['gemini-voyager-stars.json', 'gemini-voyager-highlights.json'].includes(base) ||
    /^gemini-voyager-(?:timeline-hierarchy|stars)\.site-[a-z0-9][a-z0-9-]{0,63}\.json$/.test(base)
  );
}

/** Validate the original payload without reserializing or normalizing the restored bytes. */
export function isRecognizedHistoryContent(name: string, text: string): boolean {
  try {
    const raw = parseDriveJson(text.replace(/^\uFEFF/, ''));
    if (!isRecord(raw) || !hasFiniteHistoryNumbers(raw)) return false;
    const base = baseName(name);
    const platform = FOLDER_PLATFORM_IDS.find(
      (candidate) => FOLDER_PLATFORMS[candidate].driveFoldersFileName === base,
    );
    // History retention must never count a partial recovery that silently drops user content.
    if (platform) return isLosslessFolderHistory(raw, platform);
    if (Object.prototype.hasOwnProperty.call(sharedKinds, base)) {
      for (const [fileName, kind] of Object.entries(sharedKinds)) {
        if (fileName === base) return isLosslessSharedHistory(kind, raw);
      }
    }
    const accountHash = /\.acct-([a-z0-9]+)\.json$/.exec(name)?.[1];
    if (base === 'gemini-voyager-highlights.json') {
      return isLosslessHighlightHistory(raw, accountHash);
    }
    const catalogStars = /^gemini-voyager-stars\.site-([a-z0-9-]+)\.json$/.exec(base);
    if (base === 'gemini-voyager-stars.json' || catalogStars) {
      if (
        accountHash
          ? !isRecord(raw.accountScope) || raw.accountScope.accountHash !== accountHash
          : raw.accountScope !== undefined
      ) {
        return false;
      }
      return isLosslessStarsHistory(raw);
    }
    const catalog = /^gemini-voyager-timeline-hierarchy\.site-([a-z0-9-]+)\.json$/.exec(base);
    if (catalog && isCatalogSiteId(catalog[1])) {
      return isLosslessCatalogHierarchyHistory(raw, catalog[1]);
    }
    return false;
  } catch {
    return false;
  }
}
