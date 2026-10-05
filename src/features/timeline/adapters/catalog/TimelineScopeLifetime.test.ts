import './testSetup';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type MemoryStorage,
  createMemoryStorage,
} from '@/features/plugins/builtin/chatgptFolders/__tests__/memoryStorage';
import { requireBundledSiteAdapter } from '@/features/plugins/catalog/sites';
import { PluginScope } from '@/features/plugins/runtime/pluginScope';
import type { PluginSettings } from '@/features/plugins/types';
import { turnNavigatorPrimitive } from '@/features/plugins/verbs/turnNavigator';
import type { PrimitiveHandle } from '@/features/plugins/verbs/types';
import { showTimelineStyleCoachmark } from '@/features/timeline/timelineStyleCoachmark';

vi.mock('@/utils/i18n', () => ({
  initI18n: vi.fn().mockResolvedValue(undefined),
  getTranslationSync: (key: string) => key,
}));
vi.mock('@/features/timeline/timelineStyleCoachmark', () => ({
  showTimelineStyleCoachmark: vi.fn().mockResolvedValue(undefined),
}));

const scopes: PluginScope[] = [];
let releaseRead: (() => void) | null;
let storage: MemoryStorage;

async function flush(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

beforeEach(() => {
  history.replaceState({}, '', '/c/one');
  document.body.innerHTML =
    '<main data-conversation-id="one"><div data-user-message-bubble>Prompt</div></main>';
  releaseRead = null;
  storage = createMemoryStorage();
  vi.stubGlobal('chrome', {
    ...chrome,
    storage: { ...chrome.storage, local: storage.api.local, onChanged: storage.api.onChanged },
  });
  let firstRead = true;
  vi.mocked(chrome.runtime.sendMessage).mockImplementation(((
    request: { type: string },
    callback: (value: unknown) => void,
  ) => {
    if (request.type === 'gv.starred.getForConversation') {
      const respond = () => callback({ ok: true, messages: [] });
      if (firstRead) {
        firstRead = false;
        releaseRead = respond;
      } else respond();
    }
  }) as typeof chrome.runtime.sendMessage);
});

afterEach(async () => {
  releaseRead?.();
  for (const scope of scopes.splice(0)) await scope.dispose();
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

function enable(settings: PluginSettings = {}): PluginScope {
  return activate(settings).scope;
}

function activate(settings: PluginSettings = {}) {
  const scope = new PluginScope();
  scopes.push(scope);
  const handle = turnNavigatorPrimitive.activate(
    scope,
    {},
    {
      doc: document,
      adapter: requireBundledSiteAdapter('chatgpt'),
      pluginId: 'voyager.chatgpt-timeline',
      settings,
      setTargetCounter: () => {},
    },
  );
  // The timeline activates synchronously and returns its settings handle.
  return { scope, handle: handle as PrimitiveHandle };
}

describe('timeline scope lifetime', () => {
  it('late cleanup cannot remove a re-enabled rail while the first library read is pending', async () => {
    const oldScope = enable();
    await flush();
    const oldRail = document.querySelector('.gemini-timeline-bar');
    expect(oldRail).not.toBeNull();
    expect(releaseRead).not.toBeNull();

    const disposal = oldScope.dispose();
    expect(oldRail?.isConnected).toBe(false);
    const newScope = enable();
    await flush();
    const newRail = document.querySelector('.gemini-timeline-bar');
    expect(newRail).not.toBeNull();
    expect(newRail).not.toBe(oldRail);
    expect(newRail?.querySelectorAll('.timeline-dot')).toHaveLength(1);

    releaseRead?.();
    await disposal;
    await flush();
    expect(newScope.isDisposed).toBe(false);
    expect(document.querySelector('.gemini-timeline-bar')).toBe(newRail);
    expect(newRail?.isConnected).toBe(true);
  });
});

describe('timeline marker levels', () => {
  it('a ChatGPT marker opens no level menu until the experimental setting is turned on', async () => {
    const scope = enable();
    await flush();
    releaseRead?.();
    await vi.waitFor(() => expect(document.querySelector('.timeline-dot')).not.toBeNull());
    const rightClick = () =>
      document
        .querySelector('.timeline-dot')!
        .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, button: 2 }));
    rightClick();
    expect(document.querySelector('.timeline-context-menu [data-level]')).toBeNull();

    await scope.dispose();
    enable({ markerLevel: true });
    await vi.waitFor(() => expect(document.querySelector('.timeline-dot')).not.toBeNull());
    rightClick();
    expect(document.querySelector('.timeline-context-menu [data-level="2"]')).not.toBeNull();
  });
});

describe('timeline marker levels outside the dots style', () => {
  it('a ChatGPT compact or ruler timeline with node levels on offers no level menu and renders flat', async () => {
    vi.mocked(showTimelineStyleCoachmark).mockClear();
    const { handle } = activate({ timelineStyle: 'dots', markerLevel: true });
    await flush();
    releaseRead?.();
    await vi.waitFor(() => expect(document.querySelector('.timeline-dot')).not.toBeNull());
    const dot = () => document.querySelector<HTMLElement>('.timeline-dot')!;
    const levelMenuItem = (level: number) => {
      dot().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, button: 2 }));
      return document.querySelector<HTMLButtonElement>(
        `.timeline-context-menu [data-level="${level}"]`,
      );
    };
    levelMenuItem(2)!.click();
    await flush();
    expect(dot().dataset.level).toBe('2');
    // The compact guide would switch the style away from dots.
    expect(showTimelineStyleCoachmark).not.toHaveBeenCalled();

    for (const timelineStyle of ['compact', 'ruler']) {
      handle.updateSettings!({ timelineStyle, markerLevel: true });
      await flush();
      expect(dot().dataset.level).toBe('1');
      expect(levelMenuItem(2)).toBeNull();
    }

    handle.updateSettings!({ timelineStyle: 'dots', markerLevel: true });
    await flush();
    expect(dot().dataset.level).toBe('2');
    expect(levelMenuItem(3)).not.toBeNull();
  });
});

describe('timeline startup outline', () => {
  it('editing a level while the Library read is delayed preserves saved chapters and collapse state', async () => {
    const { buildTurnId } = await import('./turnMerge');
    const key = 'gvCatalogTimelineHierarchy:chatgpt';
    const conversationId = 'chatgpt:conv:one';
    const heading = buildTurnId('Saved heading');
    const child = buildTurnId('Saved child');
    const outline = () =>
      (storage.values.local.get(key) as { conversations: Record<string, unknown> }).conversations[
        conversationId
      ];
    storage.values.local.set(key, {
      conversations: {
        [conversationId]: {
          conversationUrl: `${location.origin}/c/one`,
          levels: { [child]: 2 },
          collapsed: [heading],
          updatedAt: 1,
        },
      },
    });
    enable({ markerLevel: true });
    await flush();
    document
      .querySelector('main')!
      .insertAdjacentHTML(
        'beforeend',
        '<div data-user-message-bubble>Saved heading</div><div data-user-message-bubble>Saved child</div>',
      );
    await vi.waitFor(() => expect(document.querySelector('.timeline-dot')).not.toBeNull());
    expect(releaseRead).not.toBeNull();
    document
      .querySelector('.timeline-dot')!
      .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, button: 2 }));
    document.querySelector<HTMLButtonElement>('.timeline-context-menu [data-level="3"]')!.click();
    await flush();
    expect(outline()).toMatchObject({
      levels: { [child]: 2, [buildTurnId('Prompt')]: 3 },
      collapsed: [heading],
    });
    releaseRead?.();
    await flush();
    expect(outline()).toMatchObject({
      levels: { [child]: 2, [buildTurnId('Prompt')]: 3 },
      collapsed: [heading],
    });
  });
});

describe('one timeline per page', () => {
  const counts = () =>
    Object.fromEntries(
      [
        'style[data-gv-timeline]',
        '.gemini-timeline-bar',
        '.timeline-left-slider',
        '.timeline-preview-toggle',
        '.timeline-preview-panel',
        '.timeline-preview-search',
        '.gv-timeline-preview-hover-bridge',
        '.timeline-tooltip',
      ].map((selector) => [selector, document.querySelectorAll(selector).length]),
    );
  const single = {
    'style[data-gv-timeline]': 1,
    '.gemini-timeline-bar': 1,
    '.timeline-left-slider': 1,
    '.timeline-preview-toggle': 1,
    '.timeline-preview-panel': 1,
    '.timeline-preview-search': 1,
    '.gv-timeline-preview-hover-bridge': 1,
    '.timeline-tooltip': 1,
  };

  it('a ChatGPT conversation shows one timeline preview panel when an earlier Voyager copy left its rail behind', async () => {
    // An extension reload orphans the old content script without tearing it
    // down; the re-injected copy then mounts its own timeline on the same page.
    enable({ timelineStyle: 'compact' });
    await flush();
    releaseRead?.();
    await vi.waitFor(() => expect(document.querySelector('.timeline-dot')).not.toBeNull());

    enable({ timelineStyle: 'ruler' });
    await flush();
    await vi.waitFor(() => expect(document.querySelector('.timeline-dot')).not.toBeNull());

    expect(counts()).toEqual(single);
    expect(document.querySelector('.timeline-preview-panel-compact')).toBeNull();
    expect(
      document.querySelector('.gemini-timeline-bar')?.classList.contains('gv-timeline-style-ruler'),
    ).toBe(true);
  });

  it('navigating between ChatGPT chats keeps a single preview panel', async () => {
    enable();
    await flush();
    releaseRead?.();
    await vi.waitFor(() => expect(document.querySelector('.timeline-dot')).not.toBeNull());

    for (const id of ['two', 'three', 'one']) {
      history.pushState({}, '', `/c/${id}`);
      document.querySelector('main')!.dataset.conversationId = id;
      window.dispatchEvent(new PopStateEvent('popstate'));
      await flush();
      await vi.waitFor(() => expect(document.querySelector('.timeline-dot')).not.toBeNull());
      expect(counts()).toEqual(single);
    }
  });
});
