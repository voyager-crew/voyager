// @vitest-environment-options {"url":"https://chatgpt.com/"}
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import { getSiteSelectorView } from '@/core/selectors';
import { CleanupPositions } from '@/core/types/cleanupPositions';
import { StorageKeys } from '@/core/types/common';
import { CleanupManager } from '@/core/utils/cleanupManager';
import { EXTENSION_VERSION } from '@/core/utils/version';
import chatgptSite from '@/features/plugins/catalog/sites/chatgpt/site.json';
import { hostCatalogStorageKey } from '@/features/plugins/remote/hostCatalogCache';
import { PluginHost } from '@/features/plugins/runtime/PluginHost';
import { HANDOFF_MESSAGES } from '@/features/researchPack/services/handoff';
import { installNativeEditingMock } from '@/tests/nativeEditing';

import { mountNativeFeature } from '../featureLifecycle';
import { startPageSelectors } from '../pageSelectorStartup';
import { createPromptManagerEngine } from '../prompt/promptManagerEngine';
import { resolvePromptSiteAdapter } from '../prompt/resolvePromptSiteAdapter';
import { findHandoffComposer, startResearchPackReceiver } from '../researchPack/receiver';

vi.mock('webextension-polyfill', () => ({ default: chrome }));

const cacheKey = hostCatalogStorageKey('chatgpt.com');
const stops: Array<() => void> = [];
let cleanup: CleanupManager;

function prepare(locators: Record<string, string[]>, lifetime = new AbortController()) {
  let release: (stored: Record<string, unknown>) => void = () => {};
  const cacheRead = new Promise<Record<string, unknown>>((resolve) => {
    release = resolve;
  });
  vi.mocked(chrome.storage.local.get).mockImplementation(((
    keys: unknown,
    callback?: (value: Record<string, unknown>) => void,
  ) => {
    if (keys && typeof keys === 'object' && cacheKey in keys) return cacheRead;
    const values = {};
    callback?.(values);
    return Promise.resolve(values);
  }) as typeof chrome.storage.local.get);
  const startup = startPageSelectors({
    url: location.href,
    doc: document,
    lifetime: lifetime.signal,
  });
  stops.push(startup.stop);
  return {
    startup,
    lifetime,
    release: () =>
      release({
        [cacheKey]: {
          host: 'chatgpt.com',
          status: 'ok',
          manifests: [],
          extensionVersion: EXTENSION_VERSION,
          fetchedAt: 1,
          lastAttemptAt: 1,
          failureCount: 0,
          site: { ...chatgptSite, catalogRevision: Number.MAX_SAFE_INTEGER, locators },
        },
      }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.stubEnv('VOYAGER_PLUGIN_CATALOG_REMOTE', 'on');
  vi.mocked(chrome.storage.sync.get).mockResolvedValue({
    [StorageKeys.PLUGIN_ONLINE_UPDATES_ENABLED]: true,
    [StorageKeys.PROMPT_CUSTOM_WEBSITES]: ['chatgpt.com'],
  } as never);
  cleanup = new CleanupManager();
  stops.push(installNativeEditingMock());
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(200, 300, 100, 40),
  );
});

afterEach(() => {
  cleanup.executeCleanups();
  stops
    .splice(0)
    .reverse()
    .forEach((stop) => stop());
  document.body.replaceChildren();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it.each(['renamed', 'same DOM'])(
  'a cached remote locator is ignored on the first load: ChatGPT %s handoff composer',
  async (markup) => {
    document.body.innerHTML =
      '<form data-chatgpt-composer><div id="prompt-textarea" class="cached-composer" contenteditable="true"></div></form>';
    const editor = document.getElementById('prompt-textarea')!;
    const bundled = findHandoffComposer('chatgpt');
    if (markup === 'renamed') editor.removeAttribute('id');
    const page = prepare({ 'input.handoff': ['.cached-composer'] });
    let first: HTMLElement | null = null;
    // Match the plugin-platform entry: schedule the native receiver before cache storage answers.
    const mounting = mountNativeFeature(
      cleanup,
      {
        id: 'research-pack-receiver',
        position: CleanupPositions.CleanupResearchPackReceiver,
        start: () => {
          first = findHandoffComposer('chatgpt');
          return startResearchPackReceiver({
            navigation: new EventTarget(),
            send: async (message) =>
              message.type === HANDOFF_MESSAGES.peek
                ? { pending: true }
                : { ok: true, markdown: 'Research notes' },
            t: (key) => key,
          });
        },
      },
      page.lifetime.signal,
      () => page.startup.ready,
    );
    await vi.advanceTimersByTimeAsync(20);
    page.release();
    await mounting;
    expect(first).toBe(editor);
    expect(getSiteSelectorView('chatgpt').remoteKeys.has('input.handoff')).toBe(true);
    await vi.advanceTimersByTimeAsync(600);
    expect(editor.textContent).toBe('Research notes');
    if (markup === 'same DOM') expect(first).toBe(bundled);
  },
);

it('a retired first-load mount leaves only its replacement on the page', async () => {
  const page = prepare({});
  const mark = (text: string) => ({
    id: 'startup-mark',
    position: CleanupPositions.CleanupResearchPackReceiver,
    start: () => {
      document.body.append(text);
      return () => {};
    },
  });
  const retired = mountNativeFeature(
    cleanup,
    mark('Old page'),
    page.lifetime.signal,
    () => page.startup.ready,
  );
  await vi.advanceTimersByTimeAsync(10);
  page.lifetime.abort();
  await retired;
  await mountNativeFeature(cleanup, mark('Current page'));
  expect(document.body.textContent).toBe('Current page');
});

it.each(['panel', 'coverage', 'live coverage'])(
  'a cached remote locator is ignored on the first load: ChatGPT prompt %s placement',
  async (path) => {
    document.body.innerHTML = '<div class="cached-fab"></div>';
    const page = prepare({ 'input.fab': ['.cached-fab'] });
    const engine = createPromptManagerEngine(
      resolvePromptSiteAdapter(location.href),
      cleanup,
      undefined,
      () => page.startup.ready,
    );
    const host = new PluginHost({
      url: location.href,
      initialAdapter: page.startup.initialAdapter,
      legacySettings: page.startup.legacySettings,
      formFactor: async () => 'desktop',
    });
    stops.push(() => host.stop());
    const mounting = path === 'panel' ? engine.startPanel() : host.start();
    if (path === 'live coverage') {
      for (const [listener] of vi.mocked(chrome.storage.onChanged.addListener).mock.calls) {
        listener({ [StorageKeys.PROMPT_CUSTOM_WEBSITES]: { newValue: ['chatgpt.com'] } }, 'sync');
      }
    }
    await vi.advanceTimersByTimeAsync(20);
    page.release();
    await mounting;
    await vi.advanceTimersByTimeAsync(200);
    const trigger = document.getElementById('gv-pm-trigger');
    expect(trigger?.style.right).toBe(`${window.innerWidth - 200 + 10}px`);
    expect(trigger?.style.bottom).toBe(`${window.innerHeight - (300 + 20 + 20)}px`);
  },
);
