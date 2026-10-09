/**
 * The popup's writes for a Drive restore, in order: plugin state, synced
 * settings, folders (plus the timeline hierarchy on Gemini), then the
 * background-owned prompt, star and fork merges, then catalog-site outlines
 * and stars. There is no transaction across them, and the background has
 * already restored highlights by the time they run, so a failure partway
 * reports which parts were restored and which were not instead of a bare
 * "sync failed".
 */
import { restoreBackupableSyncSettings } from '@/core/services/SettingsBackupService';
import {
  isRestorablePluginState,
  restorePluginState,
} from '@/features/plugins/storage/pluginState';
import type { TranslationKey } from '@/utils/translations';

export type CloudRestorePart =
  | 'highlights'
  | 'plugins'
  | 'settings'
  | 'folders'
  | 'prompts'
  | 'starred'
  | 'forks'
  | 'outlines';
export type CloudRestoreMode = 'merge' | 'overwrite';

const PART_LABELS: Readonly<Record<CloudRestorePart, TranslationKey>> = {
  highlights: 'storageQuotaHighlights',
  plugins: 'pluginsTitle',
  settings: 'storageQuotaSync',
  folders: 'folder_title',
  prompts: 'promptDataMigration',
  starred: 'savedLibraryStars',
  forks: 'syncRestoreForks',
  outlines: 'syncRestoreCatalogTimeline',
};

/**
 * A restore that stopped partway: `restored` landed, `failed` did not.
 * `reason` names a refusal the popup explains in the user's language.
 */
export class CloudRestoreError extends Error {
  constructor(
    readonly restored: readonly CloudRestorePart[],
    readonly failed: readonly CloudRestorePart[],
    cause: unknown,
    readonly reason?: TranslationKey,
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'CloudRestoreError';
  }
}

export interface CloudRestoreInput {
  readonly mode: CloudRestoreMode;
  /** The background pulled highlights before the popup's writes. */
  readonly highlightsRestored: boolean;
  /** The Drive plugin-state payload, or undefined when absent or another format. */
  readonly plugins: unknown;
  readonly settings: unknown;
  /** Folders, plus Gemini's hierarchy: one storage write. */
  readonly storageUpdate: Record<string, unknown>;
  /** Restores the shared prompts through their owner; absent where a site has none. */
  readonly restorePrompts?: () => Promise<boolean>;
  /** Resolves true when a present cloud star payload merged successfully. */
  readonly mergeStarred?: () => Promise<boolean>;
  /** Resolves true when a present cloud fork payload merged successfully. */
  readonly mergeForks?: () => Promise<boolean>;
  /** Merges pulled catalog-site outlines and stars; absent when the cloud has none. */
  readonly restoreOutlines?: () => Promise<boolean>;
  /** The backup has no folder data; an overwrite then writes nothing. */
  readonly foldersMissing: boolean;
}

interface RestoreStep {
  readonly parts: readonly CloudRestorePart[];
  /** Resolves true when it wrote something. */
  readonly run: () => Promise<boolean>;
}

/**
 * Run the restore writes in order, counting a part as restored only when its
 * step wrote something. On a failure, or an overwrite refused for missing
 * folder data, throw `CloudRestoreError` naming what landed and what did not.
 */
export async function applyCloudRestore(input: CloudRestoreInput): Promise<void> {
  const steps: RestoreStep[] = [];
  if (isRestorablePluginState(input.plugins)) {
    const plugins = input.plugins;
    steps.push({
      parts: ['plugins'],
      run: async () => {
        await restorePluginState(plugins, input.mode);
        return true;
      },
    });
  }
  steps.push({
    parts: ['settings'],
    run: async () =>
      Object.keys(await restoreBackupableSyncSettings(input.settings, undefined, input.mode))
        .length > 0,
  });
  steps.push({
    parts: ['folders'],
    run: async () => {
      await chrome.storage.local.set(input.storageUpdate);
      return true;
    },
  });
  if (input.restorePrompts) {
    steps.push({ parts: ['prompts'], run: input.restorePrompts });
  }
  if (input.mergeStarred) {
    steps.push({ parts: ['starred'], run: input.mergeStarred });
  }
  if (input.mergeForks) {
    steps.push({ parts: ['forks'], run: input.mergeForks });
  }
  if (input.restoreOutlines) {
    steps.push({ parts: ['outlines'], run: input.restoreOutlines });
  }

  const restored: CloudRestorePart[] = input.highlightsRestored ? ['highlights'] : [];
  if (input.mode === 'overwrite' && input.foldersMissing) {
    const failed = steps.flatMap((step) => step.parts);
    const reason = 'syncOverwriteMissingFolders';
    throw new CloudRestoreError(restored, failed, new Error('No folder data to overwrite'), reason);
  }
  for (const [index, step] of steps.entries()) {
    let wrote: boolean;
    try {
      wrote = await step.run();
    } catch (error) {
      const failed = steps.slice(index).flatMap((pending) => pending.parts);
      throw new CloudRestoreError(restored, failed, error);
    }
    if (wrote) restored.push(...step.parts);
  }
}

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
