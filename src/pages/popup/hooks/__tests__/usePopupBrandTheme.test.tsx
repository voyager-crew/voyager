import React, { act, useEffect } from 'react';
import { type Root, createRoot } from 'react-dom/client';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import { listPluginManifests } from '@/features/plugins/sources/defaultSources';
import { loadPluginState } from '@/features/plugins/storage/pluginState';
import type { PluginManifest } from '@/features/plugins/types';

import { usePopupBrandTheme } from '../usePopupBrandTheme';

vi.mock('@/features/plugins/sources/defaultSources', () => ({ listPluginManifests: vi.fn() }));
vi.mock('@/features/plugins/storage/pluginState', () => ({
  loadPluginState: vi.fn(),
  subscribePluginState: () => () => {},
}));
vi.mock('@/features/plugins/remote/hostCatalogCache', () => ({
  subscribeHostCatalog: () => () => {},
}));
vi.mock('@/features/plugins/remote/siteOverride', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/plugins/remote/siteOverride')>()),
  loadSiteOverrideForHost: async () => null,
}));

const THEMED_PLUGIN: PluginManifest = {
  id: 'x.themed',
  name: 'Themed',
  version: '1.0.0',
  description: 'd',
  author: 'a',
  category: 'theme',
  license: 'MIT',
  engine: '>=1.0.0',
  tier: 'declarative',
  matches: ['https://claude.ai/*'],
  contributes: {},
  theme: { brand: '#00aa77' },
};

/** Let the brand sources' storage and catalog reads settle. */
const settle = () => act(async () => {});

type BrandTheme = ReturnType<typeof usePopupBrandTheme>;
type StorageListener = Parameters<typeof chrome.storage.onChanged.addListener>[0];

function Harness({ capture }: { capture: (theme: BrandTheme) => void }) {
  const theme = usePopupBrandTheme({
    activeUrl: 'https://claude.ai/chat/example',
    pluginSiteOverride: null,
  });
  useEffect(() => {
    capture(theme);
  }, [capture, theme]);
  return null;
}

describe('usePopupBrandTheme', () => {
  let container: HTMLDivElement;
  let root: Root | null;
  let theme: BrandTheme;
  let stored: Record<string, string>;
  let listeners: Set<StorageListener>;

  beforeEach(async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.resetAllMocks();
    vi.useFakeTimers();
    stored = { claude: '#112233', chatgpt: '#445566' };
    listeners = new Set();
    vi.mocked(chrome.storage.sync.get).mockImplementation((...args: unknown[]) => {
      const result = { [StorageKeys.ACCENT_COLORS]: stored };
      const callback = args[1];
      if (typeof callback === 'function') callback(result);
      return Promise.resolve(result);
    });
    vi.mocked(listPluginManifests).mockResolvedValue([]);
    vi.mocked(loadPluginState).mockResolvedValue({});
    vi.mocked(chrome.storage.onChanged.addListener).mockImplementation((listener) => {
      listeners.add(listener);
    });
    vi.mocked(chrome.storage.onChanged.removeListener).mockImplementation((listener) => {
      listeners.delete(listener);
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root?.render(<Harness capture={(next) => (theme = next)} />));
    await settle();
  });

  afterEach(() => {
    act(() => root?.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it('previews changes immediately and saves only the latest color after dragging pauses', () => {
    expect(theme.picker.siteId).toBe('claude');
    expect(theme.picker.value).toBe('#112233');
    expect(chrome.storage.sync.set).not.toHaveBeenCalled();

    act(() => theme.picker.onChange('#123456'));
    act(() => vi.advanceTimersByTime(150));
    act(() => theme.picker.onChange('#abcdef'));
    expect(theme.picker.value).toBe('#abcdef');
    expect(theme.style).toMatchObject({ '--primary': '#abcdef' });
    act(() => vi.advanceTimersByTime(199));
    expect(chrome.storage.sync.set).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(chrome.storage.sync.set).toHaveBeenCalledExactlyOnceWith({
      [StorageKeys.ACCENT_COLORS]: { claude: '#abcdef', chatgpt: '#445566' },
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('flushes the final unsaved color on unmount and removes its listener and timer', () => {
    act(() => theme.picker.onChange('#123456'));
    act(() => theme.picker.onChange('#fedcba'));
    act(() => vi.advanceTimersByTime(50));
    expect(listeners.size).toBe(1);
    act(() => root?.unmount());
    root = null;

    expect(chrome.storage.sync.set).toHaveBeenCalledExactlyOnceWith({
      [StorageKeys.ACCENT_COLORS]: { claude: '#fedcba', chatgpt: '#445566' },
    });
    expect(listeners.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(1000));
    expect(chrome.storage.sync.set).toHaveBeenCalledTimes(1);
  });

  it('follows external sync colors and resets only the current site override', async () => {
    stored = { claude: '#998877', chatgpt: '#665544' };
    const changes = { [StorageKeys.ACCENT_COLORS]: { newValue: stored } };
    act(() => listeners.forEach((listener) => listener(changes, 'local')));
    await settle();
    expect(theme.picker.value).toBe('#112233');
    act(() => listeners.forEach((listener) => listener(changes, 'sync')));
    await settle();
    expect(theme.picker.value).toBe('#998877');

    act(() => theme.picker.onChange(null));
    expect(theme.picker.value).toBeNull();
    expect(theme.style).toMatchObject({ '--primary': theme.picker.defaultColor });
    act(() => vi.advanceTimersByTime(200));
    expect(chrome.storage.sync.set).toHaveBeenCalledExactlyOnceWith({
      [StorageKeys.ACCENT_COLORS]: { chatgpt: '#665544' },
    });
  });

  it("ignores a disabled plugin's brand, as the page does, and takes it once enabled", async () => {
    stored = {};
    vi.mocked(listPluginManifests).mockResolvedValue([THEMED_PLUGIN]);
    vi.mocked(loadPluginState).mockResolvedValue({
      [THEMED_PLUGIN.id]: { enabled: false, installedAt: 0 },
    });
    act(() => root?.unmount());
    root = createRoot(container);
    act(() => root?.render(<Harness capture={(next) => (theme = next)} />));
    await settle();
    expect(theme.style).toMatchObject({ '--primary': '#d97757' });

    vi.mocked(loadPluginState).mockResolvedValue({
      [THEMED_PLUGIN.id]: { enabled: true, installedAt: 0 },
    });
    act(() => root?.unmount());
    root = createRoot(container);
    act(() => root?.render(<Harness capture={(next) => (theme = next)} />));
    await settle();
    expect(theme.style).toMatchObject({ '--primary': '#00aa77' });
  });
});
