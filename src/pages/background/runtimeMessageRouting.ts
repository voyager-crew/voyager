import type { SyncPlatform } from '@/core/types/sync';
import {
  FOLDER_PLATFORMS,
  getFolderPlatformForHost,
  isFolderPlatform,
} from '@/features/folder/platforms';
import {
  CHATGPT_HANDOFF_CANCEL_EXPIRY_MESSAGE,
  CHATGPT_HANDOFF_GET_TAB_ID_MESSAGE,
  CHATGPT_HANDOFF_SCHEDULE_EXPIRY_MESSAGE,
} from '@/features/plugins/builtin/chatgptTemporaryHandoff/storage';
import {
  PLUGIN_CATALOG_REFRESH_MESSAGE,
  PLUGIN_SET_SETTING_MESSAGE,
  PLUGIN_CONTENT_SCRIPT_SYNC_MESSAGE,
} from '@/features/plugins/runtime/messages';
import { LIBRARY_OPEN_MESSAGE } from '@/features/savedLibrary/openLibraryPage';
import { SEND_TIME_RECORD_MESSAGE } from '@/features/timeline/adapters/catalog/sendTimesMessages';

function parseHttpsUrl(rawUrl: string | undefined): URL | null {
  if (!rawUrl) return null;
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function isAllowedSyncContentSender(
  senderPageUrl: string | undefined,
  platform: SyncPlatform,
): boolean {
  const parsed = parseHttpsUrl(senderPageUrl);
  if (!parsed) return false;
  return FOLDER_PLATFORMS[platform].hosts.some((host) => host === parsed.hostname);
}

export function isTrustedExtensionPageSender(sender: chrome.runtime.MessageSender): boolean {
  if (sender.id !== chrome.runtime.id || typeof sender.url !== 'string') return false;
  try {
    const origin = chrome.runtime.getURL('');
    // Pages opened as tabs (Library, options fallback) carry a tab; a web page framing ours does not pass.
    return sender.url.startsWith(origin) && (!sender.tab || !!sender.tab.url?.startsWith(origin));
  } catch {
    return false;
  }
}

/**
 * An extension page, or this extension's content script on a page of `platform`. Safari and
 * Firefox can omit the tab URL, so the page is read through `getSenderPageUrl`; content scripts
 * run only in the top frame, so a sender reporting a subframe is refused.
 */
export function isTrustedSyncMessageSender(
  sender: chrome.runtime.MessageSender,
  platform: SyncPlatform,
): boolean {
  if (isTrustedExtensionPageSender(sender)) return true;
  if (sender.id !== chrome.runtime.id) return false;
  if (sender.frameId !== undefined && sender.frameId !== 0) return false;
  return isAllowedSyncContentSender(getSenderPageUrl(sender), platform);
}

/**
 * Folder sync platform requested by a `gv.sync.upload` / `gv.sync.download` payload. A missing
 * value keeps the historical Gemini default; any unknown value is rejected instead of falling
 * back to Gemini's folder bucket.
 */
export function parseSyncPlatform(value: unknown): SyncPlatform | null {
  if (value === undefined || value === null || value === '') return 'gemini';
  return isFolderPlatform(value) ? value : null;
}

/**
 * The page a sync request came from: the tab URL, or the frame URL when a browser omits the tab
 * URL (Firefox/Safari without tab access), so a web page cannot pass as an extension page.
 */
export function getSenderPageUrl(sender: {
  tab?: { url?: string };
  url?: string;
}): string | undefined {
  return sender.tab?.url || sender.url;
}

/**
 * A web page may only sync the folder platform it belongs to, so a ChatGPT/Claude/DeepSeek tab can
 * never read Gemini or AI Studio folders through the background. Extension pages (popup, options
 * fallback) have no web page URL and keep their access; their tab is checked by the popup.
 */
export function canSenderPageUseSyncPlatform(
  senderPageUrl: string | undefined,
  platform: SyncPlatform,
): boolean {
  if (!senderPageUrl) return true;
  let parsed: URL;
  try {
    parsed = new URL(senderPageUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return true;
  return getFolderPlatformForHost(parsed.hostname) === platform;
}

const HANDLED_BACKGROUND_MESSAGE_TYPES = new Set([
  LIBRARY_OPEN_MESSAGE,
  'gv.fetchImage',
  'gv.fetchImageViaPage',
  'gv.generatedUi.ensureCapturePermission',
  'gv.generatedUi.captureVisibleTab',
  PLUGIN_CONTENT_SCRIPT_SYNC_MESSAGE,
  PLUGIN_CATALOG_REFRESH_MESSAGE,
  PLUGIN_SET_SETTING_MESSAGE,
  CHATGPT_HANDOFF_SCHEDULE_EXPIRY_MESSAGE,
  CHATGPT_HANDOFF_CANCEL_EXPIRY_MESSAGE,
  CHATGPT_HANDOFF_GET_TAB_ID_MESSAGE,
  'gv.account.resolve',
  SEND_TIME_RECORD_MESSAGE,
  'gv.responseComplete.notify',
  'gv.responseComplete.requestNativePermission',
  'gv.clipboard.copyImagePng',
  'gv.remoteAnnouncement.getPending',
  'gv.remoteAnnouncement.ack',
  'gv.remoteAnnouncement.dismiss',
  'gv.highlight.listAll',
  'gv.highlight.list',
  'gv.highlight.create',
  'gv.highlight.update',
  'gv.highlight.updateStored',
  'gv.highlight.delete',
  'gv.highlight.deleteStored',
  'gv.highlight.export',
  'gv.highlight.import',
  'gv.highlight.clearAll',
  'gv.highlight.clearAllAccounts',
  'gv.starred.add',
  'gv.starred.backfillTexts',
  'gv.starred.remove',
  'gv.starred.getAll',
  'gv.starred.getForConversation',
  'gv.starred.isStarred',
  'gv.starred.reconcileConversationIds',
  'gv.starred.mergeCloud',
  'gv.starred.mergeSync',
  'gv.fork.add',
  'gv.fork.remove',
  'gv.fork.getAll',
  'gv.fork.mergeCloud',
  'gv.fork.getForConversation',
  'gv.fork.getGroup',
  'gv.sync.authenticate',
  'gv.sync.signOut',
  'gv.sync.upload',
  'gv.sync.download',
  'gv.sync.pullPromptsMerge',
  'gv.sync.pushPromptsMerge',
  'gv.sync.getState',
  'gv.sync.setMode',
  'gv.sync.setProvider',
  'gv.openPopup',
  'gv.syncToIDE',
  'gv.checkSyncStatus',
]);

export function isHandledBackgroundRuntimeMessage(message: unknown): boolean {
  if (!message || typeof message !== 'object') return false;
  const type = (message as { type?: unknown }).type;
  return typeof type === 'string' && HANDLED_BACKGROUND_MESSAGE_TYPES.has(type);
}
