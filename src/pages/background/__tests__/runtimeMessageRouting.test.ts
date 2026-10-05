import { describe, expect, it } from 'vitest';

import {
  MAX_RUNTIME_IMAGE_BYTES,
  isAllowedRuntimeImageBody,
  parseAllowedRuntimeImageUrl,
} from '@/core/utils/runtimeImageFetch';
import {
  CHATGPT_HANDOFF_CANCEL_EXPIRY_MESSAGE,
  CHATGPT_HANDOFF_GET_TAB_ID_MESSAGE,
  CHATGPT_HANDOFF_SCHEDULE_EXPIRY_MESSAGE,
} from '@/features/plugins/builtin/chatgptTemporaryHandoff/storage';
import {
  PLUGIN_CATALOG_REFRESH_MESSAGE,
  PLUGIN_CONTENT_SCRIPT_SYNC_MESSAGE,
} from '@/features/plugins/runtime/messages';

import {
  getSenderPageUrl,
  isAllowedSyncContentSender,
  isHandledBackgroundRuntimeMessage,
  isTrustedExtensionPageSender,
  isTrustedSharedDataSyncSender,
  isTrustedSyncMessageSender,
  parseSyncPlatform,
} from '../runtimeMessageRouting';

const EXTENSION_ID = 'test-extension-id';
const contentSender = (url: string): chrome.runtime.MessageSender => ({
  id: EXTENSION_ID,
  url,
  tab: { id: 7, url } as chrome.tabs.Tab,
});

describe('background runtime message routing', () => {
  it('keeps the async channel open only for exact handled message types', () => {
    expect(isHandledBackgroundRuntimeMessage({ type: 'gv.account.resolve' })).toBe(true);
    expect(isHandledBackgroundRuntimeMessage({ type: 'gv.highlight.list' })).toBe(true);
    expect(isHandledBackgroundRuntimeMessage({ type: 'gv.sync.upload' })).toBe(true);
    expect(isHandledBackgroundRuntimeMessage({ type: PLUGIN_CONTENT_SCRIPT_SYNC_MESSAGE })).toBe(
      true,
    );
    expect(isHandledBackgroundRuntimeMessage({ type: PLUGIN_CATALOG_REFRESH_MESSAGE })).toBe(true);
    expect(
      isHandledBackgroundRuntimeMessage({ type: CHATGPT_HANDOFF_SCHEDULE_EXPIRY_MESSAGE }),
    ).toBe(true);
    expect(isHandledBackgroundRuntimeMessage({ type: CHATGPT_HANDOFF_CANCEL_EXPIRY_MESSAGE })).toBe(
      true,
    );
    expect(isHandledBackgroundRuntimeMessage({ type: CHATGPT_HANDOFF_GET_TAB_ID_MESSAGE })).toBe(
      true,
    );

    expect(isHandledBackgroundRuntimeMessage({ type: 'gv.highlight.unknown' })).toBe(false);
    expect(isHandledBackgroundRuntimeMessage({ type: 'gv.storageQuota.ready' })).toBe(false);
    expect(isHandledBackgroundRuntimeMessage({ type: 'gv.unhandled' })).toBe(false);
    expect(isHandledBackgroundRuntimeMessage(null)).toBe(false);
  });

  it('allows only bounded images from media hosts or the sender origin', () => {
    expect(
      parseAllowedRuntimeImageUrl(
        'https://lh3.googleusercontent.com/private/image.png',
        'https://gemini.google.com/app',
      )?.hostname,
    ).toBe('lh3.googleusercontent.com');
    expect(
      parseAllowedRuntimeImageUrl(
        'https://gemini.google.com/local/image.png',
        'https://gemini.google.com/app',
      )?.pathname,
    ).toBe('/local/image.png');

    expect(
      parseAllowedRuntimeImageUrl(
        'https://evil-googleusercontent.com/private',
        'https://gemini.google.com/app',
      ),
    ).toBeNull();
    expect(
      parseAllowedRuntimeImageUrl(
        'http://lh3.googleusercontent.com/private',
        'https://gemini.google.com/app',
      ),
    ).toBeNull();
    expect(
      parseAllowedRuntimeImageUrl(
        'https://accounts.google.com/private',
        'https://gemini.google.com/app',
      ),
    ).toBeNull();

    expect(isAllowedRuntimeImageBody('image/png', MAX_RUNTIME_IMAGE_BYTES)).toBe(true);
    expect(isAllowedRuntimeImageBody('text/html', 100)).toBe(false);
    expect(isAllowedRuntimeImageBody('image/png', MAX_RUNTIME_IMAGE_BYTES + 1)).toBe(false);
  });

  it('accepts sync content messages only from the matching product host', () => {
    expect(isAllowedSyncContentSender('https://gemini.google.com/app', 'gemini')).toBe(true);
    expect(isAllowedSyncContentSender('https://business.gemini.google/app', 'gemini')).toBe(true);
    expect(isAllowedSyncContentSender('https://aistudio.google.com/app', 'aistudio')).toBe(true);
    expect(isAllowedSyncContentSender('https://aistudio.google.cn/app', 'aistudio')).toBe(true);
    expect(isAllowedSyncContentSender('https://chatgpt.com/c/1', 'chatgpt')).toBe(true);
    expect(isAllowedSyncContentSender('https://gemini.google.com/app', 'chatgpt')).toBe(false);
    expect(isAllowedSyncContentSender('https://chatgpt.com.evil.test/c/1', 'chatgpt')).toBe(false);

    expect(isAllowedSyncContentSender('https://example.com/app', 'gemini')).toBe(false);
    expect(isAllowedSyncContentSender('https://gemini.google.com/app', 'aistudio')).toBe(false);
    expect(isAllowedSyncContentSender('http://gemini.google.com/app', 'gemini')).toBe(false);
    expect(isAllowedSyncContentSender('https://chatgpt.com/c/1', 'gemini')).toBe(false);
    expect(isAllowedSyncContentSender('https://claude.ai/chat/1', 'aistudio')).toBe(false);
  });

  it('rejects unknown sync platforms instead of falling back to Gemini folders', () => {
    expect(parseSyncPlatform(undefined)).toBe('gemini');
    expect(parseSyncPlatform('gemini')).toBe('gemini');
    expect(parseSyncPlatform('aistudio')).toBe('aistudio');
    expect(parseSyncPlatform('chatgpt')).toBe('chatgpt');
    expect(parseSyncPlatform('__proto__')).toBeNull();
    expect(parseSyncPlatform({ platform: 'gemini' })).toBeNull();
  });

  it('keeps ChatGPT, Claude and DeepSeek tabs away from Gemini and AI Studio folder sync', () => {
    for (const url of [
      'https://chatgpt.com/c/1',
      'https://claude.ai/chat/1',
      'https://chat.deepseek.com/a/chat/s/1',
    ]) {
      for (const platform of ['gemini', 'aistudio'] as const) {
        expect(isTrustedSyncMessageSender(contentSender(url), platform), url).toBe(false);
      }
      expect(isTrustedSharedDataSyncSender(contentSender(url)), url).toBe(false);
    }
  });

  it('trusts the Library page opened in its own tab but not when a website frames it', () => {
    const library = `chrome-extension://${EXTENSION_ID}/src/pages/library/index.html`;
    expect(isTrustedExtensionPageSender({ id: EXTENSION_ID, url: library })).toBe(true);
    expect(
      isTrustedExtensionPageSender({
        id: EXTENSION_ID,
        url: library,
        tab: { id: 3, url: library } as chrome.tabs.Tab,
      }),
    ).toBe(true);
    expect(
      isTrustedExtensionPageSender({
        id: EXTENSION_ID,
        url: library,
        tab: { id: 3, url: 'https://example.com/' } as chrome.tabs.Tab,
      }),
    ).toBe(false);
    expect(isTrustedExtensionPageSender(contentSender('https://gemini.google.com/app'))).toBe(
      false,
    );
  });

  it('keeps folder sync available to native tabs and extension pages', () => {
    const popup: chrome.runtime.MessageSender = {
      id: EXTENSION_ID,
      url: `chrome-extension://${EXTENSION_ID}/src/pages/popup/index.html`,
    };
    expect(isTrustedSyncMessageSender(popup, 'gemini')).toBe(true);
    expect(isTrustedSyncMessageSender(popup, 'aistudio')).toBe(true);
    expect(isTrustedSyncMessageSender(popup, 'chatgpt')).toBe(true);
    expect(isTrustedSyncMessageSender(contentSender('https://chatgpt.com/c/1'), 'chatgpt')).toBe(
      true,
    );
    expect(
      isTrustedSyncMessageSender(contentSender('https://gemini.google.com/app'), 'gemini'),
    ).toBe(true);
    expect(
      isTrustedSyncMessageSender(contentSender('https://aistudio.google.com/prompts'), 'aistudio'),
    ).toBe(true);
    expect(
      isTrustedSyncMessageSender(
        { ...contentSender('https://gemini.google.com/app'), id: 'other-extension' },
        'gemini',
      ),
    ).toBe(false);

    // Options-page fallback runs the popup inside an extension tab.
    const options = `chrome-extension://${EXTENSION_ID}/src/pages/options/index.html?sourceTabId=4`;
    const optionsTab = { id: EXTENSION_ID, url: options, tab: { id: 4, url: options } };
    expect(isTrustedSyncMessageSender(optionsTab as chrome.runtime.MessageSender, 'aistudio')).toBe(
      true,
    );
    expect(isTrustedSharedDataSyncSender(popup)).toBe(true);
    expect(
      isTrustedSyncMessageSender(contentSender('https://gemini.google.com/u/1/app'), 'gemini'),
    ).toBe(true);
    expect(
      isTrustedSyncMessageSender(contentSender('https://aistudio.google.cn/prompts'), 'aistudio'),
    ).toBe(true);
    expect(isTrustedSharedDataSyncSender(contentSender('https://aistudio.google.cn/prompts'))).toBe(
      true,
    );
    expect(
      isTrustedSyncMessageSender(contentSender('https://gemini.google.com/app'), 'aistudio'),
    ).toBe(false);
  });

  it('accepts a Safari folder upload from a content script whose tab URL is omitted', () => {
    // Safari and Firefox can report only the sending frame's URL.
    const topFrame = (url: string): chrome.runtime.MessageSender => ({
      id: EXTENSION_ID,
      url,
      frameId: 0,
      tab: { id: 7 } as chrome.tabs.Tab,
    });
    expect(isTrustedSyncMessageSender(topFrame('https://chatgpt.com/c/1'), 'chatgpt')).toBe(true);
    expect(isTrustedSyncMessageSender(topFrame('https://gemini.google.com/app'), 'gemini')).toBe(
      true,
    );
    expect(isTrustedSyncMessageSender(topFrame('https://chatgpt.com/c/1'), 'gemini')).toBe(false);
    // Content scripts run only in the top frame: a subframe never passes as the page.
    expect(
      isTrustedSyncMessageSender(
        { ...topFrame('https://gemini.google.com/app'), frameId: 3 },
        'gemini',
      ),
    ).toBe(false);
  });

  it('checks the frame URL when the browser omits the tab URL', () => {
    const chatgpt = {
      id: EXTENSION_ID,
      tab: {} as chrome.tabs.Tab,
      url: 'https://chatgpt.com/c/abc',
    };
    expect(getSenderPageUrl(chatgpt)).toBe('https://chatgpt.com/c/abc');
    expect(isTrustedSyncMessageSender(chatgpt, 'gemini')).toBe(false);
    const popup = { id: EXTENSION_ID, url: `chrome-extension://${EXTENSION_ID}/popup.html` };
    expect(isTrustedSyncMessageSender(popup, 'gemini')).toBe(true);
    expect(getSenderPageUrl({ tab: { url: 'https://gemini.google.com/app' }, url: 'x' })).toBe(
      'https://gemini.google.com/app',
    );
  });
});
