import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { EXTENSION_VERSION } from '@/core/utils/version';
import { hostCatalogStorageKey } from '@/features/plugins/remote/hostCatalogCache';
import {
  PLUGIN_CATALOG_REFRESH_MESSAGE,
  PLUGIN_CONTENT_SCRIPT_SYNC_MESSAGE,
  PLUGIN_SET_SETTING_MESSAGE,
} from '@/features/plugins/runtime/messages';
import { resolvePluginSettings } from '@/features/plugins/runtime/resolvePluginSettings';
import { BuiltinPluginSource } from '@/features/plugins/sources/BuiltinPluginSource';
import { BundledCatalogPluginSource } from '@/features/plugins/sources/BundledCatalogPluginSource';
import {
  isDeclaredPluginSetting,
  requestPluginSetting,
} from '@/features/plugins/storage/pluginSettingRequest';
import { loadPluginState, setPluginEnabled } from '@/features/plugins/storage/pluginState';
import type { PluginManifest } from '@/features/plugins/types';

import { handlePluginRuntimeMessage } from '../pluginRuntimeMessages';
import { isHandledBackgroundRuntimeMessage } from '../runtimeMessageRouting';

const STATE = StorageKeys.PLUGINS_STATE;
const CLAUDE = 'https://claude.ai/chat/1';
let memory: Record<string, unknown>;

const timeline: PluginManifest = {
  id: 'voyager.claude-timeline',
  name: 'Timeline',
  version: '1.0.0',
  description: 'd',
  author: 'a',
  category: 'navigation',
  license: 'MIT',
  engine: '>=1.0.0',
  tier: 'declarative',
  matches: ['https://claude.ai/*'],
  contributes: {
    settings: {
      compactView: { type: 'boolean', label: 'Compact', default: false },
      width: { type: 'number', label: 'Width', default: 40, min: 20, max: 80 },
      mode: {
        type: 'select',
        label: 'Mode',
        default: 'a',
        options: [
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ],
      },
    },
  },
};

function deps(manifests: readonly PluginManifest[] = [timeline]) {
  return {
    syncContentScripts: vi.fn().mockResolvedValue(undefined),
    refreshCatalog: vi.fn().mockResolvedValue({ ok: true, status: 'unchanged' }),
    findPluginManifest: vi.fn(async (id: string) => manifests.find((m) => m.id === id)),
  };
}

function contentSender(url = CLAUDE, id = 'test-extension-id'): chrome.runtime.MessageSender {
  return { id, url, tab: { id: 7, url } as chrome.tabs.Tab };
}

function setSetting(payload: unknown) {
  return { type: PLUGIN_SET_SETTING_MESSAGE, payload };
}

beforeEach(() => {
  memory = {};
  (chrome.runtime as { id: string }).id = 'test-extension-id';
  (chrome.storage.local.get as unknown as Mock).mockImplementation(
    async (defaults: Record<string, unknown>) => {
      const out: Record<string, unknown> = {};
      for (const [key, fallback] of Object.entries(defaults)) {
        out[key] = key in memory ? structuredClone(memory[key]) : fallback;
      }
      return out;
    },
  );
  (chrome.storage.local.set as unknown as Mock).mockImplementation(
    async (items: Record<string, unknown>) => {
      Object.assign(memory, structuredClone(items));
    },
  );
});

afterEach(() => {
  (chrome.storage.local.get as unknown as Mock).mockReset();
  (chrome.storage.local.set as unknown as Mock).mockReset();
});

describe('plugin setting writes from content scripts', () => {
  it('sends the setting to the background instead of writing storage itself', async () => {
    const sendMessage = chrome.runtime.sendMessage as unknown as Mock;
    sendMessage.mockResolvedValue({ ok: true });
    await expect(
      requestPluginSetting('voyager.claude-timeline', 'compactView', true),
    ).resolves.toBe(true);
    expect(sendMessage).toHaveBeenCalledWith({
      type: PLUGIN_SET_SETTING_MESSAGE,
      payload: { id: 'voyager.claude-timeline', key: 'compactView', value: true },
    });
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it('reports a write the background refused', async () => {
    (chrome.runtime.sendMessage as unknown as Mock).mockResolvedValue({
      ok: false,
      error: 'write_failed',
    });
    await expect(
      requestPluginSetting('voyager.claude-timeline', 'compactView', true),
    ).resolves.toBe(false);
  });

  it('is a handled background message type', () => {
    expect(isHandledBackgroundRuntimeMessage({ type: PLUGIN_SET_SETTING_MESSAGE })).toBe(true);
  });

  it('stores a declared setting from a page the plugin targets and keeps the enable state', async () => {
    memory[STATE] = {
      'voyager.claude-timeline': { enabled: true, installedAt: 1 },
      'local.me.wide': { enabled: false, installedAt: 2 },
    };
    const d = deps();
    const response = await handlePluginRuntimeMessage(
      setSetting({ id: 'voyager.claude-timeline', key: 'compactView', value: true }),
      contentSender(),
      d,
    );
    expect(response).toEqual({ ok: true });
    expect(d.findPluginManifest).toHaveBeenCalledWith('voyager.claude-timeline', CLAUDE);
    expect(memory[STATE]).toEqual({
      'voyager.claude-timeline': { enabled: true, installedAt: 1, settings: { compactView: true } },
      'local.me.wide': { enabled: false, installedAt: 2 },
    });
  });

  it('never switches a plugin on', async () => {
    memory[STATE] = { 'voyager.claude-timeline': { enabled: false, installedAt: 2 } };
    await handlePluginRuntimeMessage(
      setSetting({ id: 'voyager.claude-timeline', key: 'enabled', value: true }),
      contentSender(),
      deps(),
    );
    const state = memory[STATE] as Record<string, { enabled: boolean }>;
    expect(state['voyager.claude-timeline'].enabled).toBe(false);
  });

  it.each([
    ['another extension', contentSender(CLAUDE, 'other-extension')],
    ['an extension page or worker without a tab', { id: 'test-extension-id' }],
    ['a page the plugin does not target', contentSender('https://chatgpt.com/c/1')],
  ])('refuses a sender that is %s', async (_label, sender) => {
    const response = await handlePluginRuntimeMessage(
      setSetting({ id: 'voyager.claude-timeline', key: 'compactView', value: true }),
      sender as chrome.runtime.MessageSender,
      deps(),
    );
    expect(response).toEqual({ ok: false, error: 'untrusted_sender' });
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it.each([
    null,
    { id: 'voyager.claude-timeline', key: 'compactView' },
    { id: '', key: 'k', value: 1 },
    { id: '__proto__', key: 'k', value: 1 },
    { id: 'voyager.unknown', key: 'compactView', value: true },
    { id: 'voyager.claude-timeline', key: 'undeclared', value: true },
    { id: 'voyager.claude-timeline', key: 'constructor', value: true },
    { id: 'voyager.claude-timeline', key: 'compactView', value: 'yes' },
    { id: 'voyager.claude-timeline', key: 'width', value: 200 },
    { id: 'voyager.claude-timeline', key: 'width', value: Number.NaN },
    { id: 'voyager.claude-timeline', key: 'mode', value: 'c' },
    { id: 'voyager.claude-timeline', key: 'mode', value: { nested: true } },
  ])('rejects a setting the plugin does not declare that way %#', async (payload) => {
    memory[STATE] = { 'voyager.claude-timeline': { enabled: true, installedAt: 1 } };
    const response = await handlePluginRuntimeMessage(setSetting(payload), contentSender(), deps());
    expect(response).toEqual({ ok: false, error: 'invalid_payload' });
    expect(chrome.storage.local.set).not.toHaveBeenCalled();
  });

  it('accepts in-range numbers and declared options', async () => {
    for (const [key, value] of [
      ['width', 60],
      ['mode', 'b'],
    ] as const) {
      const response = await handlePluginRuntimeMessage(
        setSetting({ id: 'voyager.claude-timeline', key, value }),
        contentSender(),
        deps(),
      );
      expect(response).toEqual({ ok: true });
    }
  });

  it('accepts the timeline style choice for every shipped turnNavigator plugin', async () => {
    const shipped = [
      ...(await new BuiltinPluginSource().list()),
      ...(await new BundledCatalogPluginSource().list()),
    ];
    const timelines = shipped.filter((manifest) =>
      (manifest.contributes.domOps ?? []).some(
        (op) => op.op === 'native' && op.handler === 'turnNavigator',
      ),
    );
    expect(timelines.length).toBeGreaterThan(0);
    for (const manifest of timelines) {
      expect(
        isDeclaredPluginSetting(manifest, {
          id: manifest.id,
          key: 'timelineStyle',
          value: 'ruler',
        }),
      ).toBe(true);
    }
  });

  it('reports a failed storage write instead of ok', async () => {
    (chrome.storage.local.set as unknown as Mock).mockRejectedValue(new Error('quota'));
    const response = await handlePluginRuntimeMessage(
      setSetting({ id: 'voyager.claude-timeline', key: 'compactView', value: true }),
      contentSender(),
      deps(),
    );
    expect(response).toEqual({ ok: false, error: 'write_failed' });
  });
});

describe('other plugin background messages', () => {
  it('repairs content-script registration through the serialized sync', async () => {
    const d = deps();
    const response = await handlePluginRuntimeMessage(
      { type: PLUGIN_CONTENT_SCRIPT_SYNC_MESSAGE },
      contentSender(),
      d,
    );
    expect(d.syncContentScripts).toHaveBeenCalledTimes(1);
    expect(response).toEqual({ ok: true });
  });

  it('routes catalog checks through the single refresher', async () => {
    const d = deps();
    const response = await handlePluginRuntimeMessage(
      { type: PLUGIN_CATALOG_REFRESH_MESSAGE, payload: { host: 'claude.ai', force: true } },
      contentSender(),
      d,
    );
    expect(d.refreshCatalog).toHaveBeenCalledWith('claude.ai', true);
    expect(response).toEqual({ ok: true, status: 'unchanged' });
    expect(
      await handlePluginRuntimeMessage(
        { type: PLUGIN_CATALOG_REFRESH_MESSAGE, payload: {} },
        contentSender(),
        d,
      ),
    ).toEqual({ ok: false, error: 'invalid_payload' });
  });

  it('leaves every other message to the caller', () => {
    expect(
      handlePluginRuntimeMessage({ type: 'gv.account.resolve' }, contentSender(), deps()),
    ).toBeNull();
    expect(handlePluginRuntimeMessage(null, contentSender(), deps())).toBeNull();
  });
});

describe('plugin setting writes checked against the real plugin listing', () => {
  const DEEPSEEK = 'https://chat.deepseek.com/a/chat/s/1';

  function deepseekSender(url = DEEPSEEK): chrome.runtime.MessageSender {
    return { id: 'test-extension-id', url, tab: { id: 9, url } as chrome.tabs.Tab };
  }

  /** What the background caches after a successful catalog fetch for `host`. */
  function cacheCatalog(host: string, manifests: readonly PluginManifest[]): void {
    memory[hostCatalogStorageKey(host)] = {
      host,
      status: 'ok',
      manifests,
      fetchedAt: 1,
      lastAttemptAt: 1,
      failureCount: 0,
      extensionVersion: EXTENSION_VERSION,
    };
  }

  async function bundledTimeline(): Promise<PluginManifest> {
    const listed = await new BundledCatalogPluginSource().list();
    const timeline = listed.find((manifest) => manifest.id === 'voyager.deepseek-timeline');
    if (!timeline) throw new Error('bundled deepseek timeline missing');
    return timeline;
  }

  const noFinder = () => ({
    syncContentScripts: vi.fn().mockResolvedValue(undefined),
    refreshCatalog: vi.fn().mockResolvedValue({ ok: true }),
  });

  it('stores the style choice of a timeline plugin only the remote catalog serves', async () => {
    const timeline = await bundledTimeline();
    cacheCatalog('chat.deepseek.com', [
      { ...timeline, id: 'voyager.deepseek-remote-timeline', version: '9.0.0' },
    ]);
    const response = await handlePluginRuntimeMessage(
      setSetting({ id: 'voyager.deepseek-remote-timeline', key: 'timelineStyle', value: 'ruler' }),
      deepseekSender(),
      noFinder(),
    );
    expect(response).toEqual({ ok: true });
  });

  it('an open DeepSeek guide from the previous version still saves Compact', async () => {
    memory[STATE] = { 'voyager.deepseek-timeline': { enabled: true, installedAt: 1 } };
    const response = await handlePluginRuntimeMessage(
      setSetting({ id: 'voyager.deepseek-timeline', key: 'compactView', value: true }),
      deepseekSender(),
      noFinder(),
    );
    expect(response).toEqual({ ok: true });
    expect(memory[STATE]).toEqual({
      'voyager.deepseek-timeline': {
        enabled: true,
        installedAt: 1,
        settings: { timelineStyle: 'compact', compactView: true },
      },
    });
  });

  it('a Compact choice from an old open guide survives turning the plugin off and on before reload', async () => {
    const timeline = await bundledTimeline();
    // The 1.1 manifest the page still runs: a compactView switch, no style select.
    const { timelineStyle: _replaced, ...current } = timeline.contributes.settings!;
    const pinned: PluginManifest = {
      ...timeline,
      contributes: {
        ...timeline.contributes,
        settings: {
          ...current,
          compactView: { type: 'boolean', label: 'Compact', default: false },
        },
      },
    };
    memory[STATE] = {
      'voyager.deepseek-timeline': {
        enabled: true,
        installedAt: 1,
        settings: { compactView: false },
      },
    };
    const response = await handlePluginRuntimeMessage(
      setSetting({ id: 'voyager.deepseek-timeline', key: 'compactView', value: true }),
      deepseekSender(),
      noFinder(),
    );
    expect(response).toEqual({ ok: true });

    await setPluginEnabled('voyager.deepseek-timeline', false);
    await setPluginEnabled('voyager.deepseek-timeline', true);
    const state = await loadPluginState();
    const settings = state['voyager.deepseek-timeline'].settings;
    expect(resolvePluginSettings(pinned, settings).compactView).toBe(true);
    expect(resolvePluginSettings(timeline, settings).timelineStyle).toBe('compact');
  });

  it('an open DeepSeek guide from the previous version switching Compact off saves the default style', async () => {
    const timeline = await bundledTimeline();
    memory[STATE] = {
      'voyager.deepseek-timeline': {
        enabled: true,
        installedAt: 1,
        settings: { timelineStyle: 'compact' },
      },
    };
    const response = await handlePluginRuntimeMessage(
      setSetting({ id: 'voyager.deepseek-timeline', key: 'compactView', value: false }),
      deepseekSender(),
      noFinder(),
    );
    expect(response).toEqual({ ok: true });
    expect(memory[STATE]).toMatchObject({
      'voyager.deepseek-timeline': {
        settings: { timelineStyle: timeline.contributes.settings!.timelineStyle.default },
      },
    });
  });

  it('still refuses an old Compact write when the timeline no longer offers compact', async () => {
    const timeline = await bundledTimeline();
    const style = timeline.contributes.settings!.timelineStyle;
    cacheCatalog('chat.deepseek.com', [
      {
        ...timeline,
        version: '9.0.0',
        contributes: {
          ...timeline.contributes,
          settings: {
            ...timeline.contributes.settings,
            timelineStyle: {
              ...style,
              options: style.options!.filter((option) => option.value !== 'compact'),
            },
          },
        },
      },
    ]);
    const response = await handlePluginRuntimeMessage(
      setSetting({ id: 'voyager.deepseek-timeline', key: 'compactView', value: true }),
      deepseekSender(),
      noFinder(),
    );
    expect(response).toEqual({ ok: false, error: 'invalid_payload' });
  });

  it('validates against the remote-updated settings schema', async () => {
    const timeline = await bundledTimeline();
    cacheCatalog('chat.deepseek.com', [
      {
        ...timeline,
        version: '9.0.0',
        contributes: {
          ...timeline.contributes,
          settings: {
            ...timeline.contributes.settings,
            dense: { type: 'boolean', label: 'Dense', default: false },
          },
        },
      },
    ]);
    const response = await handlePluginRuntimeMessage(
      setSetting({ id: 'voyager.deepseek-timeline', key: 'dense', value: true }),
      deepseekSender(),
      noFinder(),
    );
    expect(response).toEqual({ ok: true });
  });

  it('refuses settings for a remote plugin on Gemini while preserving installed settings', async () => {
    const timeline = await bundledTimeline();
    const gemini = 'https://gemini.google.com/app';
    const installed = { 'local.me.gemini': { enabled: true, installedAt: 1 } };
    memory[STATE] = installed;
    cacheCatalog('gemini.google.com', [
      { ...timeline, id: 'voyager.gemini-remote', matches: ['https://gemini.google.com/*'] },
    ]);
    const response = await handlePluginRuntimeMessage(
      setSetting({ id: 'voyager.gemini-remote', key: 'compactView', value: true }),
      deepseekSender(gemini),
      noFinder(),
    );
    expect(response).toEqual({ ok: false, error: 'invalid_payload' });
    expect(memory[STATE]).toEqual(installed);
  });
});
