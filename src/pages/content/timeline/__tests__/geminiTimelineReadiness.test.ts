// @vitest-environment-options { "url": "https://gemini.google.com/app/readiness" }
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';

import {
  type ExtensionFake,
  GeminiPage,
  SURFACE,
  dotFor,
  dotLabels,
  hover,
  installExtension,
  installLayout,
  navigateTo,
  settle,
} from './geminiTimelineHarness';
import { mountTimelinePluginOnPage } from './geminiTimelineStartup';

vi.mock('webextension-polyfill', async () =>
  (await import('./geminiTimelineHarness')).polyfillMock(),
);

const TURNS = [
  { prompt: 'Voyager 测试 first question', serverId: 'aaaaaaaaaaaaaaaa' },
  { prompt: 'Voyager 测试 second question', serverId: 'bbbbbbbbbbbbbbbb' },
];
const OTHER_TURNS = [{ prompt: 'Voyager 测试 another chat', serverId: 'cccccccccccccccc' }];
const HIERARCHY = {
  conversations: {
    'gemini:conv:readiness': {
      conversationUrl: 'https://gemini.google.com/app/readiness',
      levels: { 's-bbbbbbbbbbbbbbbb': 2 },
      collapsed: [],
      updatedAt: 17,
    },
  },
};

let ext: ExtensionFake;
let restoreLayout: () => void;
let stopHost: (() => void) | undefined;
let stopHistory: (() => void) | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  vi.resetModules();
  document.body.innerHTML = '';
  localStorage.clear();
  history.replaceState(null, '', '/app/readiness');
  ext = installExtension();
  restoreLayout = installLayout();
  stopHost = undefined;
  stopHistory = undefined;
  ext.seed('sync', {
    [StorageKeys.GV_TIMELINE_ENABLED]: true,
    [StorageKeys.GV_SHOW_MESSAGE_TIMESTAMPS]: false,
    [StorageKeys.TIMELINE_MARKER_LEVEL]: true,
    [StorageKeys.TIMELINE_SCROLL_MODE]: 'jump',
  });
  ext.seed('local', { [StorageKeys.TIMELINE_HIERARCHY]: HIERARCHY });
});

afterEach(async () => {
  stopHost?.();
  stopHistory?.();
  await settle();
  restoreLayout();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

/** Reject one real storage read, leaving both readiness implementations and their callers intact. */
function failReadOnce(key: string): () => boolean {
  const original = chrome.storage.local.get.bind(chrome.storage.local);
  let rejected = false;
  vi.spyOn(chrome.storage.local, 'get').mockImplementation(((
    keys: string | string[] | Record<string, unknown> | null,
    callback?: (items: Record<string, unknown>) => void,
  ) => {
    const requested =
      typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(keys ?? {});
    if (!rejected && requested.includes(key)) {
      rejected = true;
      return Promise.reject(new Error('Transient timestamp cache read failure'));
    }
    return original(keys).then((items) => {
      callback?.(items);
      return items;
    });
  }) as typeof chrome.storage.local.get);
  return () => rejected;
}

describe('official Gemini timeline survives timestamp cache failures', () => {
  it.each([
    ['history identity', StorageKeys.GV_TURN_IDENTITY_CACHE],
    ['message timestamp', StorageKeys.GV_MESSAGE_TIMESTAMPS],
  ])('still renders and navigates after one %s cache read rejects', async (_source, key) => {
    const page = new GeminiPage(TURNS);
    const rejected = failReadOnce(key);
    const { startHistoryTimestampPageService } =
      await import('../../timestamp/historyTimestampPageService');
    stopHistory = startHistoryTimestampPageService();
    // With timestamps off, production does not start the message-label plugin/page service.
    stopHost = await mountTimelinePluginOnPage();
    await settle();

    expect(rejected()).toBe(true);
    expect(document.querySelectorAll(SURFACE.bar)).toHaveLength(1);
    expect(dotLabels()).toEqual(TURNS.map((turn) => turn.prompt));
    expect(dotFor(TURNS[1].prompt).dataset.level).toBe('2');
    expect(document.querySelector('.gv-timestamp')).toBeNull();
    hover(dotFor(TURNS[0].prompt));
    await settle(400);
    expect(document.querySelector(SURFACE.tooltip)?.textContent).toBe(TURNS[0].prompt);
    dotFor(TURNS[0].prompt).click();
    dotFor(TURNS[1].prompt).click();
    await settle();
    expect(page.viewport.scrollTop).toBe(page.topOf(TURNS[1].prompt));

    page.render(OTHER_TURNS);
    await navigateTo('/app/other');
    expect(document.querySelectorAll(SURFACE.bar)).toHaveLength(1);
    expect(dotLabels()).toEqual([OTHER_TURNS[0].prompt]);
    page.render(TURNS);
    await navigateTo('/app/readiness');
    expect(dotFor(TURNS[1].prompt).dataset.level).toBe('2');
    expect(ext.read('local', StorageKeys.TIMELINE_HIERARCHY)).toEqual(HIERARCHY);

    stopHost();
    await settle();
    expect(document.querySelector(SURFACE.bar)).toBeNull();
    const press = new KeyboardEvent('keydown', { key: 'j', bubbles: true, cancelable: true });
    window.dispatchEvent(press);
    expect(press.defaultPrevented).toBe(false);
  });

  it.each(['missing', 'retired'] as const)(
    'does not create a shared data session when the required history page service is %s',
    async (state) => {
      new GeminiPage(TURNS);
      if (state === 'retired') {
        const { startHistoryTimestampPageService } =
          await import('../../timestamp/historyTimestampPageService');
        const stop = startHistoryTimestampPageService();
        stop();
      }
      stopHost = await mountTimelinePluginOnPage();
      await settle();
      expect(document.querySelector(SURFACE.bar)).toBeNull();
      expect(ext.read('local', StorageKeys.TIMELINE_HIERARCHY)).toEqual(HIERARCHY);
    },
  );
});
