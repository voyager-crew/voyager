import '@/features/timeline/adapters/catalog/testSetup';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { loadChatGptStarHashes } from '@/features/savedLibrary/exportStars';
import type { StarredMessage } from '@/features/savedLibrary/starTypes';
import { extractTurnHash } from '@/features/timeline/adapters/catalog/turnHash';

import { requireBundledSiteAdapter } from '../catalog/sites';
import { PluginScope } from '../runtime/pluginScope';
import type { SiteAdapter } from '../types';
import { turnNavigatorPrimitive } from './turnNavigator';
import type { PrimitiveContext } from './types';

const { library, addStarredMessage, getStarredMessagesForConversation } = vi.hoisted(() => {
  const library = new Map<string, StarredMessage[]>();
  return {
    library,
    addStarredMessage: vi.fn(async (message: StarredMessage) => {
      library.set(message.conversationId, [
        ...(library.get(message.conversationId) ?? []),
        message,
      ]);
    }),
    getStarredMessagesForConversation: vi.fn(async (conversationId: string) => [
      ...(library.get(conversationId) ?? []),
    ]),
  };
});

vi.mock('@/utils/i18n', () => ({
  initI18n: vi.fn().mockResolvedValue(undefined),
  getTranslationSync: (key: string) => key,
}));
vi.mock('@/features/savedLibrary/StarredMessagesService', async (importOriginal) => ({
  StarredMessagesService: {
    backfillStarredTexts: vi.fn().mockResolvedValue(undefined),
    decodeStorageChange: (
      await importOriginal<typeof import('@/features/savedLibrary/StarredMessagesService')>()
    ).StarredMessagesService.decodeStorageChange,
    addStarredMessage,
    getStarredMessagesForConversation,
    removeStarredMessage: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('@/features/plugins/storage/pluginSettingRequest', () => ({
  requestPluginSetting: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/features/timeline/timelineStyleCoachmark', () => ({
  showTimelineStyleCoachmark: vi.fn().mockResolvedValue(undefined),
}));

function context(adapter: SiteAdapter | null): PrimitiveContext {
  return {
    doc: document,
    adapter,
    pluginId: 'test.timeline',
    settings: {},
    setTargetCounter: () => {},
  };
}

let scope: PluginScope;

async function settle(ms = 700): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
}

beforeEach(() => {
  vi.useFakeTimers();
  scope = new PluginScope();
  library.clear();
  addStarredMessage.mockClear();
  getStarredMessagesForConversation.mockClear();
  document.body.innerHTML = '';
  window.scrollTo = vi.fn();
});

afterEach(async () => {
  await scope.dispose();
  document.body.innerHTML = '';
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe('turnNavigator star namespace', () => {
  it("export's starred-only filter finds a star filed under a manifest id pattern", async () => {
    history.replaceState({}, '', '/c/abc123');
    document.body.innerHTML = '<div data-user-message-bubble>Keep this prompt</div>';
    // A manifest pattern that captures more of the path than ChatGPT's site.json does.
    turnNavigatorPrimitive.activate(
      scope,
      { conversationIdPattern: '^/(c/[^/?#]+)' },
      context(requireBundledSiteAdapter('chatgpt')),
    );
    await settle();
    document
      .querySelector('.timeline-dot')!
      .dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await settle();
    const [star] = addStarredMessage.mock.calls.map(([message]) => message);
    expect(star).toBeDefined();

    const exported = await loadChatGptStarHashes(location.href);

    expect(exported).toContain(extractTurnHash(star.turnId));
  });

  it('a timeline on a site without an adapter stars nothing rather than share a namespace', async () => {
    history.replaceState({}, '', '/thread/1');
    document.body.innerHTML = '<div class="t">First prompt</div><div class="t">Second</div>';

    turnNavigatorPrimitive.activate(scope, { turn: '.t' }, context(null));
    await settle();
    document
      .querySelector('.timeline-dot')
      ?.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await settle();

    expect(addStarredMessage).not.toHaveBeenCalled();
    expect(getStarredMessagesForConversation).not.toHaveBeenCalled();
    expect(
      vi
        .mocked(chrome.storage.local.set)
        .mock.calls.some(([items]) => Object.keys(items).some((key) => key.endsWith(':site'))),
    ).toBe(false);
  });
});
