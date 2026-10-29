import React, { act, useEffect } from 'react';
import { type Root, createRoot } from 'react-dom/client';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import browser from 'webextension-polyfill';

import { StorageKeys } from '@/core/types/common';
import { subscribeHostCatalog } from '@/features/plugins/remote/hostCatalogCache';
import { loadSiteOverrideForHost } from '@/features/plugins/remote/siteOverride';
import { PLUGIN_CATALOG_REFRESH_MESSAGE } from '@/features/plugins/runtime/messages';
import { OFFICIAL_PLUGIN_IDS } from '@/features/plugins/sites/featureOwners';
import {
  type SourcedPluginManifest,
  listPluginManifestsWithSources,
  refreshPluginManifestsWithSources,
} from '@/features/plugins/sources/defaultSources';
import {
  type PluginStateMap,
  loadPluginState,
  subscribePluginState,
} from '@/features/plugins/storage/pluginState';
import type { SiteAdapter } from '@/features/plugins/types';

import { type PopupPluginsContext, usePopupPlugins } from '../usePopupPlugins';

// Plain functions, so the suite's resetAllMocks keeps them.
const device = vi.hoisted(() => ({ formFactor: 'desktop' as 'desktop' | 'mobile' }));
vi.mock('@/core/utils/formFactor', () => ({
  readPlatformFormFactor: async () => device.formFactor,
}));
vi.mock('webextension-polyfill', () => ({
  default: { tabs: { sendMessage: vi.fn() }, runtime: { sendMessage: vi.fn() } },
}));
vi.mock('@/features/plugins/remote/hostCatalogCache', () => ({ subscribeHostCatalog: vi.fn() }));
vi.mock('@/features/plugins/remote/siteOverride', () => ({ loadSiteOverrideForHost: vi.fn() }));
vi.mock('@/features/plugins/sources/defaultSources', () => ({
  listPluginManifestsWithSources: vi.fn(),
  refreshPluginManifestsWithSources: vi.fn(),
}));
vi.mock('@/features/plugins/storage/pluginState', () => ({
  loadPluginState: vi.fn(),
  subscribePluginState: vi.fn(),
}));

type PopupPlugins = ReturnType<typeof usePopupPlugins>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function record(id: string, host = 'claude.ai'): SourcedPluginManifest {
  return {
    sourceId: 'bundled-catalog',
    manifest: {
      id,
      name: id,
      description: 'Popup plugin fixture',
      author: 'Voyager',
      version: '1.0.0',
      engine: '>=1.0.0',
      category: 'readability',
      license: 'MIT',
      tier: 'declarative',
      matches: [`https://${host}/*`],
      contributes: {},
    },
  };
}

const tabRequester =
  (tabId: number): PopupPluginsContext['requestTab'] =>
  (request) =>
    browser.tabs.sendMessage(tabId, request);

const context: PopupPluginsContext = {
  activeUrl: 'https://claude.ai/chat/example',
  requestTab: tabRequester(7),
  activeTabContextLoaded: true,
};

function Harness({
  capture,
  ...props
}: PopupPluginsContext & { capture: (value: PopupPlugins) => void }) {
  const plugins = usePopupPlugins(props);
  useEffect(() => capture(plugins), [capture, plugins]);
  return null;
}

describe('usePopupPlugins', () => {
  let container: HTMLDivElement;
  let root: Root | null;
  let plugins: PopupPlugins;
  let catalogs: Map<string, () => void>;
  let stateListeners: Set<(state: PluginStateMap) => void>;
  const capture = (value: PopupPlugins) => {
    plugins = value;
  };
  const render = async (props: PopupPluginsContext = context) => {
    await act(async () => {
      root!.render(<Harness {...props} capture={capture} />);
    });
  };
  const unmount = () => {
    act(() => root!.unmount());
    root = null;
  };

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    vi.resetAllMocks();
    catalogs = new Map();
    stateListeners = new Set();
    vi.mocked(subscribeHostCatalog).mockImplementation((host, listener) => {
      catalogs.set(host, listener);
      return () => {
        catalogs.delete(host);
      };
    });
    vi.mocked(subscribePluginState).mockImplementation((listener) => {
      stateListeners.add(listener);
      return () => {
        stateListeners.delete(listener);
      };
    });
    vi.mocked(listPluginManifestsWithSources).mockResolvedValue([]);
    vi.mocked(refreshPluginManifestsWithSources).mockResolvedValue([]);
    vi.mocked(loadSiteOverrideForHost).mockResolvedValue(null);
    vi.mocked(loadPluginState).mockResolvedValue({});
    vi.mocked(browser.tabs.sendMessage).mockResolvedValue({ ok: true, statuses: [] });
    vi.mocked(browser.runtime.sendMessage).mockResolvedValue({ ok: true });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    if (root) unmount();
    container.remove();
    vi.useRealTimers();
    device.formFactor = 'desktop';
  });

  it('says on a phone which plugins cannot run there, even when the tab answers nothing', async () => {
    device.formFactor = 'mobile';
    const desktopOnly = record('claude-desktop-only');
    const desktopManifest = {
      ...desktopOnly.manifest,
      requires: { formFactors: ['desktop'] as const },
    };
    vi.mocked(listPluginManifestsWithSources).mockResolvedValue([
      { ...desktopOnly, manifest: desktopManifest },
      record('claude-undeclared'),
    ]);
    // Firefox for Android opens the popup as its own tab: the page may not answer.
    vi.mocked(browser.tabs.sendMessage).mockRejectedValue(new Error('No receiving end'));

    await render();

    expect(plugins.formFactor).toBe('mobile');
    expect(plugins.pluginStatuses).toEqual([
      {
        id: 'claude-desktop-only',
        version: '1.0.0',
        kind: 'needs-form-factor',
        formFactor: 'mobile',
      },
    ]);
  });

  it('reports no device refusal on a desktop', async () => {
    vi.mocked(listPluginManifestsWithSources).mockResolvedValue([record('claude-desktop-only')]);
    await render();
    expect(plugins.formFactor).toBe('desktop');
    expect(plugins.pluginStatuses).toEqual([]);
  });

  it('waits for tab context and keeps complete records separate from site-visible plugins', async () => {
    const records = deferred<readonly SourcedPluginManifest[]>();
    const state = deferred<PluginStateMap>();
    const claude = {
      ...record('claude-tools'),
      blockedUpdate: { version: '2.0.0', engine: '>=2' },
    };
    const chatgpt = record('chatgpt-tools', 'chatgpt.com');
    vi.mocked(listPluginManifestsWithSources).mockReturnValue(records.promise);
    vi.mocked(loadPluginState).mockReturnValue(state.promise);

    await render({ ...context, activeTabContextLoaded: false });
    expect(listPluginManifestsWithSources).not.toHaveBeenCalled();
    expect(plugins.pluginsLoading).toBe(true);
    expect(plugins.pluginStateLoaded).toBe(false);

    await act(async () => state.resolve({ 'chatgpt-tools': { enabled: true, installedAt: 1 } }));
    expect(plugins.pluginStateLoaded).toBe(true);
    await render();
    expect(listPluginManifestsWithSources).toHaveBeenCalledWith(undefined, {
      url: context.activeUrl,
      host: 'claude.ai',
    });
    await act(async () => records.resolve([claude, chatgpt]));

    expect(plugins.pluginsLoading).toBe(false);
    expect(plugins.pluginManifests).toEqual([claude.manifest, chatgpt.manifest]);
    expect(plugins.siteScopedManifests).toEqual([claude.manifest]);
    expect(plugins.pluginSourceIds).toEqual({
      'claude-tools': 'bundled-catalog',
      'chatgpt-tools': 'bundled-catalog',
    });
    expect(plugins.pluginBlockedUpdates).toEqual({ 'claude-tools': claude.blockedUpdate });
    expect(plugins.diagnosticPlugins).toEqual([
      expect.objectContaining({ id: 'claude-tools', enabled: false, source: 'bundled-catalog' }),
      expect.objectContaining({ id: 'chatgpt-tools', enabled: true, source: 'bundled-catalog' }),
    ]);

    await act(async () => {
      for (const listener of stateListeners)
        listener({ 'claude-tools': { enabled: true, installedAt: 2 } });
    });
    expect(plugins.pluginState['claude-tools'].enabled).toBe(true);
    expect(plugins.diagnosticPlugins[0].enabled).toBe(true);
  });

  it('follows the new host catalog and ignores the previous host load after its cleanup', async () => {
    const oldRecords = deferred<readonly SourcedPluginManifest[]>();
    const oldOverride = deferred<SiteAdapter | null>();
    const current = record('chatgpt-tools', 'chatgpt.com');
    vi.mocked(listPluginManifestsWithSources)
      .mockReturnValueOnce(oldRecords.promise)
      .mockResolvedValue([current]);
    vi.mocked(loadSiteOverrideForHost).mockReturnValueOnce(oldOverride.promise);
    await render();
    expect([...catalogs.keys()]).toEqual(['claude.ai']);

    await render({
      ...context,
      activeUrl: 'https://chatgpt.com/c/example',
      requestTab: tabRequester(8),
    });
    expect([...catalogs.keys()]).toEqual(['chatgpt.com']);
    expect(plugins.pluginCatalogHost).toBe('chatgpt.com');
    expect(plugins.siteScopedManifests).toEqual([current.manifest]);
    await act(async () => {
      oldRecords.resolve([record('stale-claude')]);
      oldOverride.resolve({
        id: 'claude',
        label: 'Old host',
        matches: [],
        selectors: {},
        theme: { hostSelector: 'body', lightSelector: '.light', darkSelector: '.dark' },
        capabilities: new Set(),
      });
    });
    expect(plugins.pluginManifests).toEqual([current.manifest]);
    expect(plugins.pluginSiteOverride).toBeNull();

    const updated = { ...current, manifest: { ...current.manifest, version: '1.1.0' } };
    vi.mocked(listPluginManifestsWithSources).mockResolvedValue([updated]);
    await act(async () => catalogs.get('chatgpt.com')!());
    expect(plugins.pluginManifests[0].version).toBe('1.1.0');
  });

  it('receives the delayed status verdict and removes subscriptions and pending polling on unmount', async () => {
    const status = { id: 'claude-tools', version: '1.0.0', kind: 'mounted' };
    await render();
    expect(plugins.pluginStatuses).toEqual([]);
    vi.mocked(browser.tabs.sendMessage).mockResolvedValue({ ok: true, statuses: [status] });
    await act(async () => vi.advanceTimersByTimeAsync(2500));
    expect(plugins.pluginStatuses).toEqual([status]);

    await act(async () => {
      for (const listener of stateListeners) listener({});
    });
    const calls = vi.mocked(browser.tabs.sendMessage).mock.calls.length;
    unmount();
    expect(catalogs.size).toBe(0);
    expect(stateListeners.size).toBe(0);
    await act(async () => vi.advanceTimersByTimeAsync(2500));
    expect(browser.tabs.sendMessage).toHaveBeenCalledTimes(calls);
  });

  it('reports an official plugin bound to a legacy switch by that switch, on any site, and re-asks the tab when it flips', async () => {
    type StorageListener = (changes: Record<string, { newValue?: unknown }>, area: string) => void;
    const storageListeners = new Set<StorageListener>();
    vi.mocked(chrome.storage.onChanged.addListener).mockImplementation((listener) => {
      storageListeners.add(listener as unknown as StorageListener);
    });
    vi.mocked(chrome.storage.onChanged.removeListener).mockImplementation((listener) => {
      storageListeners.delete(listener as unknown as StorageListener);
    });
    vi.mocked(chrome.storage.sync.get).mockResolvedValue({
      [StorageKeys.FORMULA_COPY_ENABLED]: false,
    } as never);
    const formulaId = OFFICIAL_PLUGIN_IDS.geminiFormulaCopy;
    vi.mocked(listPluginManifestsWithSources).mockResolvedValue([
      record(formulaId, 'gemini.google.com'),
    ]);
    // The map's entry is ignored for a bound plugin.
    vi.mocked(loadPluginState).mockResolvedValue({
      [formulaId]: { enabled: true, installedAt: 1 },
    });

    await render(); // the active tab is on Claude
    expect(plugins.diagnosticPlugins).toEqual([
      expect.objectContaining({ id: formulaId, enabled: false }),
    ]);

    const asked = vi.mocked(browser.tabs.sendMessage).mock.calls.length;
    await act(async () => {
      for (const listener of storageListeners) {
        listener({ [StorageKeys.FORMULA_COPY_ENABLED]: { newValue: true } }, 'sync');
      }
    });
    expect(plugins.diagnosticPlugins[0].enabled).toBe(true);
    expect(vi.mocked(browser.tabs.sendMessage).mock.calls.length).toBeGreaterThan(asked);

    unmount();
    expect(storageListeners.size).toBe(0);
  });

  it('reports bound official plugins in popup diagnostics with their legacy values, labelled storage-derived', async () => {
    const formulaId = OFFICIAL_PLUGIN_IDS.geminiFormulaCopy;
    const localId = 'local.me.tweak';
    vi.mocked(chrome.storage.sync.get).mockResolvedValue({} as never);
    vi.mocked(listPluginManifestsWithSources).mockResolvedValue([
      record(formulaId, 'gemini.google.com'),
      record(localId, 'gemini.google.com'),
    ]);
    vi.mocked(loadPluginState).mockResolvedValue({
      // Stray settings a bound plugin never runs with.
      [formulaId]: { enabled: true, installedAt: 1, settings: { format: 'stray' } },
      [localId]: { enabled: true, installedAt: 1, settings: { width: 3 } },
    });

    await render();
    expect(plugins.diagnosticPlugins).toEqual([
      expect.objectContaining({ id: formulaId, settings: {}, basis: 'storage-derived' }),
      expect.objectContaining({ id: localId, settings: { width: 3 } }),
    ]);
    // A plugin's own state is what its page runs: nothing derived to label.
    expect(plugins.diagnosticPlugins[1]).not.toHaveProperty('basis');
    unmount();
  });

  it('re-asks every second while a plugin waits for a release, and stops once it starts', async () => {
    const waiting = {
      id: 'local.me.formula',
      version: '1.0.0',
      kind: 'blocked',
      blockedReason: 'releasing',
      blockedBy: 'voyager.gemini-formula-copy',
    };
    const mounted = { id: 'local.me.formula', version: '1.0.0', kind: 'mounted' };
    vi.mocked(browser.tabs.sendMessage).mockResolvedValue({ ok: true, statuses: [waiting] });
    await render();
    const asked = () => vi.mocked(browser.tabs.sendMessage).mock.calls.length;
    const first = asked();

    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(asked()).toBe(first + 1);

    vi.mocked(browser.tabs.sendMessage).mockResolvedValue({ ok: true, statuses: [mounted] });
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(plugins.pluginStatuses).toEqual([mounted]);
    const settled = asked();
    // Only the one delayed health check remains.
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(asked()).toBe(settled + 1);
  });

  it('re-asks while a plugin waits for the official switch to be read, and stops once it is', async () => {
    const pending = {
      id: 'local.me.formula',
      version: '1.0.0',
      kind: 'blocked',
      blockedReason: 'pending',
      blockedBy: 'voyager.gemini-formula-copy',
    };
    const conflict = { ...pending, blockedReason: 'conflict' };
    vi.mocked(browser.tabs.sendMessage).mockResolvedValue({ ok: true, statuses: [pending] });
    await render();
    const asked = () => vi.mocked(browser.tabs.sendMessage).mock.calls.length;
    const first = asked();

    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(asked()).toBe(first + 1);

    // The read landed with the switch on: a conflict only the user resolves.
    vi.mocked(browser.tabs.sendMessage).mockResolvedValue({ ok: true, statuses: [conflict] });
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(plugins.pluginStatuses).toEqual([conflict]);
    const settled = asked();
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(asked()).toBe(settled + 1);
  });

  it('gives up on a release that never finishes after a bounded number of re-asks', async () => {
    const waiting = {
      id: 'voyager.gemini-vim-input',
      version: '1.0.0',
      kind: 'blocked',
      blockedReason: 'conflict',
      // Waiting on its own previous run reads as a release too.
      blockedBy: 'voyager.gemini-vim-input',
    };
    vi.mocked(browser.tabs.sendMessage).mockResolvedValue({ ok: true, statuses: [waiting] });
    await render();
    const opened = vi.mocked(browser.tabs.sendMessage).mock.calls.length;

    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    const settled = vi.mocked(browser.tabs.sendMessage).mock.calls.length;
    // The delayed health check and at most ten release re-asks.
    expect(settled - opened).toBeGreaterThan(1);
    expect(settled - opened).toBeLessThanOrEqual(11);
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(browser.tabs.sendMessage).toHaveBeenCalledTimes(settled);

    // A change the user makes starts a fresh, equally bounded round.
    await act(async () => {
      for (const listener of stateListeners) listener({});
    });
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    const again = vi.mocked(browser.tabs.sendMessage).mock.calls.length;
    expect(again - settled).toBeGreaterThan(2);
    expect(again - settled).toBeLessThanOrEqual(12);
  });

  it('does not re-ask for a conflict, which only a user change resolves', async () => {
    vi.mocked(browser.tabs.sendMessage).mockResolvedValue({
      ok: true,
      statuses: [
        {
          id: 'local.me.formula',
          version: '1.0.0',
          kind: 'blocked',
          blockedReason: 'conflict',
          blockedBy: 'voyager.gemini-formula-copy',
        },
      ],
    });
    await render();
    const opened = vi.mocked(browser.tabs.sendMessage).mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    // Only the delayed health check.
    expect(browser.tabs.sendMessage).toHaveBeenCalledTimes(opened + 1);
  });

  it('re-reads the cached catalog after a manual background refresh fails', async () => {
    const refreshed = deferred<readonly SourcedPluginManifest[]>();
    const latest = record('cached-tools');
    vi.mocked(browser.runtime.sendMessage).mockRejectedValue(new Error('background unavailable'));
    vi.mocked(refreshPluginManifestsWithSources).mockReturnValue(refreshed.promise);
    await render();
    let refresh!: Promise<void>;
    await act(async () => {
      refresh = plugins.refresh();
    });
    expect(plugins.pluginsRefreshing).toBe(true);
    expect(browser.runtime.sendMessage).toHaveBeenCalledWith({
      type: PLUGIN_CATALOG_REFRESH_MESSAGE,
      payload: { host: 'claude.ai', force: true },
    });
    await act(async () => {
      refreshed.resolve([latest]);
      await refresh;
    });
    expect(plugins.pluginManifests).toEqual([latest.manifest]);
    expect(plugins.pluginsRefreshing).toBe(false);
  });
});
