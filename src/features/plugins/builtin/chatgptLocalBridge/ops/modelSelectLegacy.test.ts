// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://chatgpt.com/" }
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getSiteBundledRevision } from '@/core/selectors/bundle';
import { StorageKeys } from '@/core/types/common';
import { EXTENSION_VERSION } from '@/core/utils/version';
import chatgptSite from '@/features/plugins/catalog/sites/chatgpt/site.json';
import { hostCatalogStorageKey } from '@/features/plugins/remote/hostCatalogCache';
import { startPageSelectors } from '@/pages/content/pageSelectorStartup';

import { mountChatGptPage } from '../__tests__/chatgptPageFixture';
import { type Harness, createHarness, errorCode } from '../__tests__/harness';
import { mountLiveModelPicker } from '../__tests__/liveModelPicker';

vi.mock('@/utils/i18n', () => ({ getCurrentLanguage: vi.fn(async () => 'en') }));

let bridge: Harness | undefined;
let stop: (() => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv('VOYAGER_PLUGIN_CATALOG_REMOTE', 'on');
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});

afterEach(() => {
  stop?.();
  stop = undefined;
  const running = bridge?.runtime.runningTaskId;
  if (running) bridge?.runtime.abort(running);
  bridge = undefined;
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  document.body.replaceChildren();
});

async function runWithCachedHook(hook: 'trigger' | 'effort', online: boolean) {
  const page = mountChatGptPage();
  const picker = mountLiveModelPicker(page.form, {
    effort: 1,
    marked: hook !== 'trigger',
    triggerLabel: hook === 'trigger' ? 'Nicht bekannte Beschriftung' : undefined,
    sliderRendered: hook !== 'effort',
  });
  if (hook === 'trigger') picker.trigger.setAttribute('data-cached-picker', 'true');
  else {
    picker.trigger.addEventListener('pointerup', () => {
      const menu = document.getElementById(picker.trigger.getAttribute('aria-controls')!);
      const row = menu?.querySelector('[data-reasoning-slider]');
      row?.setAttribute('data-cached-effort', 'true');
      row?.removeAttribute('data-reasoning-slider');
      row?.removeAttribute('aria-keyshortcuts');
      row?.removeAttribute('role');
    });
  }
  const cached = {
    ...chatgptSite,
    catalogRevision: getSiteBundledRevision() + 1,
    pageHooks: {
      ...chatgptSite.pageHooks,
      ...(hook === 'trigger'
        ? { modelPickerTrigger: '[data-cached-picker]' }
        : { effortControl: '[data-cached-effort]' }),
    },
  };
  vi.mocked(chrome.storage.sync.get).mockResolvedValue({
    [StorageKeys.PLUGIN_ONLINE_UPDATES_ENABLED]: online,
  } as never);
  vi.mocked(chrome.storage.local.get).mockResolvedValue({
    [hostCatalogStorageKey('chatgpt.com')]: {
      host: 'chatgpt.com',
      status: 'ok',
      manifests: [],
      extensionVersion: EXTENSION_VERSION,
      fetchedAt: 10,
      lastAttemptAt: 10,
      failureCount: 0,
      site: cached,
    },
  } as never);
  const startup = startPageSelectors({
    url: 'https://chatgpt.com/',
    doc: document,
    lifetime: new AbortController().signal,
  });
  stop = startup.stop;
  await startup.ready;
  const adapter = await startup.initialAdapter;
  if (!adapter) throw new Error('Expected the cached ChatGPT adapter');
  bridge = createHarness(undefined, adapter);
  bridge.start('model.select', { target: { preset: 'pro' } }, { deadline: Date.now() + 25_000 });
  await vi.advanceTimersByTimeAsync(10_000);
  return { picker, outcome: bridge.outcome() };
}

describe('cached ChatGPT picker hooks with online updates off', () => {
  it.each(['trigger', 'effort'] as const)(
    'still saves Pro when only the cached %s marker identifies its control',
    async (hook) => {
      const { picker, outcome } = await runWithCachedHook(hook, false);
      expect(outcome).toMatchObject({ ok: true, data: { observed: { effortIndex: 4 } } });
      expect(picker.state()).toMatchObject({
        committed: 4,
        open: false,
        pointerdowns: 1,
        keydowns: 3,
      });
    },
  );

  it.each([
    ['trigger', 'selector-missing'],
    ['effort', 'effort-unavailable'],
  ] as const)(
    'requires the native %s proof for the same cached marker when online updates are on',
    async (hook, code) => {
      const { picker, outcome } = await runWithCachedHook(hook, true);
      expect(errorCode(outcome)).toBe(code);
      expect(picker.state()).toMatchObject({
        committed: 1,
        open: false,
        pointerdowns: hook === 'trigger' ? 0 : 1,
        keydowns: 0,
      });
    },
  );
});
