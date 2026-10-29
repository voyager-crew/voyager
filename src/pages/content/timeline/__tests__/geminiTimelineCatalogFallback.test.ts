// @vitest-environment-options { "url": "https://gemini.google.com/u/1/app/catalog-fallback" }
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { CleanupManager } from '@/core/utils/cleanupManager';
import type { PluginHost } from '@/features/plugins/runtime/PluginHost';

import {
  type ExtensionFake,
  GeminiPage,
  SURFACE,
  dotFor,
  dotLabels,
  installExtension,
  installLayout,
  navigateTo,
  settle,
} from './geminiTimelineHarness';

vi.mock('webextension-polyfill', async () =>
  (await import('./geminiTimelineHarness')).polyfillMock(),
);

const HOST = 'gemini.google.com';
const CACHE_KEY = `${StorageKeys.PLUGIN_HOST_CATALOG_PREFIX}${HOST}`;
const HIERARCHY_KEY = 'geminiTimelineHierarchy:acct:5d750n';
const TURNS = [
  { prompt: 'Voyager 测试 first question', response: 'First reply', serverId: 'aaaaaaaaaaaaaaaa' },
  {
    prompt: 'Voyager 测试 second question',
    response: 'Second reply',
    serverId: 'bbbbbbbbbbbbbbbb',
  },
];
const LATER = [{ prompt: 'Voyager 测试 another conversation', serverId: 'cccccccccccccccc' }];
type CatalogCase = 'read fails' | 'rejected selectors' | 'unusable selectors' | 'usable selectors';

let ext: ExtensionFake;
let host: PluginHost | null;
let restoreLayout: () => void;
let stops: Array<() => void>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  vi.stubEnv('VOYAGER_PLUGIN_CATALOG_REMOTE', 'on');
  history.replaceState(null, '', '/u/1/app/catalog-fallback');
  document.body.innerHTML = '';
  localStorage.clear();
  ext = installExtension();
  restoreLayout = installLayout();
  host = null;
  stops = [];
  ext.seed('sync', {
    [StorageKeys.GV_TIMELINE_ENABLED]: true,
    [StorageKeys.GV_SHOW_MESSAGE_TIMESTAMPS]: false,
    [StorageKeys.PLUGIN_ONLINE_UPDATES_ENABLED]: true,
    [StorageKeys.TIMELINE_MARKER_LEVEL]: true,
    [StorageKeys.TIMELINE_SCROLL_MODE]: 'jump',
  });
  ext.seed('local', {
    [HIERARCHY_KEY]: {
      conversations: {
        'gemini:conv:catalog-fallback': {
          conversationUrl: location.href,
          levels: { 's-bbbbbbbbbbbbbbbb': 2 },
          collapsed: [],
          updatedAt: 7,
        },
      },
    },
  });
});

afterEach(async () => {
  host?.stop();
  stops.reverse().forEach((stop) => stop());
  await settle();
  restoreLayout();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

/** Follow content startup: validated page selectors, shared adapter read, native admission, PluginHost. */
async function start(kind: CatalogCase): Promise<void> {
  let catalogReadFailed = false;
  const { default: site } = await import('@/features/plugins/catalog/sites/gemini/site.json');
  const { getGeminiBundledRevision } = await import('@/core/gemini/selectors/bundle');
  const { EXTENSION_VERSION } = await import('@/core/utils/version');
  const { startPageSelectors } = await import('../../pageSelectorStartup');
  const { startHistoryTimestampPageService } =
    await import('../../timestamp/historyTimestampPageService');
  const { createOfficialAdmission } = await import('@/features/plugins/runtime/officialAdmission');
  const { PluginHost } = await import('@/features/plugins/runtime/PluginHost');
  const { BuiltinPluginSource } = await import('@/features/plugins/sources/BuiltinPluginSource');
  const { HostCatalogSource } = await import('@/features/plugins/remote/HostCatalogSource');
  const { registerBuiltinNativeHandlers } = await import('../../pluginNativeRegistration');
  const { createGeminiBuiltinStartup } = await import('../../geminiBuiltinStartup');
  const user = kind === 'rejected selectors' ? '[' : '.catalog-user';
  ext.seed('local', {
    [CACHE_KEY]: {
      host: HOST,
      status: 'ok',
      extensionVersion: EXTENSION_VERSION,
      manifests: [],
      fetchedAt: 10,
      lastAttemptAt: 10,
      failureCount: 0,
      site: {
        ...site,
        catalogRevision: getGeminiBundledRevision() + 1,
        locators: { 'turn.user': [user], 'turn.assistant': ['.catalog-assistant'] },
      },
    },
  });
  if (kind === 'read fails') {
    const read = chrome.storage.local.get.bind(chrome.storage.local);
    vi.spyOn(chrome.storage.local, 'get').mockImplementation(((
      keys: string | string[] | Record<string, unknown> | null,
    ) => {
      if (!catalogReadFailed && typeof keys === 'object' && keys !== null && CACHE_KEY in keys) {
        catalogReadFailed = true;
        return Promise.reject(new Error('Catalog cache temporarily unavailable'));
      }
      return read<Record<string, unknown>>(keys);
    }) as typeof chrome.storage.local.get);
  }
  const lifetime = new AbortController();
  const selectors = startPageSelectors({
    url: location.href,
    doc: document,
    lifetime: lifetime.signal,
  });
  stops.push(() => lifetime.abort(), selectors.stop);
  await selectors.ready;
  if (kind === 'read fails') expect(catalogReadFailed).toBe(true);
  stops.push(startHistoryTimestampPageService());
  const cleanup = new CleanupManager();
  const admission = createOfficialAdmission();
  stops.push(registerBuiltinNativeHandlers(), () => cleanup.executeCleanups());
  await createGeminiBuiltinStartup(admission, cleanup).startTimeline();
  admission.close();
  host = new PluginHost({
    url: location.href,
    sources: [new BuiltinPluginSource(), new HostCatalogSource({ enabled: true })],
    initialAdapter: selectors.initialAdapter,
    legacySettings: selectors.legacySettings,
    admission,
    doc: document,
    isTopFrame: true,
    requestCatalogRefresh: () => {},
  });
  await host.start();
  await settle();
}

describe('official Gemini timeline with failed online catalog data', () => {
  it.each(['read fails', 'rejected selectors', 'unusable selectors'] as const)(
    '%s keeps the bundled rail, native hierarchy and navigation across conversation changes',
    async (kind) => {
      const page = new GeminiPage(TURNS);
      const stored = ext.read('local', HIERARCHY_KEY);
      await start(kind);

      expect(document.querySelectorAll(SURFACE.bar)).toHaveLength(1);
      expect(dotLabels()).toEqual(TURNS.map((turn) => turn.prompt));
      expect(dotFor(TURNS[1].prompt).dataset.level).toBe('2');
      dotFor(TURNS[1].prompt).click();
      await settle();
      expect(page.viewport.scrollTop).toBe(page.topOf(TURNS[1].prompt));

      page.render(LATER);
      await navigateTo('/u/1/app/later');
      expect(dotLabels()).toEqual([LATER[0].prompt]);
      page.render(TURNS);
      await navigateTo('/u/1/app/catalog-fallback');
      expect(dotFor(TURNS[1].prompt).dataset.level).toBe('2');
      expect(ext.read('local', HIERARCHY_KEY)).toEqual(stored);

      host!.stop();
      await settle();
      expect(document.querySelector(SURFACE.bar)).toBeNull();
      expect(document.querySelector(SURFACE.previewToggle)).toBeNull();
      expect(document.querySelector(SURFACE.tooltip)).toBeNull();
      expect(ext.read('local', HIERARCHY_KEY)).toEqual(stored);
    },
  );

  it('uses accepted online turns on a renamed page through the same startup and host', async () => {
    const page = new GeminiPage(TURNS);
    for (const [index, container] of Array.from(
      page.viewport.querySelectorAll('.conversation-container'),
    ).entries()) {
      container.innerHTML =
        '<div class="catalog-user"><p class="query-text-line"></p></div>' +
        '<div class="catalog-assistant"><message-content></message-content></div>';
      container.querySelector('.query-text-line')!.textContent = TURNS[index].prompt;
      container.querySelector('message-content')!.textContent = TURNS[index].response;
    }
    await start('usable selectors');

    expect(document.querySelectorAll(SURFACE.bar)).toHaveLength(1);
    expect(dotLabels()).toEqual(TURNS.map((turn) => turn.prompt));
    expect(dotFor(TURNS[1].prompt).dataset.targetTurnId).toBe('s-bbbbbbbbbbbbbbbb');
  });
});
