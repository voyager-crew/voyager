/** Keep coverage authoritative even when page-locator startup supplies a narrower feed. */
import { StorageKeys } from '@/core/types/common';

import { packagedSiteForUrl } from '../sites/hostPolicy';
import {
  loadLegacySettingSnapshot,
  subscribeLegacySettings,
} from '../storage/legacySettingBindings';
import { promptCoverageBindingForUrl } from '../storage/promptCoverageBinding';
import {
  DEFAULT_LEGACY_SETTINGS,
  DEFAULT_VISUAL_EFFECT_SETTINGS,
  type LegacySettingsSource,
} from './legacySnapshotFeed';

const KEYS = [StorageKeys.PROMPT_CUSTOM_WEBSITES];

export function legacySettingsForPage(
  url: string,
  source?: LegacySettingsSource,
): LegacySettingsSource {
  const base =
    source ?? (packagedSiteForUrl(url) ? DEFAULT_LEGACY_SETTINGS : DEFAULT_VISUAL_EFFECT_SETTINGS);
  if (!promptCoverageBindingForUrl(url)) return base;
  return {
    async load() {
      const [settings, coverage] = await Promise.all([
        base.load(),
        loadLegacySettingSnapshot(KEYS),
      ]);
      return { ...settings, ...coverage };
    },
    subscribe(callback) {
      const stopSettings = base.subscribe(callback);
      const stopCoverage = subscribeLegacySettings(callback, KEYS);
      return () => {
        stopSettings();
        stopCoverage();
      };
    },
  };
}
