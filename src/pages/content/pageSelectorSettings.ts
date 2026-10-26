import { StorageKeys } from '@/core/types/common';
import type { LegacySettingsSource } from '@/features/plugins/runtime/legacySnapshotFeed';
import { packagedSiteForUrl } from '@/features/plugins/sites/hostPolicy';
import {
  type LegacySettingSnapshot,
  legacyBindingKeys,
  loadLegacySettingSnapshot,
  subscribeLegacySettings,
} from '@/features/plugins/storage/legacySettingBindings';

interface PageSelectorSettingsSource extends LegacySettingsSource {
  /** Only a completed read is available; an unresolved switch is never guessed ON. */
  current(): LegacySettingSnapshot | undefined;
}

/** The host and locator hydration share the host's existing settings read. */
export function pageSelectorSettings(url: string): PageSelectorSettingsSource {
  const keys = packagedSiteForUrl(url)
    ? legacyBindingKeys()
    : [StorageKeys.GV_VISUAL_EFFECT, StorageKeys.GV_SNOW_EFFECT];
  let initial: ReturnType<typeof loadLegacySettingSnapshot> | undefined;
  let current: LegacySettingSnapshot | undefined;
  return {
    current: () => current,
    load: () =>
      (initial ??= loadLegacySettingSnapshot([
        ...keys,
        StorageKeys.PLUGIN_ONLINE_UPDATES_ENABLED,
      ]).then((settings) => {
        current = settings;
        return settings;
      })),
    // Only locator hydration observes Online updates; plugin settings never depend on it.
    subscribe: (callback) => subscribeLegacySettings(callback, keys),
  };
}
