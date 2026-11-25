import { type Mock, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { BUILTIN_PLUGINS } from '@/features/plugins/builtin';
import { CHATGPT_RESPONSE_NOTIFICATION_MANIFEST } from '@/features/plugins/builtin/chatgptResponseNotification/manifest';
import { importLocalPlugin } from '@/features/plugins/local/localPluginImport';
import { OFFICIAL_PLUGIN_IDS } from '@/features/plugins/sites/featureOwners';
import { BundledCatalogPluginSource } from '@/features/plugins/sources/BundledCatalogPluginSource';
import { listPluginManifestsWithSources } from '@/features/plugins/sources/defaultSources';
import type { PluginManifest } from '@/features/plugins/types';

import { setPluginEnabledWithSiteAccess } from '../pluginEnablement';

const { containsMock, requestMock, browserKind, polyfill } = vi.hoisted(() => {
  const containsMock = vi.fn();
  const requestMock = vi.fn();
  return {
    containsMock,
    requestMock,
    browserKind: { firefox: false, dynamicRegistration: true },
    polyfill: {
      permissions: { contains: containsMock, request: requestMock } as
        | { contains: typeof containsMock; request: typeof requestMock }
        | undefined,
      runtime: { sendMessage: vi.fn().mockResolvedValue({ ok: true }) },
    },
  };
});

vi.mock('webextension-polyfill', () => ({ default: polyfill }));

vi.mock('@/core/utils/browser', () => ({
  getVoyagerBuildTarget: () => (browserKind.firefox ? 'firefox' : 'chrome'),
  isFirefox: () => browserKind.firefox,
  browserSupportsDynamicContentScriptRegistration: () => browserKind.dynamicRegistration,
  // A frame without the permissions API lacks scripting too, as Firefox's panel does.
  supportsDynamicContentScriptRegistration: () =>
    browserKind.dynamicRegistration && polyfill.permissions !== undefined,
}));

const STATE = StorageKeys.PLUGINS_STATE;
const ID = 'local.me.wide-chat';
const CLAUDE = 'https://claude.ai/chat/1';

function authored(css: string): Record<string, unknown> {
  return {
    id: 'me.wide-chat',
    name: 'Wide chat',
    version: '1.0.0',
    description: 'Widen the Claude chat column',
    author: 'Me',
    category: 'layout',
    license: 'MIT',
    engine: '>=1.0.0',
    tier: 'declarative',
    matches: ['https://claude.ai/*'],
    i18n: { zh: { name: '宽聊天', settings: { width: { label: '宽度' } } } },
    contributes: {
      settings: { width: { type: 'number', label: 'Width', default: 60, min: 40, max: 100 } },
      styles: [{ css }],
    },
  };
}

let memory: Record<string, unknown>;

beforeEach(() => {
  memory = {};
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
  containsMock.mockReset();
  requestMock.mockReset();
  browserKind.firefox = false;
  browserKind.dynamicRegistration = true;
  polyfill.permissions = { contains: containsMock, request: requestMock };
});

/** The manifest the popup renders, listed the way `usePopupPlugins` lists it. */
async function shownManifest(): Promise<PluginManifest> {
  const records = await listPluginManifestsWithSources(undefined, {
    url: CLAUDE,
    host: 'claude.ai',
  });
  const record = records.find(({ manifest }) => manifest.id === ID);
  if (!record) throw new Error('local plugin not listed');
  return record.manifest;
}

function enabled(): boolean {
  const state = memory[STATE] as Record<string, { enabled: boolean }> | undefined;
  return state?.[ID]?.enabled === true;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('enabling a local plugin from the popup', () => {
  it('enables the reviewed content', async () => {
    await importLocalPlugin(authored('.gv-wide{max-width:none}'));
    containsMock.mockResolvedValue(true);
    const onChange = vi.fn();
    const outcome = await setPluginEnabledWithSiteAccess(
      await shownManifest(),
      true,
      CLAUDE,
      onChange,
    );
    expect(outcome).toBe('enabled');
    expect(enabled()).toBe(true);
  });

  it('refuses when the same id was re-imported with other content while the enable was pending', async () => {
    await importLocalPlugin(authored('.gv-wide{max-width:none}'));
    const seen = await shownManifest();
    const access = deferred<boolean>();
    containsMock.mockReturnValue(access.promise);
    const onChange = vi.fn();

    const pending = setPluginEnabledWithSiteAccess(seen, true, CLAUDE, onChange);
    // Same version, different CSS: a version check alone would let it through.
    const reimport = await importLocalPlugin(authored('body{display:none}'));
    expect(reimport.ok).toBe(true);
    access.resolve(true);

    expect(await pending).toBe('changed');
    expect(enabled()).toBe(false);
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it('refuses the optimistic enable before the permission prompt when the content changed', async () => {
    await importLocalPlugin(authored('.gv-wide{max-width:none}'));
    const seen = await shownManifest();
    await importLocalPlugin(authored('body{display:none}'));
    containsMock.mockResolvedValue(false);
    const onChange = vi.fn();

    expect(await setPluginEnabledWithSiteAccess(seen, true, CLAUDE, onChange)).toBe('changed');
    expect(requestMock).not.toHaveBeenCalled();
    expect(enabled()).toBe(false);
  });

  it('reports a storage failure as a failed save, not as a re-import', async () => {
    await importLocalPlugin(authored('.gv-wide{max-width:none}'));
    const seen = await shownManifest();
    containsMock.mockResolvedValue(true);
    (chrome.storage.local.set as unknown as Mock).mockRejectedValue(new Error('quota'));
    const onChange = vi.fn();

    expect(await setPluginEnabledWithSiteAccess(seen, true, CLAUDE, onChange)).toBe('write_failed');
    expect(enabled()).toBe(false);
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it('reports a failed optimistic write before the permission prompt without prompting', async () => {
    await importLocalPlugin(authored('.gv-wide{max-width:none}'));
    const seen = await shownManifest();
    containsMock.mockResolvedValue(false);
    (chrome.storage.local.set as unknown as Mock).mockRejectedValue(new Error('quota'));

    expect(await setPluginEnabledWithSiteAccess(seen, true, CLAUDE, vi.fn())).toBe('write_failed');
    expect(requestMock).not.toHaveBeenCalled();
  });
});

describe('a site granted from a plugin switch joins cloud sync', () => {
  const SCOPE = StorageKeys.CLOUD_SYNC_SCOPE;
  beforeEach(() => {
    // Turned off in what syncs before; the scope is read by its key alone.
    memory[SCOPE] = { version: 1, shared: true, sites: { claude: false } };
    (chrome.storage.local.get as unknown as Mock).mockImplementation(async (keys: unknown) =>
      typeof keys === 'string'
        ? keys in memory
          ? { [keys]: structuredClone(memory[keys]) }
          : {}
        : Object.fromEntries(
            Object.entries(keys as Record<string, unknown>).map(([key, fallback]) => [
              key,
              key in memory ? structuredClone(memory[key]) : fallback,
            ]),
          ),
    );
  });
  /** Once the best-effort scope write after the grant has run. */
  const claudeIncluded = async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    return (memory[SCOPE] as { sites: Record<string, boolean> }).sites.claude;
  };

  it.each([
    ['grants access', true, true, false],
    ['refuses access', false, false, false],
    ['grants access in Firefox, asked first', true, true, true],
  ])('puts Claude back in sync only when the browser %s', async (_, grant, included, firefox) => {
    browserKind.firefox = firefox;
    await importLocalPlugin(authored('.gv-wide{max-width:none}'));
    containsMock.mockResolvedValue(false);
    requestMock.mockResolvedValue(grant);

    await setPluginEnabledWithSiteAccess(await shownManifest(), true, CLAUDE, vi.fn());

    expect(requestMock).toHaveBeenCalledOnce();
    expect(await claudeIncluded()).toBe(included);
  });

  it('leaves what syncs alone when the access was already there', async () => {
    await importLocalPlugin(authored('.gv-wide{max-width:none}'));
    containsMock.mockResolvedValue(true);

    await setPluginEnabledWithSiteAccess(await shownManifest(), true, CLAUDE, vi.fn());

    expect(requestMock).not.toHaveBeenCalled();
    expect(await claudeIncluded()).toBe(false);
  });
});

describe('enabling ChatGPT completion notifications from the popup', () => {
  const CHATGPT = 'https://chatgpt.com/c/abc';
  const notificationsOn = (): boolean =>
    (memory[STATE] as Record<string, { enabled: boolean }> | undefined)?.[
      CHATGPT_RESPONSE_NOTIFICATION_MANIFEST.id
    ]?.enabled === true;

  it('asks for the notifications permission even when the site is already granted', async () => {
    containsMock.mockImplementation(
      async (access: { permissions?: string[] }) => !access.permissions,
    );
    requestMock.mockResolvedValue(true);

    const outcome = await setPluginEnabledWithSiteAccess(
      CHATGPT_RESPONSE_NOTIFICATION_MANIFEST,
      true,
      CHATGPT,
      vi.fn(),
    );

    expect(outcome).toBe('enabled');
    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({ permissions: ['notifications'] }),
    );
    expect(notificationsOn()).toBe(true);
  });

  it('stays off when the notifications permission is refused', async () => {
    containsMock.mockImplementation(
      async (access: { permissions?: string[] }) => !access.permissions,
    );
    requestMock.mockResolvedValue(false);

    const outcome = await setPluginEnabledWithSiteAccess(
      CHATGPT_RESPONSE_NOTIFICATION_MANIFEST,
      true,
      CHATGPT,
      vi.fn(),
    );

    expect(outcome).toBe('denied');
    expect(notificationsOn()).toBe(false);
  });
});

describe('switching a Gemini official plugin whose switch is an old setting', () => {
  const GEMINI = 'https://gemini.google.com/app';
  let syncMemory: Record<string, unknown>;

  async function mermaidManifest(): Promise<PluginManifest> {
    const packaged = await new BundledCatalogPluginSource().list();
    const manifest = packaged.find(({ id }) => id === OFFICIAL_PLUGIN_IDS.geminiMermaid);
    if (!manifest) throw new Error('mermaid manifest not packaged');
    return manifest;
  }

  beforeEach(() => {
    syncMemory = {};
    (chrome.storage.sync.set as unknown as Mock).mockImplementation(
      (items: Record<string, unknown>, callback?: () => void) => {
        Object.assign(syncMemory, items);
        callback?.();
      },
    );
  });

  afterEach(() => {
    (chrome.storage.sync.set as unknown as Mock).mockReset();
    (chrome.runtime as { lastError?: unknown }).lastError = undefined;
  });

  it('writes the old sync key and leaves the plugin state alone', async () => {
    const onChange = vi.fn();
    const outcome = await setPluginEnabledWithSiteAccess(
      await mermaidManifest(),
      false,
      GEMINI,
      onChange,
    );
    expect(outcome).toBe('disabled');
    expect(syncMemory).toEqual({ [StorageKeys.MERMAID_ENABLED]: false });
    expect(memory[STATE]).toBeUndefined();
    expect(containsMock).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it('reports a failed write and shows the previous state again', async () => {
    (chrome.storage.sync.set as unknown as Mock).mockImplementation(
      (_items: Record<string, unknown>, callback?: () => void) => {
        (chrome.runtime as { lastError?: unknown }).lastError = { message: 'quota' };
        callback?.();
      },
    );
    const onChange = vi.fn();
    const outcome = await setPluginEnabledWithSiteAccess(
      await mermaidManifest(),
      false,
      GEMINI,
      onChange,
    );
    expect(outcome).toBe('write_failed');
    expect(onChange).toHaveBeenLastCalledWith(true);
    expect(memory[STATE]).toBeUndefined();
  });
});

describe("switching a site plugin from Firefox's in-page panel, which has no permissions API (#1118)", () => {
  const CHATGPT = 'https://chatgpt.com/c/abc';
  const isOn = (id: string): boolean =>
    (memory[STATE] as Record<string, { enabled: boolean }> | undefined)?.[id]?.enabled === true;
  function chatgptTimeline(): PluginManifest {
    const timeline = BUILTIN_PLUGINS.find((plugin) => plugin.id === 'voyager.chatgpt-timeline');
    if (!timeline) throw new Error('ChatGPT timeline missing');
    return timeline;
  }

  beforeEach(() => {
    browserKind.firefox = true;
    // What Firefox exposes to a moz-extension:// frame inside the host page.
    polyfill.permissions = undefined;
  });

  it('turns the ChatGPT timeline on for the page the panel is open on', async () => {
    const timeline = chatgptTimeline();
    const onChange = vi.fn();

    const outcome = await setPluginEnabledWithSiteAccess(timeline, true, CHATGPT, onChange, {
      onActivePage: true,
    });

    expect(outcome).toBe('enabled');
    expect(isOn(timeline.id)).toBe(true);
    expect(onChange).toHaveBeenLastCalledWith(true);
  });

  it.each([
    ['hands it to the popup instead of calling it unsupported', true, 'elsewhere'],
    ['is unsupported for a caller with no popup to hand it to', false, 'unsupported'],
  ] as const)("a Claude artifact frame's access %s", async (_, handsOff, expected) => {
    const artifacts: PluginManifest = {
      ...chatgptTimeline(),
      id: 'voyager.test-claude-artifacts',
      matches: ['https://claude.ai/*', 'https://*.frame.claudeusercontent.com/*'],
    };

    const outcome = await setPluginEnabledWithSiteAccess(
      artifacts,
      true,
      'https://claude.ai/chat/1',
      vi.fn(),
      { onActivePage: true, handsOff },
    );

    expect(outcome).toBe(expected);
    expect(isOn(artifacts.id)).toBe(false);
  });

  it('hands completion notifications to the popup, which can ask for the notifications permission', async () => {
    const outcome = await setPluginEnabledWithSiteAccess(
      CHATGPT_RESPONSE_NOTIFICATION_MANIFEST,
      true,
      CHATGPT,
      vi.fn(),
      { onActivePage: true, handsOff: true },
    );

    expect(outcome).toBe('elsewhere');
    expect(isOn(CHATGPT_RESPONSE_NOTIFICATION_MANIFEST.id)).toBe(false);
  });

  it('still reports a Firefox without optional host access as unsupported', async () => {
    const timeline = chatgptTimeline();
    browserKind.dynamicRegistration = false;

    const outcome = await setPluginEnabledWithSiteAccess(timeline, true, CHATGPT, vi.fn(), {
      onActivePage: true,
    });

    expect(outcome).toBe('unsupported');
    expect(isOn(timeline.id)).toBe(false);
  });

  it('reports another browser whose frame lacks the permissions API as unsupported', async () => {
    // Only Firefox strips its panel frame; elsewhere (a Safari with a reduced UA) it means no support.
    browserKind.firefox = false;
    const timeline = chatgptTimeline();

    const outcome = await setPluginEnabledWithSiteAccess(timeline, true, CHATGPT, vi.fn(), {
      onActivePage: true,
      handsOff: true,
    });

    expect(outcome).toBe('unsupported');
    expect(isOn(timeline.id)).toBe(false);
  });
});
