// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://claude.ai/chat/current" }
import '@/features/timeline/adapters/catalog/testSetup';
import { afterEach, expect, it, vi } from 'vitest';

import { initializeSiteSelectors } from '@/core/selectors';
import { BUILTIN_PLUGINS } from '@/features/plugins/builtin';
import { PluginScope } from '@/features/plugins/runtime/pluginScope';
import { claudeAdapter } from '@/features/plugins/sites/adapters/claude';

import { turnNavigatorPrimitive } from './index';

const { showTimelineStyleCoachmark } = vi.hoisted(() => ({
  showTimelineStyleCoachmark: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/features/timeline/timelineStyleCoachmark', () => ({ showTimelineStyleCoachmark }));
vi.mock('@/utils/i18n', () => ({
  onCachedLanguageChange: () => () => {},
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

async function startTimeline(
  remote: boolean,
  pluginId = 'voyager.claude-timeline',
  yieldWhen?: string,
) {
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
  const manifest = BUILTIN_PLUGINS.find((plugin) => plugin.id === pluginId);
  const operation = manifest?.contributes.domOps?.find(
    (op) => op.op === 'native' && op.handler === 'turnNavigator',
  );
  const params = turnNavigatorPrimitive.validateParams(
    yieldWhen === undefined ? (operation?.op === 'native' ? operation.params : {}) : { yieldWhen },
  );
  if (!params.success) throw new Error('Invalid timeline parameters');
  await turnNavigatorPrimitive.activate(scope, params.data, {
    doc: document,
    // Cached data stays available to other plugins; this builtin owns its guide policy.
    adapter: remote
      ? { ...claudeAdapter, selectors: { ...claudeAdapter.selectors, sidePanel: 'iframe' } }
      : claudeAdapter,
    pluginId,
    settings: {},
    setTargetCounter: () => {},
  });
  for (let index = 0; index < 30; index += 1) await Promise.resolve();
  return scope;
}

it.each([false, true])(
  'an unrelated frame does not suppress the Claude timeline guide with remote=%s',
  async (remote) => {
    document.body.innerHTML =
      '<div data-testid="user-message">Question</div><iframe src="https://example.com/widget"></iframe>';
    await startTimeline(remote);
    expect(document.querySelector('[data-gv-turn-navigator]')).not.toBeNull();
    expect(showTimelineStyleCoachmark).toHaveBeenCalled();
  },
);

it.each([false, true])(
  'the Claude artifact frame postpones the timeline guide until it closes with remote=%s',
  async (remote) => {
    document.body.innerHTML =
      '<div data-testid="user-message">Question</div><iframe src="https://artifact.frame.claudeusercontent.com/preview"></iframe>';
    const scope = await startTimeline(remote);
    expect(document.querySelector('[data-gv-turn-navigator]')).not.toBeNull();
    expect(showTimelineStyleCoachmark).not.toHaveBeenCalled();
    await scope.dispose();
    document.querySelector('iframe')!.remove();
    await startTimeline(remote);
    expect(showTimelineStyleCoachmark).toHaveBeenCalled();
  },
);

it('a third-party timeline without a yield condition shows its guide beside a cached side panel', async () => {
  document.body.innerHTML =
    '<div data-testid="user-message">Question</div><iframe src="https://example.com/widget"></iframe>';
  await startTimeline(true, 'local.custom-timeline');
  expect(document.querySelector('[data-gv-turn-navigator]')).not.toBeNull();
  expect(showTimelineStyleCoachmark).toHaveBeenCalled();
});

it.each(['voyager.claude-timeline', 'local.custom-timeline'])(
  '%s postpones its guide only while its explicit yield condition matches',
  async (pluginId) => {
    document.body.innerHTML =
      '<div data-testid="user-message">Question</div><aside id="custom-panel">Panel</aside>';
    const scope = await startTimeline(true, pluginId, '#custom-panel');
    expect(showTimelineStyleCoachmark).not.toHaveBeenCalled();
    await scope.dispose();
    document.getElementById('custom-panel')!.remove();
    await startTimeline(true, pluginId, '#custom-panel');
    expect(showTimelineStyleCoachmark).toHaveBeenCalled();
  },
);
