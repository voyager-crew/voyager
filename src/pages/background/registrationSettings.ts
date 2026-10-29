import { StorageKeys } from '@/core/types/common';
import { WATERMARK_STORAGE_KEYS } from '@/core/utils/watermarkSettings';

import { disableRetiredTabTitleUpdateSetting } from './backgroundSettings';
import type { createMainWorldRegistration } from './mainWorldRegistration';
import type { createSiteAccessRegistration } from './siteAccessRegistration';

const CUSTOM_WEBSITE_KEY = 'gvPromptCustomWebsites';

// Called synchronously at startup, after the initial registration work has been queued.
export function registerBackgroundSettingListeners(owners: {
  siteAccess: ReturnType<typeof createSiteAccessRegistration>;
  mainWorld: ReturnType<typeof createMainWorldRegistration>;
}): void {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync') return;

    if (
      Object.prototype.hasOwnProperty.call(changes, StorageKeys.TAB_TITLE_UPDATE_ENABLED) &&
      changes[StorageKeys.TAB_TITLE_UPDATE_ENABLED]?.newValue !== false
    ) {
      void disableRetiredTabTitleUpdateSetting();
    }

    if (Object.prototype.hasOwnProperty.call(changes, CUSTOM_WEBSITE_KEY)) {
      const newValue = changes[CUSTOM_WEBSITE_KEY]?.newValue;
      const domains = Array.isArray(newValue) ? newValue : [];
      // The plugins too: Prompt Manager's catalog plugin is on wherever the list
      // covers its host. One after the other, so both never inject one open tab.
      void owners.siteAccess.syncCustom(domains).finally(() => owners.siteAccess.syncPlugins());
      // Enabling/disabling a site flips whether it should still show the nudge dot.
      void owners.siteAccess.syncPromptNudgeIcon();
    }

    // Re-register fetch interceptor when any watermark-related key changes.
    // (Only the download flag actually affects registration, but we also watch
    // the legacy key so a one-time migration write triggers re-registration.)
    if (WATERMARK_STORAGE_KEYS.some((key) => Object.prototype.hasOwnProperty.call(changes, key))) {
      void owners.mainWorld.registerFetchInterceptor(true);
    }

    if (
      Object.prototype.hasOwnProperty.call(
        changes,
        StorageKeys.RESPONSE_COMPLETE_NOTIFICATION_ENABLED,
      )
    ) {
      void owners.mainWorld.syncResponseCompleteObserverRegistration();
    }
  });

  // Plugin ecosystem: re-reconcile dynamic registration when the set of enabled
  // plugins changes. Plugin state lives in storage.local (not sync).
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (Object.prototype.hasOwnProperty.call(changes, StorageKeys.PLUGINS_STATE)) {
      void owners.siteAccess.syncPlugins();
    }
  });

  chrome.permissions.onAdded.addListener(({ origins }) => {
    void owners.siteAccess.permissionAdded(origins);
  });
  chrome.permissions.onRemoved.addListener(() => {
    owners.siteAccess.permissionRemoved();
  });
}
