import type { GeminiSelectorHost } from '@/core/gemini/selectors/types';
import { logger } from '@/core/services/LoggerService';
import { StorageKeys } from '@/core/types/common';
import {
  GEMINI_SELECTOR_REFRESH_MESSAGE,
  GEMINI_SELECTOR_SET_ENABLED_MESSAGE,
  GEMINI_SELECTOR_STATUS_MESSAGE,
  type GeminiSelectorResponse,
  isGeminiSelectorMessage,
} from '@/features/geminiSelectorFixes/messages';
import { geminiSelectorHostFromUrl } from '@/features/geminiSelectorFixes/policy';
import { GeminiSelectorRefresher } from '@/features/geminiSelectorFixes/refresh';
import { isGeminiSelectorHost } from '@/features/plugins/sites/hostPolicy';

import { getSenderPageUrl, isTrustedExtensionPageSender } from './runtimeMessageRouting';

type SelectorOwner = Pick<GeminiSelectorRefresher, 'status' | 'setEnabled' | 'refresh'>;
type BackgroundOwner = SelectorOwner &
  Pick<GeminiSelectorRefresher, 'abortAll' | 'clearCachesUnlessEnabled'>;
type ResolveTab = (tabId: number) => Promise<{ url?: string }>;

interface SelectorRequest {
  readonly type: string;
  readonly host: GeminiSelectorHost;
  readonly tabId?: number;
  readonly enabled?: boolean;
  readonly force?: boolean;
}

function readRequest(value: unknown): SelectorRequest | null {
  if (!isGeminiSelectorMessage(value)) return null;
  const request = value as Record<string, unknown>;
  if (typeof request.host !== 'string' || !isGeminiSelectorHost(request.host)) return null;
  if (
    request.tabId !== undefined &&
    (typeof request.tabId !== 'number' || !Number.isSafeInteger(request.tabId) || request.tabId < 0)
  ) {
    return null;
  }
  if (request.force !== undefined && typeof request.force !== 'boolean') return null;
  if (
    request.type === GEMINI_SELECTOR_SET_ENABLED_MESSAGE &&
    typeof request.enabled !== 'boolean'
  ) {
    return null;
  }
  return {
    type: request.type as string,
    host: request.host,
    ...(typeof request.tabId === 'number' ? { tabId: request.tabId } : {}),
    ...(typeof request.enabled === 'boolean' ? { enabled: request.enabled } : {}),
    ...(typeof request.force === 'boolean' ? { force: request.force } : {}),
  };
}

function isSelectorSettingsPage(sender: chrome.runtime.MessageSender): boolean {
  if (!isTrustedExtensionPageSender(sender) || !sender.url) return false;
  if (sender.frameId !== undefined && sender.frameId !== 0) return false;
  try {
    const page = new URL(sender.url);
    page.search = '';
    page.hash = '';
    return [
      chrome.runtime.getURL('src/pages/popup/index.html'),
      chrome.runtime.getURL('src/pages/options/index.html'),
    ].includes(page.href);
  } catch {
    return false;
  }
}

export async function handleGeminiSelectorMessage(
  message: unknown,
  sender: chrome.runtime.MessageSender,
  owner: SelectorOwner,
  resolveTab: ResolveTab = (tabId) => chrome.tabs.get(tabId),
): Promise<GeminiSelectorResponse> {
  const request = readRequest(message);
  if (!request) return { ok: false, error: 'invalid-request' };
  if (isSelectorSettingsPage(sender)) {
    // Withdrawing consent and reading it must work from any tab; only ON and checks need Gemini.
    const needsGeminiTab =
      request.type === GEMINI_SELECTOR_REFRESH_MESSAGE ||
      (request.type === GEMINI_SELECTOR_SET_ENABLED_MESSAGE && request.enabled === true);
    if (!needsGeminiTab) return dispatch(request, owner);
    if (request.tabId === undefined) return { ok: false, error: 'forbidden' };
    try {
      const tab = await resolveTab(request.tabId);
      if (geminiSelectorHostFromUrl(tab.url) !== request.host) {
        return { ok: false, error: 'forbidden' };
      }
    } catch {
      return { ok: false, error: 'forbidden' };
    }
  } else {
    // Content can request only its own automatic check, never consent or manual bypass.
    if (
      sender.id !== chrome.runtime.id ||
      (sender.frameId !== undefined && sender.frameId !== 0) ||
      request.type !== GEMINI_SELECTOR_REFRESH_MESSAGE ||
      request.force === true ||
      request.tabId !== undefined ||
      geminiSelectorHostFromUrl(getSenderPageUrl(sender)) !== request.host ||
      (sender.url !== undefined && geminiSelectorHostFromUrl(sender.url) !== request.host)
    ) {
      return { ok: false, error: 'forbidden' };
    }
  }
  return dispatch(request, owner);
}

function dispatch(request: SelectorRequest, owner: SelectorOwner): Promise<GeminiSelectorResponse> {
  if (request.type === GEMINI_SELECTOR_STATUS_MESSAGE) return owner.status(request.host);
  if (request.type === GEMINI_SELECTOR_SET_ENABLED_MESSAGE) {
    return owner.setEnabled(request.host, request.enabled === true);
  }
  return owner.refresh(request.host, { force: request.force === true });
}

/** Register separately: the ordinary plugin message allowlist intentionally stays unchanged. */
export function startGeminiSelectorBackgroundService(
  owner: BackgroundOwner = new GeminiSelectorRefresher(),
): () => void {
  const clearUnlessEnabled = () => {
    void owner.clearCachesUnlessEnabled().catch((error: unknown) => {
      logger.warn('Gemini selector caches could not be cleared', { error: String(error) });
    });
  };
  const onMessage = (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response: GeminiSelectorResponse) => void,
  ): true | undefined => {
    if (!isGeminiSelectorMessage(message)) return undefined;
    void handleGeminiSelectorMessage(message, sender, owner)
      .then(sendResponse)
      .catch((error: unknown) => {
        logger.warn('Gemini selector message failed', { error: String(error) });
        sendResponse({ ok: false, error: 'storage' });
      });
    return true;
  };
  const onStorage = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => {
    const consent = changes[StorageKeys.GEMINI_SELECTOR_ONLINE_FIXES];
    if (area !== 'local' || !consent || consent.newValue === true) return;
    clearUnlessEnabled();
  };
  chrome.runtime.onMessage.addListener(onMessage);
  chrome.storage.onChanged.addListener(onStorage);
  // OFF saves consent before deleting caches; a worker that died in between left them behind.
  clearUnlessEnabled();
  return () => {
    chrome.runtime.onMessage.removeListener(onMessage);
    chrome.storage.onChanged.removeListener(onStorage);
    owner.abortAll();
  };
}
