// Deliberately without './testSetup': it replaces the shortcut service this file is about.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { keyboardShortcutService } from '@/core/services/KeyboardShortcutService';
import { requireBundledSiteAdapter } from '@/features/plugins/catalog/sites';
import { PluginScope } from '@/features/plugins/runtime/pluginScope';
import { turnNavigatorPrimitive } from '@/features/plugins/verbs/turnNavigator';
import { type MemoryStorage, createMemoryStorage } from '@/tests/memoryStorage';

import { routeCatalogOutlineWrites } from '../../__tests__/catalogOutlineBackground';

vi.mock('@/utils/i18n', () => ({
  onCachedLanguageChange: () => () => {},
  initI18n: vi.fn().mockResolvedValue(undefined),
  getTranslationSync: (key: string) => key,
}));
vi.mock('@/features/timeline/timelineStyleCoachmark', () => ({
  showTimelineStyleCoachmark: vi.fn().mockResolvedValue(undefined),
}));

let storage: MemoryStorage;

function press(key: string): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  window.dispatchEvent(event);
  return event;
}

function enableChatGptTimeline(): PluginScope {
  const scope = new PluginScope();
  turnNavigatorPrimitive.activate(
    scope,
    {},
    {
      doc: document,
      adapter: requireBundledSiteAdapter('chatgpt'),
      pluginId: 'voyager.chatgpt-timeline',
      settings: {},
      setTargetCounter: () => {},
    },
  );
  return scope;
}

beforeEach(() => {
  localStorage.clear();
  keyboardShortcutService.destroy();
  history.replaceState({}, '', '/c/one');
  document.body.innerHTML =
    '<main data-conversation-id="one"><div data-user-message-bubble>Prompt</div>' +
    '<div data-user-message-bubble>Second prompt</div></main>';
  storage = createMemoryStorage();
  vi.stubGlobal('chrome', {
    ...chrome,
    storage: {
      ...chrome.storage,
      local: storage.api.local,
      onChanged: storage.api.onChanged,
    },
  });
  vi.mocked(chrome.storage.sync.get).mockImplementation(((
    keys: unknown,
    callback?: (values: Record<string, unknown>) => void,
  ) => {
    const values =
      typeof keys === 'object' && keys !== null && !Array.isArray(keys)
        ? (keys as Record<string, unknown>)
        : {};
    callback?.(values);
    return Promise.resolve(values);
  }) as typeof chrome.storage.sync.get);
  vi.mocked(chrome.runtime.sendMessage).mockImplementation(
    routeCatalogOutlineWrites((request: { type: string }, callback) => {
      if (request.type === 'gv.starred.getForConversation') callback({ ok: true, messages: [] });
    }) as typeof chrome.runtime.sendMessage,
  );
});

afterEach(() => {
  keyboardShortcutService.destroy();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('catalogTimeline', () => {
  it('returns j and k to the page after the catalog timeline is disabled', async () => {
    const scope = enableChatGptTimeline();
    await vi.waitFor(() => expect(document.querySelectorAll('.timeline-dot')).toHaveLength(2));
    await vi.waitFor(() => expect(press('j').defaultPrevented).toBe(true));

    await scope.dispose();

    expect(press('j').defaultPrevented).toBe(false);
    expect(press('k').defaultPrevented).toBe(false);
  });
});
