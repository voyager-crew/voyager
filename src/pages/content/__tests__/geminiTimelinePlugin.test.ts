// @vitest-environment-options { "url": "https://gemini.google.com/app/test" }
import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { CleanupManager } from '@/core/utils/cleanupManager';
import type { PluginHost } from '@/features/plugins/runtime/PluginHost';
import type { PluginScope } from '@/features/plugins/runtime/pluginScope';

import {
  type ExtensionFake,
  GeminiPage,
  SURFACE,
  activeDotLabel,
  dotFor,
  installExtension,
  installLayout,
  settle,
  starredDotLabels,
} from '../timeline/__tests__/geminiTimelineHarness';

vi.mock('webextension-polyfill', async () =>
  (await import('../timeline/__tests__/geminiTimelineHarness')).polyfillMock(),
);

const ID = 'voyager.gemini-timeline';
const CID = 'gemini:conv:test';
const CATALOG_KEY = `${StorageKeys.CATALOG_TIMELINE_HIERARCHY_PREFIX}gemini`;
const FIRST = 'aaaaaaaaaaaaaaaa';
const SECOND = 'bbbbbbbbbbbbbbbb';
const TURNS = [
  { prompt: 'First question', serverId: FIRST },
  { prompt: 'Second question', serverId: SECOND },
  { prompt: 'Third question', serverId: 'cccccccccccccccc' },
];
let ext: ExtensionFake;
let host: PluginHost | null;
let cleanup: CleanupManager;
let coreStops: Array<() => void>;
let scopes: PluginScope[];
let restoreLayout: () => void;

async function flush(): Promise<void> {
  for (let round = 0; round < 60; round++) await Promise.resolve();
}

async function start(): Promise<void> {
  const { createOfficialAdmission } = await import('@/features/plugins/runtime/officialAdmission');
  const { BuiltinPluginSource } = await import('@/features/plugins/sources/BuiltinPluginSource');
  const { PluginHost } = await import('@/features/plugins/runtime/PluginHost');
  const { registerBuiltinNativeHandlers } = await import('../pluginNativeRegistration');
  const { createGeminiBuiltinStartup } = await import('../geminiBuiltinStartup');
  const admission = createOfficialAdmission();
  const startup = createGeminiBuiltinStartup(admission, cleanup);
  registerBuiltinNativeHandlers();
  await startup.startTimeline();
  admission.close();
  host = new PluginHost({
    url: location.href,
    sources: [new BuiltinPluginSource()],
    admission,
    doc: document,
    isTopFrame: true,
    requestCatalogRefresh: () => {},
  });
  await host.start();
  await flush();
}

function flip(value: unknown): void {
  ext.external('sync', { [StorageKeys.GV_TIMELINE_ENABLED]: value });
}

function keyJ(): boolean {
  const event = new KeyboardEvent('keydown', { key: 'j', bubbles: true, cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}

function bytes(): string {
  return JSON.stringify({
    stars: ext.read('local', StorageKeys.SAVED_LIBRARY_STARS),
    hierarchy: ext.read('local', StorageKeys.TIMELINE_HIERARCHY),
    timestamp: ext.read('local', StorageKeys.GV_MESSAGE_TIMESTAMPS),
    catalog: ext.read('local', CATALOG_KEY),
  });
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  history.replaceState({}, '', '/app/test');
  document.body.innerHTML = '';
  localStorage.clear();
  ext = installExtension();
  restoreLayout = installLayout();
  host = null;
  cleanup = new CleanupManager();
  coreStops = [];
  scopes = [];
  ext.seed('sync', {
    [StorageKeys.GV_SHOW_MESSAGE_TIMESTAMPS]: true,
    [StorageKeys.TIMELINE_MARKER_LEVEL]: true,
    geminiTimelineStyle: 'dots',
  });
  ext.seed('local', {
    // Native values win over a stale plugins toggle and catalog-side settings.
    [StorageKeys.PLUGINS_STATE]: {
      [ID]: { enabled: false, installedAt: 1, settings: { timelineStyle: 'compact' } },
    },
    [StorageKeys.GV_MESSAGE_TIMESTAMPS]: {
      version: 2,
      conversations: { [CID]: { [`s-${FIRST}`]: new Date(2024, 0, 1, 0, 0, 1).getTime() } },
    },
    [StorageKeys.SAVED_LIBRARY_STARS]: {
      messages: {
        [CID]: [
          {
            turnId: `s-${SECOND}`,
            content: TURNS[1].prompt,
            conversationId: CID,
            conversationUrl: location.href,
            starredAt: 1,
          },
        ],
      },
    },
    [StorageKeys.TIMELINE_HIERARCHY]: {
      conversations: {
        [CID]: {
          conversationUrl: location.href,
          levels: { [`s-${SECOND}`]: 2 },
          collapsed: [],
          updatedAt: 1,
        },
      },
    },
    [CATALOG_KEY]: {
      conversations: {
        [CID]: {
          conversationUrl: location.href,
          levels: { [`s-${SECOND}`]: 3 },
          collapsed: [],
          updatedAt: 2,
        },
      },
    },
  });
  new GeminiPage(TURNS);
  const historyService = await import('../timestamp/historyTimestampPageService');
  const messageService = await import('../timestamp/messageTimestampPageService');
  coreStops.push(historyService.startHistoryTimestampPageService());
  coreStops.push(messageService.startMessageTimestampPageService());
  await messageService.whenMessageTimestampsReady();
  await flush();
});

afterEach(async () => {
  host?.stop();
  cleanup.executeCleanups();
  for (const scope of scopes) await scope.dispose();
  coreStops.reverse().forEach((stop) => stop());
  await settle();
  restoreLayout();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('Gemini timeline through its registered official plugin', () => {
  it('native data and the default-on switch survive off/reopen without stopping core time', async () => {
    await start();
    await settle();
    const label = document.querySelector('.gv-timestamp');
    expect(label).not.toBeNull();
    expect(document.querySelectorAll(SURFACE.bar)).toHaveLength(1);
    expect(document.querySelector(SURFACE.bar)?.classList).not.toContain('timeline-style-compact');
    expect(starredDotLabels()).toEqual([TURNS[1].prompt]);
    expect(dotFor(TURNS[1].prompt).dataset.level).toBe('2');
    const saved = bytes();
    expect(keyJ()).toBe(true);
    await settle();
    expect(activeDotLabel()).toBe(TURNS[1].prompt);
    flip(false);
    await settle();
    expect(document.querySelector(SURFACE.bar)).toBeNull();
    expect(keyJ()).toBe(false);
    expect(document.querySelector('.gv-timestamp')).toBe(label);
    expect(bytes()).toBe(saved);
    for (const value of [undefined, 'false', 0, true]) {
      flip(value);
      await settle();
      expect(document.querySelectorAll(SURFACE.bar)).toHaveLength(1);
    }
    expect(starredDotLabels()).toEqual([TURNS[1].prompt]);
    expect(dotFor(TURNS[1].prompt).dataset.level).toBe('2');
    expect(document.querySelector('.gv-timestamp')).toBe(label);
    expect(bytes()).toBe(saved);
    const status = host!.getStatuses().find((entry) => entry.id === ID)?.kind;
    expect(status).toBe('mounted');
    host!.stop();
    cleanup.executeCleanups();
    expect(document.querySelector(SURFACE.bar)).toBeNull();
    expect(keyJ()).toBe(false);
    expect(document.querySelector('.gv-timestamp')).toBe(label);
    expect(bytes()).toBe(saved);
  });

  it('off during the initial switch read prevents a late rail from appearing', async () => {
    const get = chrome.storage.sync.get as unknown as Mock;
    const normalGet =
      get.getMockImplementation?.() ?? chrome.storage.sync.get.bind(chrome.storage.sync);
    let finish!: (value: Record<string, unknown>) => void;
    const initial = new Promise<Record<string, unknown>>((resolve) => (finish = resolve));
    let held = false;
    vi.spyOn(chrome.storage.sync, 'get').mockImplementation(((
      keys: unknown,
      callback?: unknown,
    ) => {
      if (!held && Array.isArray(keys) && keys.includes(StorageKeys.GV_TIMELINE_ENABLED)) {
        held = true;
        return initial;
      }
      return normalGet(keys, callback);
    }) as typeof chrome.storage.sync.get);
    await start();
    expect(held).toBe(true);
    flip(false);
    await flush();
    finish({ [StorageKeys.GV_TIMELINE_ENABLED]: true });
    await settle();
    expect(document.querySelector(SURFACE.bar)).toBeNull();
    expect(keyJ()).toBe(false);
    const label = document.querySelector('.gv-timestamp');
    flip(true);
    await settle();
    expect(document.querySelectorAll(SURFACE.bar)).toHaveLength(1);
    expect(document.querySelector('.gv-timestamp')).toBe(label);
  });

  it('disabling the plugin while its engine waits for Gemini DOM leaves core timestamps working', async () => {
    document.querySelector('main')!.remove();
    await flush();
    await start();
    expect(host!.getStatuses().find((entry) => entry.id === ID)?.kind).toBe('mounted');
    expect(document.querySelector(SURFACE.bar)).toBeNull();
    flip(false);
    await flush();
    const page = new GeminiPage(TURNS);
    await settle(5000);
    expect(document.querySelector(SURFACE.bar)).toBeNull();
    expect(keyJ()).toBe(false);
    expect(document.querySelector('.gv-timestamp')?.textContent).toContain('2024-01-01');
    const next = { prompt: 'After late Gemini DOM', serverId: 'dddddddddddddddd' };
    page.append(next);
    await settle();
    expect(document.querySelector(`[data-gv-turn-id="s-${next.serverId}"]`)).not.toBeNull();
    expect(
      ext.read<{ conversations: Record<string, Record<string, number>> }>(
        'local',
        StorageKeys.GV_MESSAGE_TIMESTAMPS,
      )?.conversations[CID]?.[`s-${next.serverId}`],
    ).toBeDefined();
  });

  it('scope abort removes the rail before a slow disposer, and its successor keeps core timestamps', async () => {
    await start();
    await settle();
    host!.stop();
    await flush();
    const { PluginScope } = await import('@/features/plugins/runtime/pluginScope');
    const { activateGeminiTimeline } = await import('../timeline/pluginHandler');
    const old = new PluginScope();
    const newer = new PluginScope();
    scopes.push(old, newer);
    const { geminiAdapter } = await import('@/features/plugins/sites/adapters/gemini');
    activateGeminiTimeline(old, {}, geminiAdapter);
    await settle();
    expect(document.querySelectorAll(SURFACE.bar)).toHaveLength(1);
    const label = document.querySelector('.gv-timestamp');
    let finish!: () => void;
    old.effect(() => () => new Promise<void>((resolve) => (finish = resolve)));
    const stopping = old.dispose();
    try {
      expect(document.querySelector(SURFACE.bar)).toBeNull();
      expect(keyJ()).toBe(false);
      expect(document.querySelector('.gv-timestamp')).toBe(label);
      activateGeminiTimeline(newer, {}, geminiAdapter);
      await settle();
      expect(document.querySelectorAll(SURFACE.bar)).toHaveLength(1);
    } finally {
      finish();
      await stopping;
    }
    expect(document.querySelectorAll(SURFACE.bar)).toHaveLength(1);
    expect(document.querySelector('.gv-timestamp')).toBe(label);
    expect(keyJ()).toBe(true);
    await newer.dispose();
    expect(document.querySelector(SURFACE.bar)).toBeNull();
    expect(keyJ()).toBe(false);
    expect(document.querySelector('.gv-timestamp')).toBe(label);
  });
});
