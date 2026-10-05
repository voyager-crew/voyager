import '@/features/timeline/adapters/catalog/testSetup';
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildConversationId } from '@/features/timeline/adapters/catalog/conversationId';

import { BUILTIN_PLUGINS } from '../builtin';
import deepseekTimeline from '../catalog/sites/deepseek/plugins/timeline/plugin.json';
import { validateManifest } from '../manifest/validate';
import { PluginHost } from '../runtime/PluginHost';
import { PluginScope } from '../runtime/pluginScope';
import type { SiteAdapter } from '../types';
import { turnNavigatorPrimitive } from './turnNavigator';
import type { PrimitiveContext } from './types';

const validated = validateManifest({
  ...deepseekTimeline,
  contributes: { ...deepseekTimeline.contributes, styles: [] },
});
if (!validated.success) throw new Error('invalid DeepSeek timeline');
const timelines = [
  ...BUILTIN_PLUGINS.filter((plugin) => plugin.id.endsWith('-timeline')),
  validated.data,
];

describe.each(timelines)('$name saved style', (plugin) => {
  it('keeps an existing compact setting and applies a new ruler choice without remounting', async () => {
    document.body.innerHTML = `
      <div data-user-message-bubble>ChatGPT question</div>
      <div data-testid="user-message">Claude question</div>
      <div class="ds-message"><div class="ds-collapsible-text">DeepSeek question</div></div>`;
    (chrome.storage.local.get as unknown as Mock).mockResolvedValue({
      gvPluginsState: {
        [plugin.id]: { enabled: true, installedAt: 0, settings: { compactView: true } },
      },
    });
    const host = new PluginHost({
      url: plugin.matches[0].replace('*', 'c/first'),
      sources: [{ id: 'test', list: async () => [plugin] }],
      doc: document,
      requestCatalogRefresh: () => {},
    });
    try {
      await host.start();
      await flush();
      const bar = document.querySelector('[data-gv-turn-navigator]');
      expect(bar).not.toBeNull();
      expect(bar?.classList.contains('timeline-style-compact')).toBe(true);
      expect(showTimelineStyleCoachmark).not.toHaveBeenCalled();

      const state = {
        [plugin.id]: {
          enabled: true,
          installedAt: 0,
          settings: { compactView: true, timelineStyle: 'ruler' },
        },
      };
      for (const [listener] of vi.mocked(chrome.storage.onChanged.addListener).mock.calls) {
        listener({ gvPluginsState: { newValue: state } }, 'local');
      }
      await flush();
      expect(document.querySelector('[data-gv-turn-navigator]')).toBe(bar);
      expect(bar?.classList.contains('gv-timeline-style-ruler')).toBe(true);
      expect(bar?.classList.contains('timeline-style-compact')).toBe(false);
    } finally {
      host.stop();
      vi.mocked(chrome.storage.local.get).mockReset();
      vi.mocked(chrome.storage.onChanged.addListener).mockClear();
    }
  });
});

const { getStarredMessagesForConversation, showTimelineStyleCoachmark } = vi.hoisted(() => ({
  getStarredMessagesForConversation: vi.fn().mockResolvedValue([]),
  showTimelineStyleCoachmark: vi.fn().mockResolvedValue(undefined),
}));

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
    addStarredMessage: vi.fn().mockResolvedValue(undefined),
    getStarredMessagesForConversation,
    removeStarredMessage: vi.fn().mockResolvedValue(undefined),
  },
}));
vi.mock('@/features/plugins/storage/pluginSettingRequest', () => ({
  requestPluginSetting: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/features/timeline/timelineStyleCoachmark', () => ({
  showTimelineStyleCoachmark,
}));

const deepseek: SiteAdapter = {
  id: 'deepseek',
  label: 'DeepSeek',
  matches: ['https://chat.deepseek.com/*'],
  selectors: { userTurn: '.ds-user' },
  theme: { hostSelector: 'body', lightSelector: 'body.light', darkSelector: 'body.dark' },
  capabilities: new Set(['chat']),
  conversationIdPattern: '^/a/chat/s/([^/?#]+)',
};

function context(adapter: SiteAdapter | null, settings = {}) {
  const counters: Array<() => number> = [];
  const ctx: PrimitiveContext = {
    doc: document,
    adapter,
    pluginId: 'voyager.deepseek-timeline',
    settings,
    setTargetCounter: (count) => counters.push(count),
  };
  return { ctx, counters };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
}

beforeEach(() => {
  document.body.innerHTML = '';
  history.replaceState({}, '', '/a/chat/s/abc123');
  getStarredMessagesForConversation.mockClear();
  showTimelineStyleCoachmark.mockClear();
  window.scrollTo = vi.fn();
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('turnNavigator primitive', () => {
  it('validates selectors, the id pattern and the rail side', () => {
    expect(turnNavigatorPrimitive.validateParams(undefined)).toEqual({ success: true, data: {} });
    expect(
      turnNavigatorPrimitive.validateParams({
        turn: '.t',
        conversationIdPattern: '^/c/(\\w+)',
        scrollContainer: '.scroll',
        yieldWhen: '.panel',
        position: 'left',
        conversationIdAttribute: 'data-conv-id',
        turnItem: '[data-turn-key]',
      }),
    ).toEqual({
      success: true,
      data: {
        conversationIdAttribute: 'data-conv-id',
        turnItem: '[data-turn-key]',
        turn: '.t',
        conversationIdPattern: '^/c/(\\w+)',
        scrollContainer: '.scroll',
        yieldWhen: '.panel',
        position: 'left',
      },
    });
    const issues = (raw: unknown) => {
      const result = turnNavigatorPrimitive.validateParams(raw);
      return result.success ? [] : result.error.map((issue) => issue.path);
    };
    expect(issues({ position: 'top' })).toEqual(['params.position']);
    expect(issues({ conversationIdPattern: '(' })).toEqual(['params.conversationIdPattern']);
    // Remote data must not hand the content thread a backtracking bomb.
    expect(issues({ conversationIdPattern: '^/(a+)+$' })).toEqual(['params.conversationIdPattern']);
    expect(issues({ conversationIdPattern: '^/(a|aa)+$' })).toEqual([
      'params.conversationIdPattern',
    ]);
    expect(issues({ conversationIdPattern: '^/((a+))+$' })).toEqual([
      'params.conversationIdPattern',
    ]);
    expect(issues({ conversationIdPattern: '^/(?=x)(.*)' })).toEqual([
      'params.conversationIdPattern',
    ]);
    expect(issues({ turn: '' })).toEqual(['params.turn']);
    // conversationIdAttribute is interpolated into `[name]`: an attribute name, nothing more.
    expect(issues({ conversationIdAttribute: 'data-x] , *' })).toEqual([
      'params.conversationIdAttribute',
    ]);
    expect(issues({ conversationIdAttribute: 'Data-Upper' })).toEqual([
      'params.conversationIdAttribute',
    ]);
    expect(issues({ conversationIdAttribute: 42 })).toEqual(['params.conversationIdAttribute']);
    expect(issues({ turnKey: 'data-turn-id-container' })).toEqual(['params.turnKey']);
    expect(issues({ speed: 3 })).toEqual(['params.speed']);
  });

  it('namespaces conversation ids by site so stars never mix', () => {
    expect(
      buildConversationId(
        { siteId: deepseek.id, conversationIdPattern: deepseek.conversationIdPattern },
        'https://chat.deepseek.com/a/chat/s/abc123',
      ),
    ).toBe('deepseek:conv:abc123');
    expect(
      buildConversationId(
        { siteId: 'claude', conversationIdPattern: '^/chat/([^/?#]+)' },
        'https://claude.ai/chat/xyz',
      ),
    ).toBe('claude:conv:xyz');
    expect(buildConversationId({ siteId: 'deepseek' }, 'https://chat.deepseek.com/')).toMatch(
      /^deepseek:[0-9a-z]+$/i,
    );
  });

  it('accepts account attribute lists and refuses malformed names or values before activation', () => {
    const attributes = ['data-user-id', 'data-workspace-id'];
    expect(turnNavigatorPrimitive.validateParams({ accountIdAttributes: attributes })).toEqual({
      success: true,
      data: { accountIdAttributes: attributes },
    });
    for (const value of ['data-user-id', ['Data-Upper'], ['data-user-id', 42], [''], null]) {
      const result = turnNavigatorPrimitive.validateParams({ accountIdAttributes: value });
      expect(result.success).toBe(false);
      if (!result.success)
        expect(result.error.map((issue) => issue.path)).toEqual(['params.accountIdAttributes']);
    }
  });

  it("mounts the rail for the adapter's turns, loads stars under the site prefix and updates in place", async () => {
    document.body.innerHTML = '<div class="ds-user">first</div><div class="ds-user">second</div>';
    const scope = new PluginScope();
    const { ctx, counters } = context(deepseek);

    const handle = turnNavigatorPrimitive.activate(scope, { position: 'left' }, ctx);
    await flush();

    const bar = document.querySelector<HTMLElement>('[data-gv-turn-navigator="deepseek"]');
    expect(bar).not.toBeNull();
    expect(bar?.dataset.gvPosition).toBe('left');
    expect(bar?.style.left).toBe('15px');
    expect(document.querySelectorAll('.timeline-dot')).toHaveLength(2);
    expect(getStarredMessagesForConversation).toHaveBeenCalledWith('deepseek:conv:abc123');
    expect(counters[0]()).toBe(2);

    expect(handle && typeof handle === 'object' && 'updateSettings' in handle).toBe(true);
    (handle as { updateSettings: (s: Record<string, boolean>) => void }).updateSettings({
      compactView: true,
    });
    expect(bar?.classList.contains('timeline-style-compact')).toBe(true);

    await scope.dispose();
    expect(document.querySelector('[data-gv-turn-navigator]')).toBeNull();
    expect(document.querySelectorAll('[data-gv-turn-id]')).toHaveLength(0);
  });

  it('stays inert without a turn selector', () => {
    const scope = new PluginScope();
    const { ctx, counters } = context(null);
    expect(turnNavigatorPrimitive.activate(scope, {}, ctx)).toBeUndefined();
    expect(counters[0]()).toBe(0);
    expect(document.querySelector('[data-gv-turn-navigator]')).toBeNull();
  });
});
