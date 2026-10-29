import { CloudRestoreError, type CloudRestorePart } from '@/core/services/CloudSyncApplyService';
import type { TranslationKey } from '@/utils/translations';

export {
  applyCloudRestore,
  CloudRestoreError,
  type CloudRestoreMode,
  type CloudRestorePart,
} from '@/core/services/CloudSyncApplyService';

const PART_LABELS: Readonly<Record<CloudRestorePart, TranslationKey>> = {
  highlights: 'storageQuotaHighlights',
  plugins: 'pluginsTitle',
  settings: 'storageQuotaSync',
  folders: 'folder_title',
  hierarchy: 'syncRestoreCatalogTimeline',
  prompts: 'promptDataMigration',
  starred: 'savedLibraryStars',
  forks: 'syncRestoreForks',
  outlines: 'syncRestoreCatalogTimeline',
};

/**
 * The status text for a failed restore: which parts landed and which did not
 * when anything was restored, else the plain sync error.
 */
export function cloudRestoreFailureText(
  t: (key: TranslationKey) => string,
  error: unknown,
): string {
  const reason = error instanceof CloudRestoreError ? error.reason : undefined;
  const message = reason ? t(reason) : error instanceof Error ? error.message : 'Download failed';
  if (!(error instanceof CloudRestoreError) || error.restored.length === 0) {
    return reason ? message : t('syncError').replace('{error}', message);
  }
  const list = (parts: readonly CloudRestorePart[]) =>
    parts.map((part) => t(PART_LABELS[part])).join(t('syncRestoreListSeparator'));
  return t('syncRestorePartial')
    .replace('{restored}', list(error.restored))
    .replace('{failed}', list(error.failed))
    .replace('{error}', message);
}
