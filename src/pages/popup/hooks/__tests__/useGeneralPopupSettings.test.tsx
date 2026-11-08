import React, { act, useEffect } from 'react';
import { type Root, createRoot } from 'react-dom/client';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import {
  type NotificationEnablementResult,
  requestNotificationEnablement,
} from '@/core/utils/notificationEnablement';
import {
  ensureNotificationsPermission,
  hasNotificationsPermission,
} from '@/core/utils/notificationsPermission';
import { requestSafariNativeNotificationPermission } from '@/core/utils/safariNativeNotifications';

import {
  GENERAL_SETTINGS_STORAGE_DEFAULTS,
  type GeneralPopupSettings,
  type GeneralPopupSettingsOptions,
  useGeneralPopupSettings,
} from '../useGeneralPopupSettings';

vi.mock('@/core/utils/notificationsPermission', () => ({
  ensureNotificationsPermission: vi.fn(),
  hasNotificationsPermission: vi.fn(),
}));
vi.mock('@/core/utils/notificationEnablement', () => ({
  requestNotificationEnablement: vi.fn(),
}));
vi.mock('@/core/utils/safariNativeNotifications', () => ({
  requestSafariNativeNotificationPermission: vi.fn(),
}));

function Harness({
  capture,
  ...options
}: GeneralPopupSettingsOptions & { capture: (settings: GeneralPopupSettings) => void }) {
  const settings = useGeneralPopupSettings(options);
  useEffect(() => {
    capture(settings);
  }, [capture, settings]);
  return null;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('useGeneralPopupSettings', () => {
  let container: HTMLDivElement;
  let root: Root;
  let settings: GeneralPopupSettings;
  const writeSyncStorage = vi.fn(async (_payload: Record<string, unknown>) => {});

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.clearAllMocks();
    vi.mocked(hasNotificationsPermission).mockResolvedValue(false);
    vi.mocked(ensureNotificationsPermission).mockResolvedValue(false);
    vi.mocked(requestNotificationEnablement).mockImplementation(async (payload) =>
      payload.action === 'finish'
        ? { ok: true, enabled: payload.granted }
        : payload.action === 'disable'
          ? { ok: true, enabled: false }
          : // A normal reconcile reports the stored switch without claiming recovery.
            { ok: true, enabled: false },
    );
    vi.mocked(requestSafariNativeNotificationPermission).mockResolvedValue(false);
    vi.mocked(chrome.storage.local.get).mockImplementation((...args: unknown[]) => {
      const callback = args[1];
      if (typeof callback === 'function') callback({});
      return Promise.resolve({});
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = async (overrides: Partial<GeneralPopupSettingsOptions> = {}) => {
    await act(async () => {
      root.render(
        <Harness
          writeSyncStorage={writeSyncStorage}
          isSafariBrowser={false}
          canUseSystemNotifications={true}
          storedResponseNotification={undefined}
          {...overrides}
          capture={(next) => (settings = next)}
        />,
      );
    });
  };

  it('applies the bulk defaults without reading or writing sync', async () => {
    await render();
    act(() => settings.hydrateFromStorage(GENERAL_SETTINGS_STORAGE_DEFAULTS));

    expect(settings.values).toEqual({
      persistentExportToolbarEnabled: true,
      remoteAnnouncementEnabled: true,
      changelogNotifyMode: 'popup',
    });
    expect(settings.responseNotification.enabled).toBe(false);
    expect(chrome.storage.sync.get).not.toHaveBeenCalled();
    expect(writeSyncStorage).not.toHaveBeenCalled();
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it('hydrates stored values using the existing opt-in and opt-out rules', async () => {
    vi.mocked(requestNotificationEnablement).mockResolvedValue({ ok: true, enabled: true });
    await render();
    act(() =>
      settings.hydrateFromStorage({
        [StorageKeys.PERSISTENT_EXPORT_TOOLBAR_ENABLED]: false,
        [StorageKeys.REMOTE_ANNOUNCEMENTS_ENABLED]: false,
      }),
    );
    expect(settings.values).toEqual({
      persistentExportToolbarEnabled: false,
      remoteAnnouncementEnabled: false,
      changelogNotifyMode: 'popup',
    });
    act(() => settings.hydrateFromStorage({}));
    expect(settings.values.persistentExportToolbarEnabled).toBe(true);
    expect(writeSyncStorage).not.toHaveBeenCalled();
    expect(ensureNotificationsPermission).not.toHaveBeenCalled();
  });

  it('persists only the changed plain settings and retains other values', async () => {
    await render();
    const before = settings.values;
    act(() => settings.onChange({ persistentExportToolbarEnabled: false }));
    expect(settings.values).toEqual({ ...before, persistentExportToolbarEnabled: false });
    expect(writeSyncStorage).toHaveBeenLastCalledWith({
      [StorageKeys.PERSISTENT_EXPORT_TOOLBAR_ENABLED]: false,
    });
    act(() => settings.onChange({ remoteAnnouncementEnabled: false }));
    expect(settings.values.persistentExportToolbarEnabled).toBe(false);
    expect(writeSyncStorage).toHaveBeenLastCalledWith({
      [StorageKeys.REMOTE_ANNOUNCEMENTS_ENABLED]: false,
    });
    expect(writeSyncStorage).toHaveBeenCalledTimes(2);
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it('reads the notify mode from local and clears the dismissed version only when choosing badge', async () => {
    vi.mocked(chrome.storage.local.get).mockImplementation((...args: unknown[]) => {
      const result = { [StorageKeys.CHANGELOG_NOTIFY_MODE]: 'badge' };
      const callback = args[1];
      if (typeof callback === 'function') callback(result);
      return Promise.resolve(result);
    });
    await render();
    expect(settings.values.changelogNotifyMode).toBe('badge');
    act(() => settings.hydrateFromStorage({ [StorageKeys.CHANGELOG_NOTIFY_MODE]: 'popup' }));
    expect(settings.values.changelogNotifyMode).toBe('badge');

    act(() => settings.onChange({ changelogNotifyMode: 'off' }));
    expect(settings.values.changelogNotifyMode).toBe('off');
    expect(chrome.storage.local.set).toHaveBeenLastCalledWith({
      [StorageKeys.CHANGELOG_NOTIFY_MODE]: 'off',
    });
    act(() => settings.onChange({ changelogNotifyMode: 'popup' }));
    expect(chrome.storage.local.set).toHaveBeenLastCalledWith({
      [StorageKeys.CHANGELOG_NOTIFY_MODE]: 'popup',
    });
    act(() => settings.onChange({ changelogNotifyMode: 'badge' }));
    expect(settings.values.changelogNotifyMode).toBe('badge');
    expect(chrome.storage.local.set).toHaveBeenLastCalledWith({
      [StorageKeys.CHANGELOG_NOTIFY_MODE]: 'badge',
      [StorageKeys.CHANGELOG_DISMISSED_VERSION]: '',
    });
    expect(writeSyncStorage).not.toHaveBeenCalled();
  });

  it('does not persist completion notifications when permission is denied', async () => {
    await render();
    await act(async () => settings.responseNotification.setEnabled(true));
    expect(settings.responseNotification.enabled).toBe(false);
    expect(settings.remoteAnnouncementPermissionGranted).toBe(false);
    expect(writeSyncStorage).not.toHaveBeenCalled();
    expect(requestSafariNativeNotificationPermission).not.toHaveBeenCalled();
  });

  it('shows granted completion notifications without a popup-owned settings write', async () => {
    const permission = deferred<boolean>();
    vi.mocked(ensureNotificationsPermission).mockReturnValue(permission.promise);
    await render();
    act(() => settings.responseNotification.setEnabled(true));
    expect(ensureNotificationsPermission).toHaveBeenCalledOnce();
    expect(writeSyncStorage).not.toHaveBeenCalled();
    await act(async () => permission.resolve(true));
    expect(settings.responseNotification.enabled).toBe(true);
    expect(settings.remoteAnnouncementPermissionGranted).toBe(true);
    expect(writeSyncStorage).not.toHaveBeenCalled();
  });

  it('requests permission in the gesture without waiting for the begin message', async () => {
    const begin = deferred<NotificationEnablementResult>();
    const permission = deferred<boolean>();
    vi.mocked(requestNotificationEnablement).mockImplementation(async (payload) => {
      if (payload.action === 'begin') return begin.promise;
      return payload.action === 'finish' ? { ok: true, enabled: payload.granted } : { ok: true };
    });
    vi.mocked(ensureNotificationsPermission).mockReturnValue(permission.promise);
    await render();
    act(() => settings.responseNotification.setEnabled(true));
    // Even an unresolved message must not move Firefox's permissions.request out of this gesture.
    expect(ensureNotificationsPermission).toHaveBeenCalledOnce();
    await act(async () => permission.resolve(true));
    expect(settings.responseNotification.enabled).toBe(true);
    expect(writeSyncStorage).not.toHaveBeenCalled();
  });

  it('keeps a later off when an earlier permission prompt is granted', async () => {
    const permission = deferred<boolean>();
    vi.mocked(ensureNotificationsPermission).mockReturnValue(permission.promise);
    await render();
    act(() => settings.responseNotification.setEnabled(true));
    act(() => settings.responseNotification.setEnabled(false));
    await act(async () => permission.resolve(true));
    await render({ storedResponseNotification: false });
    expect(settings.responseNotification.enabled).toBe(false);
    expect(writeSyncStorage).not.toHaveBeenCalled();
  });

  it('keeps a new click when a previous popup reconciliation finishes late', async () => {
    const reconcile = deferred<NotificationEnablementResult>();
    vi.mocked(requestNotificationEnablement).mockImplementation(async (payload) =>
      payload.action === 'reconcile' ? reconcile.promise : { ok: true },
    );
    await render();
    act(() => settings.responseNotification.setEnabled(false));
    await act(async () => reconcile.resolve({ ok: true, enabled: true }));
    expect(settings.responseNotification.enabled).toBe(false);
    expect(writeSyncStorage).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'uses Safari native permission without a popup sync write (granted=%s)',
    async (granted) => {
      const permission = deferred<boolean>();
      vi.mocked(requestSafariNativeNotificationPermission).mockReturnValue(permission.promise);
      await render({ isSafariBrowser: true, canUseSystemNotifications: false });
      act(() => settings.responseNotification.setEnabled(true));
      expect(settings.responseNotification.enabled).toBe(true);
      expect(requestSafariNativeNotificationPermission).toHaveBeenCalledOnce();
      expect(ensureNotificationsPermission).not.toHaveBeenCalled();
      await act(async () => permission.resolve(granted));
      expect(settings.responseNotification.enabled).toBe(granted);
      expect(settings.remoteAnnouncementPermissionGranted).toBe(false);
      expect(writeSyncStorage).not.toHaveBeenCalled();
    },
  );

  it.each([false, true])(
    'disables completion notifications without asking permission (Safari=%s)',
    async (isSafariBrowser) => {
      await render({ isSafariBrowser, storedResponseNotification: true });
      await act(async () => settings.responseNotification.setEnabled(false));
      expect(settings.responseNotification.enabled).toBe(false);
      if (isSafariBrowser) {
        expect(writeSyncStorage).toHaveBeenCalledExactlyOnceWith({
          [StorageKeys.RESPONSE_COMPLETE_NOTIFICATION_ENABLED]: false,
        });
      } else expect(writeSyncStorage).not.toHaveBeenCalled();
      expect(ensureNotificationsPermission).not.toHaveBeenCalled();
      expect(requestSafariNativeNotificationPermission).not.toHaveBeenCalled();
    },
  );

  it('stores completion notifications off when the background cannot take the disable', async () => {
    vi.mocked(requestNotificationEnablement).mockResolvedValue({ ok: false });
    await render({ storedResponseNotification: true });
    await act(async () => settings.responseNotification.setEnabled(false));
    expect(writeSyncStorage).toHaveBeenCalledExactlyOnceWith({
      [StorageKeys.RESPONSE_COMPLETE_NOTIFICATION_ENABLED]: false,
    });
  });

  it.each([false, true])(
    'follows the stored switch from the live snapshot (Safari=%s)',
    async (isSafariBrowser) => {
      await render({ isSafariBrowser, storedResponseNotification: false });
      expect(settings.responseNotification.enabled).toBe(false);
      // A restore or another window: Safari's popup has no listener of its own.
      await render({ isSafariBrowser, storedResponseNotification: true });
      expect(settings.responseNotification.enabled).toBe(true);
      await render({ isSafariBrowser, storedResponseNotification: false });
      expect(settings.responseNotification.enabled).toBe(false);
      expect(writeSyncStorage).not.toHaveBeenCalled();
    },
  );

  it('a first stored reading does not undo what the reconciliation already showed', async () => {
    vi.mocked(requestNotificationEnablement).mockResolvedValue({ ok: true, enabled: true });
    await render();
    expect(settings.responseNotification.enabled).toBe(true);
    await render({ storedResponseNotification: false });
    expect(settings.responseNotification.enabled).toBe(true);
  });

  it('checks announcement permission only when supported and ignores an obsolete read', async () => {
    const permission = deferred<boolean>();
    vi.mocked(hasNotificationsPermission).mockReturnValue(permission.promise);
    await render({ canUseSystemNotifications: false });
    expect(hasNotificationsPermission).not.toHaveBeenCalled();
    await render({ canUseSystemNotifications: true });
    expect(hasNotificationsPermission).toHaveBeenCalledOnce();
    await render({ canUseSystemNotifications: false });
    await act(async () => permission.resolve(true));
    expect(settings.remoteAnnouncementPermissionGranted).toBe(false);
  });

  it('hydrates granted announcement permission without changing any setting', async () => {
    vi.mocked(hasNotificationsPermission).mockResolvedValue(true);
    await render();
    expect(settings.remoteAnnouncementPermissionGranted).toBe(true);
    expect(settings.responseNotification.enabled).toBe(false);
    expect(writeSyncStorage).not.toHaveBeenCalled();
  });

  it('updates announcement permission from the CTA without enabling completion notifications', async () => {
    await render();
    await act(async () => settings.requestRemoteAnnouncementSystemPermission());
    expect(settings.remoteAnnouncementPermissionGranted).toBe(false);
    vi.mocked(ensureNotificationsPermission).mockResolvedValue(true);
    await act(async () => settings.requestRemoteAnnouncementSystemPermission());
    expect(settings.remoteAnnouncementPermissionGranted).toBe(true);
    expect(settings.responseNotification.enabled).toBe(false);
    expect(writeSyncStorage).not.toHaveBeenCalled();
  });
});
