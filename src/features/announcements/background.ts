import { logger } from '@/core/services/LoggerService';
import { StorageKeys } from '@/core/types/common';
import { getVoyagerBuildTarget, supportsExtensionNotifications } from '@/core/utils/browser';
import { hasNotificationsPermission } from '@/core/utils/notificationsPermission';
import { EXTENSION_VERSION } from '@/core/utils/version';
import type { AppLanguage } from '@/utils/language';
import { getCurrentLanguage } from '@/utils/languagePreference';

import { selectRemoteAnnouncements } from './select';
import type {
  PresentedRemoteAnnouncement,
  RemoteAnnouncementFeed,
  RemoteAnnouncementPlatform,
  RemoteAnnouncementState,
} from './types';
import { validateAnnouncementFeed } from './validate';

export const DEFAULT_ANNOUNCEMENTS_URL =
  'https://raw.githubusercontent.com/voyager-crew/voyager/main/docs/public/announcements.json';
export const REMOTE_ANNOUNCEMENTS_ALARM_NAME = 'gv-remote-announcements-check';

const CHECK_INTERVAL_MINUTES = 6 * 60;
const CHECK_INTERVAL_MS = CHECK_INTERVAL_MINUTES * 60 * 1000;
const FIRST_CHECK_MINUTES_MIN = 5;
const FIRST_CHECK_MINUTES_SPAN = 25;
const BACKOFF_BASE_MS = 30 * 60 * 1000;
const BACKOFF_MAX_MS = 24 * 60 * 60 * 1000;
const MAX_SHOWN_IDS = 200;
const MAX_PENDING_ANNOUNCEMENTS = 5;
const MAX_NOTIFICATION_LINKS = 50;
const NOTIFICATION_ICON = 'icon-128.png';
const NOTIFICATION_TITLE_MAX_LENGTH = 120;
const NOTIFICATION_BODY_MAX_LENGTH = 280;

type CreateNotification = (
  notificationId: string,
  options: chrome.notifications.NotificationCreateOptions,
) => Promise<string>;

export interface RemoteAnnouncementBackgroundServiceOptions {
  readonly feedUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
  readonly random?: () => number;
  readonly getLanguage?: () => Promise<AppLanguage>;
  readonly getPlatform?: () => RemoteAnnouncementPlatform;
  readonly getExtensionVersion?: () => string;
  readonly supportsNotifications?: () => boolean;
  readonly hasNotificationPermission?: () => Promise<boolean>;
  readonly createNotification?: CreateNotification;
  readonly openTab?: (url: string) => Promise<void>;
}

function normalizeText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function normalizeState(value: unknown): RemoteAnnouncementState {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { shownIds: [] };
  }

  const raw = value as Partial<RemoteAnnouncementState>;
  const cacheFeed = raw.cache ? validateAnnouncementFeed(raw.cache.feed) : null;
  const notificationLinks =
    raw.notificationLinks &&
    typeof raw.notificationLinks === 'object' &&
    !Array.isArray(raw.notificationLinks)
      ? Object.fromEntries(
          Object.entries(raw.notificationLinks).filter(
            ([key, link]) => typeof key === 'string' && typeof link === 'string',
          ),
        )
      : undefined;

  return {
    shownIds: Array.isArray(raw.shownIds)
      ? raw.shownIds.filter((id): id is string => typeof id === 'string').slice(-MAX_SHOWN_IDS)
      : [],
    ...(typeof raw.lastCheckedAt === 'number' ? { lastCheckedAt: raw.lastCheckedAt } : {}),
    ...(typeof raw.lastSuccessAt === 'number' ? { lastSuccessAt: raw.lastSuccessAt } : {}),
    ...(typeof raw.failureCount === 'number' ? { failureCount: raw.failureCount } : {}),
    ...(typeof raw.nextAllowedFetchAt === 'number'
      ? { nextAllowedFetchAt: raw.nextAllowedFetchAt }
      : {}),
    ...(cacheFeed && typeof raw.cache?.fetchedAt === 'number'
      ? { cache: { feed: cacheFeed, fetchedAt: raw.cache.fetchedAt } }
      : {}),
    ...(notificationLinks ? { notificationLinks } : {}),
  };
}

function normalizePending(value: unknown): PresentedRemoteAnnouncement[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is PresentedRemoteAnnouncement => {
      if (typeof item !== 'object' || item === null) return false;
      const record = item as Partial<PresentedRemoteAnnouncement>;
      return (
        typeof record.id === 'string' &&
        typeof record.title === 'string' &&
        typeof record.body === 'string' &&
        (record.level === 'info' || record.level === 'warning' || record.level === 'critical') &&
        typeof record.createdAt === 'number' &&
        (typeof record.link === 'undefined' || typeof record.link === 'string') &&
        (typeof record.linkLabel === 'undefined' || typeof record.linkLabel === 'string') &&
        (typeof record.requiresAction === 'undefined' || typeof record.requiresAction === 'boolean')
      );
    })
    .slice(-MAX_PENDING_ANNOUNCEMENTS);
}

function getBackoffMs(failureCount: number): number {
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** Math.max(0, failureCount - 1));
}

function resolvePlatform(): RemoteAnnouncementPlatform {
  const target = getVoyagerBuildTarget();
  return target === 'edge' || target === 'firefox' || target === 'safari' ? target : 'chrome';
}

async function createChromeNotification(
  notificationId: string,
  options: chrome.notifications.NotificationCreateOptions,
): Promise<string> {
  return await chrome.notifications.create(notificationId, options);
}

async function openChromeTab(url: string): Promise<void> {
  await chrome.tabs.create({ url });
}

function isRemoteAnnouncementMessage(
  message: unknown,
): message is { type: string; payload?: { id?: unknown } } {
  return (
    typeof message === 'object' &&
    message !== null &&
    typeof (message as { type?: unknown }).type === 'string'
  );
}

export class RemoteAnnouncementBackgroundService {
  private readonly feedUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly getLanguage: () => Promise<AppLanguage>;
  private readonly getPlatform: () => RemoteAnnouncementPlatform;
  private readonly getExtensionVersion: () => string;
  private readonly supportsNotifications: () => boolean;
  private readonly hasNotificationPermission: () => Promise<boolean>;
  private readonly createNotification: CreateNotification;
  private readonly openTab: (url: string) => Promise<void>;
  private refreshPromise: Promise<void> | null = null;
  private started = false;

  constructor(options: RemoteAnnouncementBackgroundServiceOptions = {}) {
    this.feedUrl = options.feedUrl ?? DEFAULT_ANNOUNCEMENTS_URL;
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
    this.now = options.now ?? (() => Date.now());
    this.random = options.random ?? (() => Math.random());
    this.getLanguage = options.getLanguage ?? getCurrentLanguage;
    this.getPlatform = options.getPlatform ?? resolvePlatform;
    this.getExtensionVersion = options.getExtensionVersion ?? (() => EXTENSION_VERSION);
    this.supportsNotifications = options.supportsNotifications ?? supportsExtensionNotifications;
    this.hasNotificationPermission =
      options.hasNotificationPermission ?? hasNotificationsPermission;
    this.createNotification = options.createNotification ?? createChromeNotification;
    this.openTab = options.openTab ?? openChromeTab;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    void this.ensureAlarm();

    chrome.alarms?.onAlarm?.addListener((alarm) => {
      if (alarm.name === REMOTE_ANNOUNCEMENTS_ALARM_NAME) {
        void this.checkNow();
      }
    });

    chrome.runtime?.onInstalled?.addListener?.(() => {
      void this.ensureAlarm();
    });
    chrome.runtime?.onStartup?.addListener?.(() => {
      void this.ensureAlarm();
    });
    chrome.storage?.onChanged?.addListener?.((changes, areaName) => {
      if (
        areaName !== 'sync' ||
        !Object.prototype.hasOwnProperty.call(changes, StorageKeys.REMOTE_ANNOUNCEMENTS_ENABLED)
      ) {
        return;
      }
      if (changes[StorageKeys.REMOTE_ANNOUNCEMENTS_ENABLED]?.newValue === false) {
        void this.clearPendingAnnouncements();
        return;
      }
      void this.ensureAlarm();
      void this.checkNow();
    });
    chrome.notifications?.onClicked?.addListener?.((notificationId) => {
      if (notificationId.startsWith('gv-remote-announcement-')) {
        void this.openNotificationLink(notificationId);
      }
    });
  }

  async ensureAlarm(): Promise<void> {
    if (!chrome.alarms?.create) return;
    try {
      const existing = await chrome.alarms.get?.(REMOTE_ANNOUNCEMENTS_ALARM_NAME);
      if (existing) return;
      await chrome.alarms.create(REMOTE_ANNOUNCEMENTS_ALARM_NAME, {
        delayInMinutes:
          FIRST_CHECK_MINUTES_MIN + Math.floor(this.random() * FIRST_CHECK_MINUTES_SPAN),
        periodInMinutes: CHECK_INTERVAL_MINUTES,
      });
    } catch (error) {
      logger.warn('Remote announcement alarm setup failed', { error: String(error) });
    }
  }

  async checkNow(): Promise<void> {
    if (!this.refreshPromise) {
      this.refreshPromise = this.performCheck().finally(() => {
        this.refreshPromise = null;
      });
    }
    await this.refreshPromise;
  }

  async getPendingAnnouncements(): Promise<PresentedRemoteAnnouncement[]> {
    if (!(await this.isEnabled())) return [];
    return await this.loadPendingAnnouncements();
  }

  async acknowledgeAnnouncement(id: string): Promise<void> {
    await this.markShown(id);
    const pending = await this.loadPendingAnnouncements();
    await this.savePendingAnnouncements(pending.filter((announcement) => announcement.id !== id));
  }

  private async performCheck(): Promise<void> {
    if (!(await this.isEnabled())) return;

    const now = this.now();
    const { feed, state } = await this.resolveFeed(now);
    if (!feed) return;

    const language = await this.getLanguage();
    const pending = await this.loadPendingAnnouncements();
    const shownIds = new Set([...state.shownIds, ...pending.map((item) => item.id)]);
    const [announcement] = selectRemoteAnnouncements(feed, {
      now,
      language,
      platform: this.getPlatform(),
      extensionVersion: this.getExtensionVersion(),
      shownIds,
    });
    if (!announcement) {
      if (pending.length > 0) await this.broadcastPendingAnnouncements(pending);
      return;
    }

    await this.presentAnnouncement(announcement);
  }

  private async resolveFeed(
    now: number,
  ): Promise<{ feed: RemoteAnnouncementFeed | null; state: RemoteAnnouncementState }> {
    const state = await this.loadState();
    if (state.cache && now - state.cache.fetchedAt < CHECK_INTERVAL_MS) {
      const nextState = { ...state, lastCheckedAt: now };
      await this.saveState(nextState);
      return { feed: state.cache.feed, state: nextState };
    }

    if (state.nextAllowedFetchAt && now < state.nextAllowedFetchAt) {
      return { feed: state.cache?.feed ?? null, state };
    }

    try {
      const response = await this.fetchImpl(this.feedUrl, { cache: 'no-cache' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const feed = validateAnnouncementFeed(await response.json());
      if (!feed) throw new Error('Invalid announcement feed');
      const nextState: RemoteAnnouncementState = {
        ...state,
        lastCheckedAt: now,
        lastSuccessAt: now,
        failureCount: 0,
        nextAllowedFetchAt: now + CHECK_INTERVAL_MS,
        cache: { feed, fetchedAt: now },
      };
      await this.saveState(nextState);
      return { feed, state: nextState };
    } catch (error) {
      const failureCount = Math.min((state.failureCount ?? 0) + 1, 10);
      const nextState: RemoteAnnouncementState = {
        ...state,
        lastCheckedAt: now,
        failureCount,
        nextAllowedFetchAt: now + getBackoffMs(failureCount),
      };
      await this.saveState(nextState);
      logger.warn('Remote announcement fetch failed', { error: String(error) });
      return { feed: state.cache?.feed ?? null, state: nextState };
    }
  }

  private async presentAnnouncement(announcement: PresentedRemoteAnnouncement): Promise<void> {
    if (this.supportsNotifications() && (await this.hasNotificationPermission())) {
      const notificationId = `gv-remote-announcement-${announcement.id}`;
      try {
        await this.createNotification(notificationId, {
          type: 'basic',
          iconUrl: chrome.runtime.getURL(NOTIFICATION_ICON),
          title: normalizeText(announcement.title, NOTIFICATION_TITLE_MAX_LENGTH),
          message: normalizeText(announcement.body, NOTIFICATION_BODY_MAX_LENGTH),
          priority:
            announcement.level === 'critical' ? 2 : announcement.level === 'warning' ? 1 : 0,
        });
        await this.markShown(announcement.id, announcement.link, notificationId);
        return;
      } catch (error) {
        logger.warn('Remote announcement notification failed', { error: String(error) });
      }
    }

    await this.queuePendingAnnouncement(announcement);
  }

  private async queuePendingAnnouncement(announcement: PresentedRemoteAnnouncement): Promise<void> {
    const pending = await this.loadPendingAnnouncements();
    const next = [...pending.filter((item) => item.id !== announcement.id), announcement].slice(
      -MAX_PENDING_ANNOUNCEMENTS,
    );
    await this.savePendingAnnouncements(next);
    await this.broadcastPendingAnnouncements(next);
  }

  private async broadcastPendingAnnouncements(
    announcements: readonly PresentedRemoteAnnouncement[],
  ): Promise<void> {
    if (!chrome.tabs?.query || !chrome.tabs?.sendMessage) return;
    try {
      const tabs = await chrome.tabs.query({});
      await Promise.all(
        tabs.map(async (tab) => {
          if (typeof tab.id !== 'number') return;
          try {
            await chrome.tabs.sendMessage(tab.id, {
              type: 'gv.remoteAnnouncement.show',
              payload: { announcements },
            });
          } catch {
            // Non-injected tabs reject the message; ignore.
          }
        }),
      );
    } catch {
      // No visible effect; content scripts also read pending announcements at startup.
    }
  }

  private async openNotificationLink(notificationId: string): Promise<void> {
    const state = await this.loadState();
    const link = state.notificationLinks?.[notificationId];
    if (!link) return;
    try {
      await this.openTab(link);
    } catch {
      // User already saw the notification; opening the link is best-effort.
    }
  }

  private async markShown(id: string, link?: string, notificationId?: string): Promise<void> {
    const state = await this.loadState();
    const shownIds = [...state.shownIds.filter((shownId) => shownId !== id), id].slice(
      -MAX_SHOWN_IDS,
    );
    const notificationLinks =
      notificationId && link
        ? Object.fromEntries(
            [...Object.entries(state.notificationLinks ?? {}), [notificationId, link]].slice(
              -MAX_NOTIFICATION_LINKS,
            ),
          )
        : state.notificationLinks;
    await this.saveState({
      ...state,
      shownIds,
      ...(notificationLinks ? { notificationLinks } : {}),
    });
  }

  private async isEnabled(): Promise<boolean> {
    try {
      const result = await chrome.storage.sync.get({
        [StorageKeys.REMOTE_ANNOUNCEMENTS_ENABLED]: true,
      });
      return result?.[StorageKeys.REMOTE_ANNOUNCEMENTS_ENABLED] !== false;
    } catch {
      return false;
    }
  }

  private async loadState(): Promise<RemoteAnnouncementState> {
    try {
      const result = await chrome.storage.local.get({
        [StorageKeys.REMOTE_ANNOUNCEMENTS_STATE]: { shownIds: [] },
      });
      return normalizeState(result?.[StorageKeys.REMOTE_ANNOUNCEMENTS_STATE]);
    } catch {
      return { shownIds: [] };
    }
  }

  private async saveState(state: RemoteAnnouncementState): Promise<void> {
    try {
      await chrome.storage.local.set({ [StorageKeys.REMOTE_ANNOUNCEMENTS_STATE]: state });
    } catch {
      // Silent by design: announcements must not affect normal extension use.
    }
  }

  private async loadPendingAnnouncements(): Promise<PresentedRemoteAnnouncement[]> {
    try {
      const result = await chrome.storage.local.get({
        [StorageKeys.REMOTE_ANNOUNCEMENTS_PENDING]: [],
      });
      return normalizePending(result?.[StorageKeys.REMOTE_ANNOUNCEMENTS_PENDING]);
    } catch {
      return [];
    }
  }

  private async savePendingAnnouncements(
    announcements: readonly PresentedRemoteAnnouncement[],
  ): Promise<void> {
    try {
      await chrome.storage.local.set({
        [StorageKeys.REMOTE_ANNOUNCEMENTS_PENDING]: [...announcements],
      });
    } catch {
      // Silent by design.
    }
  }

  private async clearPendingAnnouncements(): Promise<void> {
    try {
      await chrome.storage.local.remove(StorageKeys.REMOTE_ANNOUNCEMENTS_PENDING);
    } catch {
      // Silent by design.
    }
  }
}

export function startRemoteAnnouncementBackgroundService(): RemoteAnnouncementBackgroundService {
  const service = new RemoteAnnouncementBackgroundService();
  service.start();
  return service;
}

export function isRemoteAnnouncementRuntimeMessage(message: unknown): message is {
  type:
    | 'gv.remoteAnnouncement.getPending'
    | 'gv.remoteAnnouncement.ack'
    | 'gv.remoteAnnouncement.dismiss';
  payload?: { id?: unknown };
} {
  if (!isRemoteAnnouncementMessage(message)) return false;
  return (
    message.type === 'gv.remoteAnnouncement.getPending' ||
    message.type === 'gv.remoteAnnouncement.ack' ||
    message.type === 'gv.remoteAnnouncement.dismiss'
  );
}
