import { type Mock, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';

import { REMOTE_ANNOUNCEMENTS_ALARM_NAME, RemoteAnnouncementBackgroundService } from './background';

// Announcement preferences must stay usable without the content page's dynamic locale loader.
vi.mock('@/utils/translations', () => {
  throw new Error('A service worker cannot load the content-page translations');
});

const NOW = Date.parse('2026-06-16T12:00:00Z');

const FEED = {
  version: 1,
  announcements: [
    {
      id: 'gemini-settings-change-2026-06',
      level: 'warning',
      startsAt: '2026-06-01T00:00:00Z',
      platforms: ['chrome'],
      locales: {
        default: {
          title: 'Gemini settings changed',
          body: 'Open Voyager docs for the workaround.',
          link: 'https://voyager.nagi.fun/guide/settings',
        },
      },
    },
  ],
};

function makeFetch(body: unknown, ok = true) {
  return vi.fn(async () => ({
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  }));
}

function installStorage(syncStore: Record<string, unknown>, localStore: Record<string, unknown>) {
  const read = (store: Record<string, unknown>, query: unknown): Record<string, unknown> => {
    if (typeof query === 'string') return { [query]: store[query] };
    if (Array.isArray(query)) {
      return Object.fromEntries(query.map((key) => [key, store[key]]));
    }
    if (query && typeof query === 'object') {
      const defaults = query as Record<string, unknown>;
      return Object.fromEntries(
        Object.entries(defaults).map(([key, fallback]) => [
          key,
          Object.prototype.hasOwnProperty.call(store, key) ? store[key] : fallback,
        ]),
      );
    }
    return { ...store };
  };

  (chrome.storage.sync.get as unknown as Mock).mockImplementation(async (query) =>
    read(syncStore, query),
  );
  (chrome.storage.local.get as unknown as Mock).mockImplementation(async (query) =>
    read(localStore, query),
  );
  (chrome.storage.sync.set as unknown as Mock).mockImplementation(async (payload) => {
    Object.assign(syncStore, payload);
  });
  (chrome.storage.local.set as unknown as Mock).mockImplementation(async (payload) => {
    Object.assign(localStore, payload);
  });
  (chrome.storage.local.remove as unknown as Mock).mockImplementation(async (key) => {
    delete localStore[key as string];
  });
}

function makeService(
  options: {
    fetchImpl?: ReturnType<typeof makeFetch>;
    supportsNotifications?: boolean;
    hasPermission?: boolean;
    createNotification?: Mock;
  } = {},
) {
  return new RemoteAnnouncementBackgroundService({
    feedUrl: 'https://example.com/announcements.json',
    fetchImpl: (options.fetchImpl ?? makeFetch(FEED)) as unknown as typeof fetch,
    now: () => NOW,
    random: () => 0,
    getLanguage: async () => 'en',
    getPlatform: () => 'chrome',
    getExtensionVersion: () => '1.4.9',
    supportsNotifications: () => options.supportsNotifications ?? true,
    hasNotificationPermission: async () => options.hasPermission ?? true,
    createNotification:
      options.createNotification ??
      vi.fn(async (notificationId: string) => `created:${notificationId}`),
    openTab: vi.fn(async () => undefined),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  installStorage(
    { [StorageKeys.REMOTE_ANNOUNCEMENTS_ENABLED]: true },
    { [StorageKeys.REMOTE_ANNOUNCEMENTS_STATE]: { shownIds: [] } },
  );
  (chrome.alarms.get as unknown as Mock).mockResolvedValue(undefined);
  (chrome.tabs.query as unknown as Mock).mockResolvedValue([{ id: 1 }, { id: 2 }]);
  (chrome.tabs.sendMessage as unknown as Mock).mockResolvedValue(undefined);
});

describe('RemoteAnnouncementBackgroundService', () => {
  it('registers the periodic alarm with a jittered first check', async () => {
    const service = makeService();
    service.start();
    await vi.waitFor(() => {
      expect(chrome.alarms.create).toHaveBeenCalledWith(REMOTE_ANNOUNCEMENTS_ALARM_NAME, {
        delayInMinutes: 5,
        periodInMinutes: 360,
      });
    });
  });

  it('uses a fresh cache without network traffic', async () => {
    const localStore = {
      [StorageKeys.REMOTE_ANNOUNCEMENTS_STATE]: {
        shownIds: [],
        cache: { feed: FEED, fetchedAt: NOW - 60 * 60 * 1000 },
      },
    };
    installStorage({ [StorageKeys.REMOTE_ANNOUNCEMENTS_ENABLED]: true }, localStore);
    const fetchImpl = makeFetch(FEED);
    const createNotification = vi.fn(async (notificationId: string) => notificationId);
    const service = makeService({ fetchImpl, createNotification });

    await service.checkNow();

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(createNotification).toHaveBeenCalledTimes(1);
  });

  it('marks an announcement shown after creating a system notification', async () => {
    const localStore: Record<string, unknown> = {
      [StorageKeys.REMOTE_ANNOUNCEMENTS_STATE]: { shownIds: [] },
    };
    installStorage({ [StorageKeys.REMOTE_ANNOUNCEMENTS_ENABLED]: true }, localStore);
    const createNotification = vi.fn(async (notificationId: string) => notificationId);
    const service = makeService({ createNotification });

    await service.checkNow();

    expect(createNotification).toHaveBeenCalledWith(
      'gv-remote-announcement-gemini-settings-change-2026-06',
      expect.objectContaining({
        type: 'basic',
        title: 'Gemini settings changed',
        message: 'Open Voyager docs for the workaround.',
      }),
    );
    expect(
      (localStore[StorageKeys.REMOTE_ANNOUNCEMENTS_STATE] as { shownIds: string[] }).shownIds,
    ).toContain('gemini-settings-change-2026-06');
  });

  it('queues page fallback when notification permission is missing', async () => {
    const localStore: Record<string, unknown> = {
      [StorageKeys.REMOTE_ANNOUNCEMENTS_STATE]: { shownIds: [] },
    };
    installStorage({ [StorageKeys.REMOTE_ANNOUNCEMENTS_ENABLED]: true }, localStore);
    const service = makeService({ hasPermission: false });

    await service.checkNow();

    expect(localStore[StorageKeys.REMOTE_ANNOUNCEMENTS_PENDING]).toEqual([
      expect.objectContaining({ id: 'gemini-settings-change-2026-06' }),
    ]);
    expect(chrome.tabs.sendMessage).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ type: 'gv.remoteAnnouncement.show' }),
    );
  });

  it('backs off silently after fetch failures', async () => {
    const localStore: Record<string, unknown> = {
      [StorageKeys.REMOTE_ANNOUNCEMENTS_STATE]: { shownIds: [] },
    };
    installStorage({ [StorageKeys.REMOTE_ANNOUNCEMENTS_ENABLED]: true }, localStore);
    const service = makeService({ fetchImpl: makeFetch({}, false) });

    await service.checkNow();

    const state = localStore[StorageKeys.REMOTE_ANNOUNCEMENTS_STATE] as {
      failureCount: number;
      nextAllowedFetchAt: number;
    };
    expect(state.failureCount).toBe(1);
    expect(state.nextAllowedFetchAt).toBe(NOW + 30 * 60 * 1000);
  });
});
