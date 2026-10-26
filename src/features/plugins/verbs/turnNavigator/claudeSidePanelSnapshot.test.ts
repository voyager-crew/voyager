// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://claude.ai/chat/current" }
import '@/features/timeline/adapters/catalog/testSetup';
import { afterEach, expect, it, vi } from 'vitest';

import { initializeSiteSelectors } from '@/core/selectors';
import { PluginScope } from '@/features/plugins/runtime/pluginScope';
import { claudeAdapter } from '@/features/plugins/sites/adapters/claude';

import { turnNavigatorPrimitive } from './index';

const { showTimelineStyleCoachmark } = vi.hoisted(() => ({
  showTimelineStyleCoachmark: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/features/timeline/timelineStyleCoachmark', () => ({ showTimelineStyleCoachmark }));
vi.mock('@/utils/i18n', () => ({
  initI18n: vi.fn().mockResolvedValue(undefined),
  getTranslationSync: (key: string) => key,
}));
vi.mock('@/features/savedLibrary/StarredMessagesService', async (importOriginal) => ({
  StarredMessagesService: {
    backfillStarredTexts: vi.fn().mockResolvedValue(undefined),
    getStarredMessagesForConversation: vi.fn().mockResolvedValue([]),
    decodeStorageChange: (
      await importOriginal<typeof import('@/features/savedLibrary/StarredMessagesService')>()
    ).StarredMessagesService.decodeStorageChange,
  },
}));
const stops: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const stop of stops.splice(0).reverse()) await stop();
  document.body.replaceChildren();
  vi.clearAllMocks();
});

async function startTimeline(remote: boolean) {
  if (remote) {
    const lifetime = new AbortController();
    const run = initializeSiteSelectors('claude', {
      host: 'claude.ai',
      doc: document,
      lifetime: lifetime.signal,
      bundledRevision: 0,
      read: async () => ({ id: 'claude', catalogRevision: 1, selectors: { sidePanel: 'iframe' } }),
    });
    await run.ready;
    stops.push(run.stop);
  }
  window.scrollTo = vi.fn();
  const scope = new PluginScope();
  stops.push(() => scope.dispose());
  await turnNavigatorPrimitive.activate(
    scope,
    {},
    {
      doc: document,
      // Even a later adapter reload cannot redefine the installed artifact-origin predicate.
      adapter: remote
        ? { ...claudeAdapter, selectors: { ...claudeAdapter.selectors, sidePanel: 'iframe' } }
        : claudeAdapter,
      pluginId: 'voyager.claude-timeline',
      settings: {},
      setTargetCounter: () => {},
    },
  );
  for (let index = 0; index < 30; index += 1) await Promise.resolve();
}

it.each([false, true])(
  'an unrelated frame does not suppress the Claude timeline guide with remote=%s',
  async (remote) => {
    document.body.innerHTML =
      '<div data-testid="user-message">Question</div><iframe src="https://example.com/widget"></iframe>';
    await startTimeline(remote);
    expect(document.querySelector('[data-gv-turn-navigator]')).not.toBeNull();
    expect(showTimelineStyleCoachmark).toHaveBeenCalledTimes(1);
  },
);

it.each([false, true])(
  'the Claude artifact frame keeps the timeline guide out of its way with remote=%s',
  async (remote) => {
    document.body.innerHTML =
      '<div data-testid="user-message">Question</div><iframe src="https://artifact.frame.claudeusercontent.com/preview"></iframe>';
    await startTimeline(remote);
    expect(document.querySelector('[data-gv-turn-navigator]')).not.toBeNull();
    expect(showTimelineStyleCoachmark).not.toHaveBeenCalled();
  },
);
