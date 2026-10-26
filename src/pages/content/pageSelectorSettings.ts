import { StorageKeys } from '@/core/types/common';
import type { LegacySettingsSource } from '@/features/plugins/runtime/legacySnapshotFeed';
import { packagedSiteForUrl } from '@/features/plugins/sites/hostPolicy';
import {
  legacyBindingKeys,
  loadLegacySettingSnapshot,
  subscribeLegacySettings,
} from '@/features/plugins/storage/legacySettingBindings';

/** The host and locator hydration share the host's existing settings read. */
export function pageSelectorSettings(url: string): LegacySettingsSource {
  const keys = [
    ...(packagedSiteForUrl(url)
      ? legacyBindingKeys()
      : [StorageKeys.GV_VISUAL_EFFECT, StorageKeys.GV_SNOW_EFFECT]),
    StorageKeys.PLUGIN_ONLINE_UPDATES_ENABLED,
  ];
  let initial: ReturnType<typeof loadLegacySettingSnapshot> | undefined;
  return {
    load: () => (initial ??= loadLegacySettingSnapshot(keys)),
    subscribe: (callback) => subscribeLegacySettings(callback, keys),
  };
}
