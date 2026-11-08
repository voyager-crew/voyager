import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { StorageKeys } from '@/core/types/common';
import {
  type ChangelogNotifyMode,
  parseChangelogNotifyMode,
} from '@/core/utils/changelogNotifyMode';
import { requestNotificationEnablement } from '@/core/utils/notificationEnablement';
import {
  ensureNotificationsPermission,
  hasNotificationsPermission,
} from '@/core/utils/notificationsPermission';
import { requestSafariNativeNotificationPermission } from '@/core/utils/safariNativeNotifications';

import type { GeneralSettingsValues } from '../components/GeneralSettingsCard';

// Highlights and completion notifications are official plugin rows now; their stored
// values come from the popup's live snapshot, not this one-time read.
export const GENERAL_SETTINGS_STORAGE_DEFAULTS = {
  [StorageKeys.PERSISTENT_EXPORT_TOOLBAR_ENABLED]: true,
  [StorageKeys.REMOTE_ANNOUNCEMENTS_ENABLED]: true,
};

type PlainGeneralSettings = Omit<GeneralSettingsValues, 'changelogNotifyMode'>;

const PLAIN_SETTING_STORAGE_KEYS = {
  persistentExportToolbarEnabled: StorageKeys.PERSISTENT_EXPORT_TOOLBAR_ENABLED,
  remoteAnnouncementEnabled: StorageKeys.REMOTE_ANNOUNCEMENTS_ENABLED,
} satisfies Record<keyof PlainGeneralSettings, string>;

export interface GeneralPopupSettingsOptions {
  writeSyncStorage: (payload: Record<string, unknown>) => Promise<void>;
  isSafariBrowser: boolean;
  canUseSystemNotifications: boolean;
  /** The stored completion-notification switch from the live snapshot; undefined until read. */
  storedResponseNotification: boolean | undefined;
}

/** The completion-notification switch: shown value and its permission flow. */
export interface ResponseNotificationControl {
  enabled: boolean;
  /** Runs the permission flow from the click itself (Firefox needs it first in the gesture). */
  setEnabled: (enabled: boolean) => void;
}

export interface GeneralPopupSettings {
  values: GeneralSettingsValues;
  onChange: (patch: Partial<GeneralSettingsValues>) => void;
  hydrateFromStorage: (raw: Record<string, unknown>) => void;
  responseNotification: ResponseNotificationControl;
  remoteAnnouncementPermissionGranted: boolean;
  requestRemoteAnnouncementSystemPermission: () => Promise<void>;
}

export function useGeneralPopupSettings({
  writeSyncStorage,
  isSafariBrowser,
  canUseSystemNotifications,
  storedResponseNotification,
}: GeneralPopupSettingsOptions): GeneralPopupSettings {
  const [plainSettings, setPlainSettings] = useState<PlainGeneralSettings>({
    persistentExportToolbarEnabled: true,
    remoteAnnouncementEnabled: true,
  });
  const [changelogNotifyMode, setChangelogNotifyMode] = useState<ChangelogNotifyMode>('popup');
  const [responseCompleteNotificationEnabled, setResponseCompleteNotificationEnabled] =
    useState(false);
  const [remoteAnnouncementPermissionGranted, setRemoteAnnouncementPermissionGranted] =
    useState(false);
  const notificationUi = useRef({
    active: true,
    revision: 0,
    requestRevision: 0,
    supersedesHydration: false,
  });

  useEffect(() => {
    if (isSafariBrowser) return;
    const state = notificationUi.current;
    state.active = true;
    const revision = state.revision;
    const onChanged = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      const key = StorageKeys.RESPONSE_COMPLETE_NOTIFICATION_ENABLED;
      if (!state.active || area !== 'sync' || !Object.hasOwn(changes, key)) return;
      const enabled = changes[key].newValue === true;
      state.revision++;
      // An on is also the worker's acknowledgement; only off cancels a permission request.
      if (!enabled) state.requestRevision++;
      state.supersedesHydration = true;
      setResponseCompleteNotificationEnabled(enabled);
    };
    try {
      chrome.storage.onChanged.addListener(onChanged);
    } catch {
      // A closing popup may already have lost its extension context.
    }
    void requestNotificationEnablement({ action: 'reconcile', source: 'popup' }).then((result) => {
      if (!state.active || state.revision !== revision || !result.ok) return;
      if (typeof result.enabled === 'boolean') {
        // A grant can consume its intent before this read; the older bulk snapshot is never authority.
        state.supersedesHydration = true;
        setResponseCompleteNotificationEnabled(result.enabled);
      }
    });
    return () => {
      state.active = false;
      state.revision++;
      state.requestRevision++;
      try {
        chrome.storage.onChanged.removeListener(onChanged);
      } catch {
        // Ignore cleanup after extension context invalidation.
      }
    };
  }, [isSafariBrowser]);

  useEffect(() => {
    try {
      chrome.storage?.local?.get(StorageKeys.CHANGELOG_NOTIFY_MODE, (res) => {
        setChangelogNotifyMode(parseChangelogNotifyMode(res?.[StorageKeys.CHANGELOG_NOTIFY_MODE]));
      });
    } catch {
      // Ignore storage errors (e.g. invalidated extension context).
    }
  }, []);

  useEffect(() => {
    let active = true;
    if (!canUseSystemNotifications) {
      setRemoteAnnouncementPermissionGranted(false);
      return () => {
        active = false;
      };
    }
    void hasNotificationsPermission().then((granted) => {
      if (active) setRemoteAnnouncementPermissionGranted(granted);
    });
    return () => {
      active = false;
    };
  }, [canUseSystemNotifications]);

  const hydrateFromStorage = useCallback((raw: Record<string, unknown>): void => {
    setPlainSettings({
      persistentExportToolbarEnabled: raw[StorageKeys.PERSISTENT_EXPORT_TOOLBAR_ENABLED] !== false,
      remoteAnnouncementEnabled: raw[StorageKeys.REMOTE_ANNOUNCEMENTS_ENABLED] !== false,
    });
  }, []);

  // The stored switch, as the live snapshot reports it. Its first reading must not undo what a
  // click or the popup's reconciliation already showed; every later reading is a real change.
  const firstStoredReading = useRef(true);
  useEffect(() => {
    if (storedResponseNotification === undefined) return;
    const first = firstStoredReading.current;
    firstStoredReading.current = false;
    if (first && !isSafariBrowser && notificationUi.current.supersedesHydration) return;
    setResponseCompleteNotificationEnabled(storedResponseNotification);
  }, [storedResponseNotification, isSafariBrowser]);

  const handleChangelogNotifyModeChange = useCallback((mode: ChangelogNotifyMode): void => {
    setChangelogNotifyMode(mode);
    try {
      const updates: Record<string, string> = { [StorageKeys.CHANGELOG_NOTIFY_MODE]: mode };
      // Allow the current release's NEW badge to appear when badge mode is enabled.
      if (mode === 'badge') updates[StorageKeys.CHANGELOG_DISMISSED_VERSION] = '';
      chrome.storage?.local?.set(updates);
    } catch {
      // Ignore storage errors.
    }
  }, []);

  const handleResponseCompleteNotificationChange = useCallback(
    async (next: boolean): Promise<void> => {
      if (next && isSafariBrowser) {
        setResponseCompleteNotificationEnabled(true);
        const granted = await requestSafariNativeNotificationPermission();
        setResponseCompleteNotificationEnabled(granted);
        return;
      }
      if (isSafariBrowser) {
        setResponseCompleteNotificationEnabled(false);
        void writeSyncStorage({ [StorageKeys.RESPONSE_COMPLETE_NOTIFICATION_ENABLED]: false });
        return;
      }
      const state = notificationUi.current;
      state.revision++;
      const revision = ++state.requestRevision;
      state.supersedesHydration = true;
      setResponseCompleteNotificationEnabled(next);
      if (next) {
        const requestId = crypto.randomUUID();
        // Chrome can close the popup for its prompt; hand off intent before the first await.
        void requestNotificationEnablement({ action: 'begin', requestId });
        // Firefox requires the permission request to be the first await in this gesture.
        const granted = await ensureNotificationsPermission();
        if (!state.active || state.requestRevision !== revision) return;
        if (granted) setRemoteAnnouncementPermissionGranted(true);
        const viewRevision = state.revision;
        const result = await requestNotificationEnablement({
          action: 'finish',
          requestId,
          granted,
        });
        if (!state.active || state.requestRevision !== revision) return;
        // Another settings writer can update the view while this reply is in transit.
        if (state.revision !== viewRevision) return;
        setResponseCompleteNotificationEnabled(result.ok && result.enabled === true);
      } else {
        // Off cancels a pending grant even when the persisted switch is already false.
        void requestNotificationEnablement({ action: 'disable' }).then((result) => {
          // An unreachable background must not leave the switch shown off but stored on.
          if (!result.ok)
            void writeSyncStorage({ [StorageKeys.RESPONSE_COMPLETE_NOTIFICATION_ENABLED]: false });
        });
      }
    },
    [isSafariBrowser, writeSyncStorage],
  );

  const requestRemoteAnnouncementSystemPermission = useCallback(async (): Promise<void> => {
    if (await ensureNotificationsPermission()) {
      setRemoteAnnouncementPermissionGranted(true);
    }
  }, []);

  const onChange = useCallback(
    (patch: Partial<GeneralSettingsValues>): void => {
      const { changelogNotifyMode: notifyMode, ...rest } = patch;
      if (notifyMode !== undefined) handleChangelogNotifyModeChange(notifyMode);
      if (Object.keys(rest).length === 0) return;

      const nextSettings: Partial<PlainGeneralSettings> = {};
      const payload: Record<string, unknown> = {};
      for (const key of Object.keys(PLAIN_SETTING_STORAGE_KEYS) as Array<
        keyof PlainGeneralSettings
      >) {
        const value = rest[key];
        if (typeof value !== 'boolean') continue;
        nextSettings[key] = value;
        payload[PLAIN_SETTING_STORAGE_KEYS[key]] = value;
      }
      setPlainSettings((current) => ({ ...current, ...nextSettings }));
      void writeSyncStorage(payload);
    },
    [handleChangelogNotifyModeChange, writeSyncStorage],
  );

  const setResponseNotificationEnabled = useCallback(
    (next: boolean): void => void handleResponseCompleteNotificationChange(next),
    [handleResponseCompleteNotificationChange],
  );
  const responseNotification = useMemo(
    () => ({
      enabled: responseCompleteNotificationEnabled,
      setEnabled: setResponseNotificationEnabled,
    }),
    [responseCompleteNotificationEnabled, setResponseNotificationEnabled],
  );

  return {
    values: { ...plainSettings, changelogNotifyMode },
    onChange,
    hydrateFromStorage,
    responseNotification,
    remoteAnnouncementPermissionGranted,
    requestRemoteAnnouncementSystemPermission,
  };
}
