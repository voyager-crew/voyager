import browser from 'webextension-polyfill';

import { StorageKeys } from '@/core/types/common';
import { getVoyagerBuildTarget, supportsExtensionNotifications } from '@/core/utils/browser';
import { getNativeOpenConversationUrl } from '@/core/utils/nativeOpenConversation';
import { hasNotificationsPermission } from '@/core/utils/notificationsPermission';
import { SAFARI_NATIVE_APP_ID } from '@/core/utils/safariNativeClipboard';
import {
  SAFARI_NOTIFICATION_PERMISSION_REQUEST,
  deliverSafariNativeNotification,
  prepareSafariNativeNotifications,
} from '@/core/utils/safariNativeNotifications';
import {
  CHATGPT_RESPONSE_NOTIFICATION_MANIFEST,
  CHATGPT_RESPONSE_NOTIFICATION_PLUGIN_ID,
} from '@/features/plugins/builtin/chatgptResponseNotification/manifest';
import { matchesAnyPattern } from '@/features/plugins/sites/matchPattern';
import { isPluginEnabled } from '@/features/plugins/storage/pluginDefaults';
import { loadPluginState } from '@/features/plugins/storage/pluginState';
import type { TranslationKey } from '@/utils/translations';

import { getTranslation } from './allTranslations';
import { type NotificationSite, siteNotificationIcon } from './notificationSiteIcon';

const RESPONSE_COMPLETE_NOTIFICATION_DEDUP_MS = 3000;
const RESPONSE_COMPLETE_NOTIFICATION_MESSAGE_KEY =
  'responseCompleteNotificationMessage' satisfies TranslationKey;
const RESPONSE_COMPLETE_NOTIFICATION_MESSAGE_FALLBACK = '{site} response complete';
const RESPONSE_COMPLETE_NOTIFICATION_SITE_PLACEHOLDER = '{site}';
const RESPONSE_COMPLETE_NOTIFICATION_MESSAGE_SEPARATOR = ': ';
const RESPONSE_COMPLETE_NOTIFICATION_TITLE_MAX_LENGTH = 120;
const RESPONSE_COMPLETE_NOTIFICATION_MESSAGE_MAX_LENGTH = 220;
const RESPONSE_COMPLETE_NOTIFICATION_ICON = 'icon-128.png';
const RESPONSE_COMPLETE_NOTIFICATION_ID_PREFIX = 'gv-response-complete-';
const RESPONSE_COMPLETE_UNKNOWN_TAB_ID = 'unknown';
// Anchored to the start, so it only strips leading invisible characters and can
// never split an emoji sequence in the label body.
const RESPONSE_COMPLETE_TURN_LABEL_PREFIXES =
  // oxlint-disable-next-line no-misleading-character-class
  /^[\u200B\u200C\u200D\u200E\u200F\uFEFF]*(?:you said|you wrote|user message|your prompt|you asked)[:\s]*/i;

const SITE_LABELS: Readonly<Record<NotificationSite, string>> = {
  gemini: 'Gemini',
  chatgpt: 'ChatGPT',
};

/** The site a completion came from, read from the sending page, never from its payload. */
function completionSiteOf(sender: chrome.runtime.MessageSender): NotificationSite {
  const url = sender.url ?? sender.tab?.url;
  return url && matchesAnyPattern(url, CHATGPT_RESPONSE_NOTIFICATION_MANIFEST.matches)
    ? 'chatgpt'
    : 'gemini';
}

/** Gemini follows the popup's switch; ChatGPT follows its plugin's switch. */
async function isCompletionSwitchOn(site: NotificationSite): Promise<boolean> {
  if (site === 'chatgpt') {
    return isPluginEnabled(await loadPluginState(), CHATGPT_RESPONSE_NOTIFICATION_PLUGIN_ID);
  }
  const setting = await chrome.storage.sync.get({
    [StorageKeys.RESPONSE_COMPLETE_NOTIFICATION_ENABLED]: false,
  });
  return setting[StorageKeys.RESPONSE_COMPLETE_NOTIFICATION_ENABLED] === true;
}

export function createResponseNotifications() {
  const responseCompleteNotificationLastShown = new Map<string, number>();
  const responseCompleteNotificationTargets = new Map<
    string,
    { conversationUrl?: string; tabId?: number }
  >();
  let nativeOpenConversationPort: ReturnType<typeof browser.runtime.connectNative> | null = null;
  interface ResponseCompleteNotificationDetails {
    conversationUrl?: string;
    conversationTitle?: string;
    userPrompt?: string;
  }

  async function getInternalI18nMessage(key: TranslationKey, fallback: string): Promise<string> {
    try {
      return await getTranslation(key);
    } catch {
      // Keep Chrome's extension locale as a last resort if storage-backed i18n fails.
    }

    try {
      return chrome.i18n?.getMessage?.(key) || fallback;
    } catch {
      return fallback;
    }
  }

  function getTabDedupKey(
    tabId: number | undefined,
    tabUrl: string | undefined,
    conversationUrl?: string,
  ): string {
    return `${tabId ?? RESPONSE_COMPLETE_UNKNOWN_TAB_ID}:${conversationUrl ?? tabUrl ?? ''}`;
  }

  function normalizeNotificationText(value: unknown, maxLength: number): string {
    if (typeof value !== 'string') return '';
    const normalized = value
      .replace(/\s+/g, ' ')
      .trim()
      .replace(RESPONSE_COMPLETE_TURN_LABEL_PREFIXES, '');
    if (!normalized) return '';
    return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
  }

  async function showResponseCompleteNotification(
    sender: chrome.runtime.MessageSender,
    details: ResponseCompleteNotificationDetails,
  ): Promise<boolean> {
    const useSafariNativeNotification = getVoyagerBuildTarget() === 'safari';
    if (!useSafariNativeNotification && !supportsExtensionNotifications()) return false;

    const site = completionSiteOf(sender);
    if (!(await isCompletionSwitchOn(site))) return false;

    // "notifications" is an optional permission (granted from the popup toggle or plugin switch);
    // the namespace check above is not reliable across grant/revoke, so verify
    // explicitly before attempting to create a notification.
    if (!useSafariNativeNotification && !(await hasNotificationsPermission())) return false;

    const conversationUrl = details.conversationUrl;
    const dedupKey = getTabDedupKey(sender.tab?.id, sender.tab?.url, conversationUrl);
    const now = Date.now();
    const lastShown = responseCompleteNotificationLastShown.get(dedupKey) ?? 0;
    if (now - lastShown < RESPONSE_COMPLETE_NOTIFICATION_DEDUP_MS) {
      return true;
    }

    responseCompleteNotificationLastShown.set(dedupKey, now);
    const notificationMessage = (
      await getInternalI18nMessage(
        RESPONSE_COMPLETE_NOTIFICATION_MESSAGE_KEY,
        RESPONSE_COMPLETE_NOTIFICATION_MESSAGE_FALLBACK,
      )
    ).replace(RESPONSE_COMPLETE_NOTIFICATION_SITE_PLACEHOLDER, SITE_LABELS[site]);
    const conversationTitle = normalizeNotificationText(
      details.conversationTitle,
      RESPONSE_COMPLETE_NOTIFICATION_TITLE_MAX_LENGTH,
    );
    // The site's logo already says which reply finished, so beside it the prompt stands alone;
    // without one (Safari, or a browser that cannot draw it) the text names the site.
    const siteIcon = useSafariNativeNotification ? null : await siteNotificationIcon(site);
    const userPrompt = normalizeNotificationText(
      details.userPrompt,
      siteIcon
        ? RESPONSE_COMPLETE_NOTIFICATION_MESSAGE_MAX_LENGTH
        : RESPONSE_COMPLETE_NOTIFICATION_MESSAGE_MAX_LENGTH -
            notificationMessage.length -
            RESPONSE_COMPLETE_NOTIFICATION_MESSAGE_SEPARATOR.length,
    );

    try {
      const notificationId = `${RESPONSE_COMPLETE_NOTIFICATION_ID_PREFIX}${sender.tab?.id ?? RESPONSE_COMPLETE_UNKNOWN_TAB_ID}-${now}`;
      // The conversation is what the person recognizes; an untitled one is named by its site.
      const title = conversationTitle || SITE_LABELS[site];
      const message = !userPrompt
        ? notificationMessage
        : siteIcon
          ? userPrompt
          : `${notificationMessage}${RESPONSE_COMPLETE_NOTIFICATION_MESSAGE_SEPARATOR}${userPrompt}`;

      if (useSafariNativeNotification) {
        return await deliverSafariNativeNotification({
          id: notificationId,
          title,
          body: message,
          url: conversationUrl,
        });
      }

      responseCompleteNotificationTargets.set(notificationId, {
        conversationUrl,
        tabId: sender.tab?.id,
      });
      await browser.notifications.create(notificationId, {
        type: 'basic',
        iconUrl: siteIcon ?? chrome.runtime.getURL(RESPONSE_COMPLETE_NOTIFICATION_ICON),
        title,
        message,
      });
      return true;
    } catch (error) {
      console.warn('[Background] Failed to show response completion notification:', error);
      return false;
    }
  }

  async function focusOrOpenConversation(url: URL): Promise<void> {
    try {
      const tabs = await browser.tabs.query({});
      const match = tabs.find((tab) => {
        if (typeof tab.url !== 'string' || typeof tab.id !== 'number') return false;
        try {
          const tabUrl = new URL(tab.url);
          return tabUrl.origin === url.origin && tabUrl.pathname === url.pathname;
        } catch {
          return false;
        }
      });

      if (match && typeof match.id === 'number') {
        const tab = await browser.tabs.update(match.id, { active: true });
        if (typeof tab.windowId === 'number') {
          await browser.windows.update(tab.windowId, { focused: true });
        }
        return;
      }
    } catch {
      // Fall through to opening a fresh tab.
    }

    await browser.tabs.create({ url: url.toString() });
  }

  // App-dispatched messages (SFSafariApplication.dispatchMessage) are delivered
  // only through a native-messaging port the background opens first — they never
  // arrive via runtime.onMessage. See "Messaging between the app and JavaScript
  // in a Safari web extension" in the Apple docs.
  function connectNativeOpenConversationPort(): void {
    try {
      const port = browser.runtime.connectNative(SAFARI_NATIVE_APP_ID);
      nativeOpenConversationPort = port;
      port.onMessage.addListener((message: unknown) => {
        const url = getNativeOpenConversationUrl(message);
        if (url) void focusOrOpenConversation(url);
      });
      port.onDisconnect.addListener(() => {
        if (nativeOpenConversationPort === port) nativeOpenConversationPort = null;
        setTimeout(connectNativeOpenConversationPort, 1000);
      });
    } catch {
      // Native host unavailable (extension running without the containing app);
      // notification clicks fall back to the app's openWindow path.
      nativeOpenConversationPort = null;
    }
  }

  function getResponseCompleteNotificationTabId(notificationId: string): number | undefined {
    const match = new RegExp(`^${RESPONSE_COMPLETE_NOTIFICATION_ID_PREFIX}(\\d+)-`).exec(
      notificationId,
    );
    if (!match) return undefined;
    const tabId = Number(match[1]);
    return Number.isFinite(tabId) ? tabId : undefined;
  }

  async function openResponseCompleteNotification(notificationId: string): Promise<void> {
    const target = responseCompleteNotificationTargets.get(notificationId);
    responseCompleteNotificationTargets.delete(notificationId);

    try {
      await browser.notifications.clear(notificationId);
    } catch {}

    const tabId = target?.tabId ?? getResponseCompleteNotificationTabId(notificationId);
    if (typeof tabId === 'number') {
      try {
        const tab = await browser.tabs.update(tabId, { active: true });
        if (typeof tab.windowId === 'number') {
          await browser.windows.update(tab.windowId, { focused: true });
        }
        return;
      } catch {
        // Fall through to opening the saved URL if the tab was closed.
      }
    }

    if (target?.conversationUrl) {
      await browser.tabs.create({ url: target.conversationUrl });
    }
  }

  function registerClickListener(): void {
    chrome.notifications?.onClicked?.addListener?.((notificationId) => {
      if (!notificationId.startsWith(RESPONSE_COMPLETE_NOTIFICATION_ID_PREFIX)) return;
      void openResponseCompleteNotification(notificationId);
    });
  }
  function handle(
    message: { type: string; payload?: unknown },
    sender: chrome.runtime.MessageSender,
  ): Promise<unknown> | null {
    if (
      message.type !== 'gv.responseComplete.notify' &&
      message.type !== SAFARI_NOTIFICATION_PERMISSION_REQUEST
    )
      return null;
    const payload = message.payload as
      | { conversationUrl?: unknown; conversationTitle?: unknown; userPrompt?: unknown }
      | undefined;
    return (async () => {
      if (message?.type === 'gv.responseComplete.notify') {
        const ok = await showResponseCompleteNotification(sender, {
          conversationUrl:
            typeof payload?.conversationUrl === 'string' ? payload.conversationUrl : undefined,
          conversationTitle:
            typeof payload?.conversationTitle === 'string' ? payload.conversationTitle : undefined,
          userPrompt: typeof payload?.userPrompt === 'string' ? payload.userPrompt : undefined,
        });
        return { ok };
      }

      if (message?.type === SAFARI_NOTIFICATION_PERMISSION_REQUEST) {
        const granted =
          getVoyagerBuildTarget() === 'safari' && (await prepareSafariNativeNotifications());
        await browser.storage.sync.set({
          [StorageKeys.RESPONSE_COMPLETE_NOTIFICATION_ENABLED]: granted,
        });
        return { ok: true, granted };
      }
    })();
  }
  return { handle, connectNativeOpenConversationPort, registerClickListener };
}
