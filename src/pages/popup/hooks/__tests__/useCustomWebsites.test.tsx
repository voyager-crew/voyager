import React, { act, useEffect } from 'react';
import { type Root, createRoot } from 'react-dom/client';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { StorageKeys } from '@/core/types/common';
import type { TranslationKey } from '@/utils/translations';

import { type CustomWebsitesOptions, useCustomWebsites } from '../useCustomWebsites';

const mocks = vi.hoisted(() => ({
  contains: vi.fn<(permissions: { origins: string[] }) => Promise<boolean>>(),
  request: vi.fn<(permissions: { origins: string[] }) => Promise<boolean>>(),
  remove: vi.fn<(permissions: { origins: string[] }) => Promise<boolean>>(),
  isFirefox: vi.fn<() => boolean>(),
  supported: vi.fn<() => boolean>(),
}));
vi.mock('webextension-polyfill', () => ({ default: { permissions: mocks } }));
vi.mock('@/core/utils/browser', () => ({
  isFirefox: mocks.isFirefox,
  supportsOptionalHostPermissions: mocks.supported,
}));

type Websites = ReturnType<typeof useCustomWebsites>;
const translate = (key: TranslationKey): string => key;
const COVERAGE = StorageKeys.PROMPT_CUSTOM_WEBSITES;

function Harness({
  options,
  capture,
}: {
  options: CustomWebsitesOptions;
  capture: (value: Websites) => void;
}) {
  const settings = useCustomWebsites(options);
  useEffect(() => {
    capture(settings);
  }, [capture, settings]);
  return null;
}

describe('useCustomWebsites', () => {
  let root: Root;
  let container: HTMLDivElement;
  let settings: Websites;
  let events: string[];
  let options: CustomWebsitesOptions;
  /** Sync storage as the hook reads it fresh before each write. */
  let stored: Record<string, unknown>;
  const write = vi.fn<(payload: Record<string, unknown>) => Promise<void>>();
  const refresh = vi.fn<() => Promise<void>>();
  const render = (overrides: Partial<CustomWebsitesOptions> = {}) => {
    options = { ...options, ...overrides };
    act(() => root.render(<Harness options={options} capture={(value) => (settings = value)} />));
  };

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.resetAllMocks();
    events = [];
    mocks.isFirefox.mockReturnValue(false);
    mocks.supported.mockReturnValue(true);
    mocks.contains.mockImplementation(async () => {
      events.push('contains');
      return false;
    });
    mocks.request.mockImplementation(async () => {
      events.push('request');
      return true;
    });
    mocks.remove.mockImplementation(async () => {
      events.push('remove');
      return true;
    });
    stored = {};
    vi.mocked(chrome.storage.sync.get).mockImplementation(() =>
      Promise.resolve({ [COVERAGE]: stored[COVERAGE] }),
    );
    write.mockImplementation(async (payload) => {
      events.push('write');
      Object.assign(stored, payload);
    });
    refresh.mockImplementation(async () => {
      events.push('refresh');
    });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    options = {
      t: translate,
      pluginManifests: [],
      refreshActiveTabContext: refresh,
      writeSyncStorage: write,
    };
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    render();
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  /** The list as the popup read it at startup, and as storage holds it. */
  const hydrate = (list: unknown[]) => {
    stored[COVERAGE] = list;
    return act(async () => settings.hydrateFromStorage({ [COVERAGE]: list }));
  };

  const start = (action: 'add' | 'quick') =>
    action === 'add'
      ? settings.handleAddWebsite()
      : settings.toggleQuickWebsite('example.com', false);

  it('sanitizes legacy entries, retains either granted scheme and fails open on API errors', async () => {
    mocks.contains.mockImplementation(async ({ origins }) => {
      if (origins[0].includes('error.example')) throw new Error('Unavailable');
      return origins[0] === 'http://*.example.com/*';
    });
    await hydrate([
      ' HTTPS://WWW.Example.com/path ',
      'example.com',
      '<all_urls>',
      'missing.example',
      'error.example',
    ]);

    expect(settings.customWebsites).toEqual(['example.com', 'error.example']);
    expect(
      write.mock.calls.map(([payload]) => payload[StorageKeys.PROMPT_CUSTOM_WEBSITES]),
    ).toEqual([
      ['example.com', 'missing.example', 'error.example'],
      ['example.com', 'error.example'],
    ]);
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it('keeps hydration stable when translations, current tab or the catalog change', () => {
    const first = settings.hydrateFromStorage;
    render({
      t: (key) => `translated:${key}`,
      refreshActiveTabContext: vi.fn(async () => {}),
      pluginManifests: [{ matches: ['https://claude.ai/*'] }],
    });
    expect(settings.hydrateFromStorage).toBe(first);
    expect(mocks.contains).not.toHaveBeenCalled();
  });

  it.each(['add', 'quick'] as const)(
    'requests Firefox permission synchronously before %s persists',
    async (action) => {
      mocks.isFirefox.mockReturnValue(true);
      act(() => settings.onWebsiteInputChange(' HTTPS://WWW.Example.com/path '));
      let pending!: Promise<void>;
      act(() => {
        pending = start(action);
      });
      expect(events).toEqual(['request']);
      expect(mocks.request).toHaveBeenCalledWith({
        origins: ['https://*.example.com/*', 'http://*.example.com/*'],
      });
      await act(async () => pending);
      expect(events).toEqual(['request', 'refresh', 'write']);
      expect(settings.customWebsites).toEqual(['example.com']);
      if (action === 'add') expect(settings.newWebsiteInput).toBe('');
    },
  );

  it.each(['add', 'quick'] as const)('keeps Firefox denied %s out of storage', async (action) => {
    mocks.isFirefox.mockReturnValue(true);
    mocks.request.mockResolvedValue(false);
    act(() => settings.onWebsiteInputChange('example.com'));
    await act(async () => start(action));
    expect(settings.customWebsites).toEqual([]);
    expect(settings.newWebsiteInput).toBe('example.com');
    expect(settings.websiteError).toBe('permissionDenied');
    expect(write).not.toHaveBeenCalled();
    expect(mocks.contains).not.toHaveBeenCalled();
  });

  it.each(['add', 'quick'] as const)(
    'persists non-Firefox %s before requesting and rolls back a denial',
    async (action) => {
      mocks.contains.mockResolvedValueOnce(true);
      await hydrate(['keep.example']);
      events = [];
      mocks.request.mockImplementation(async () => {
        events.push('request');
        return false;
      });
      act(() => settings.onWebsiteInputChange('example.com'));
      await act(async () => start(action));
      expect(events).toEqual(['write', 'contains', 'request', 'write']);
      expect(
        write.mock.calls.map(([payload]) => payload[StorageKeys.PROMPT_CUSTOM_WEBSITES]),
      ).toEqual([['keep.example', 'example.com'], ['keep.example']]);
      expect(settings.customWebsites).toEqual(['keep.example']);
      expect(settings.websiteError).toBe('permissionDenied');
      if (action === 'add') expect(settings.newWebsiteInput).toBe('');
    },
  );

  it('reuses a non-Firefox grant and refreshes the active tab after persisting', async () => {
    mocks.contains.mockImplementation(async () => {
      events.push('contains');
      return true;
    });
    act(() => settings.onWebsiteInputChange('example.com'));
    await act(async () => settings.handleAddWebsite());
    expect(events).toEqual(['write', 'contains', 'refresh']);
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('rejects invalid and duplicate input without requesting permission or writing', async () => {
    for (const input of ['', '<all_urls>', 'localhost']) {
      act(() => settings.onWebsiteInputChange(input));
      await act(async () => settings.handleAddWebsite());
    }
    expect(settings.websiteError).toBe('invalidUrl');
    mocks.contains.mockResolvedValue(true);
    await hydrate(['example.com']);
    act(() => settings.onWebsiteInputChange('https://www.example.com/path'));
    expect(settings.websiteError).toBe('');
    await act(async () => settings.handleAddWebsite());
    expect(settings.websiteError).toBe('invalidUrl');
    expect(write).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('reports unsupported Firefox and request errors without saving a selection', async () => {
    mocks.isFirefox.mockReturnValue(true);
    mocks.supported.mockReturnValue(false);
    await act(async () => settings.toggleQuickWebsite('example.com', false));
    expect(settings.websiteError).toBe('pluginUnsupportedPlatform');
    expect(mocks.request).not.toHaveBeenCalled();
    mocks.supported.mockReturnValue(true);
    mocks.request.mockRejectedValue(new Error('Request failed'));
    await act(async () => settings.toggleQuickWebsite('example.com', false));
    expect(settings.websiteError).toBe('permissionRequestFailed');
    expect(write).not.toHaveBeenCalled();
  });

  it.each(['remove', 'quick'] as const)(
    '%s preserves permissions required anywhere in the full plugin catalog',
    async (action) => {
      mocks.contains.mockResolvedValue(true);
      await hydrate(['example.com', 'claude.ai']);
      render({
        pluginManifests: [
          { matches: ['https://chatgpt.com/*'] },
          { matches: ['https://claude.ai/*'] },
        ],
      });
      await act(async () =>
        action === 'remove'
          ? settings.handleRemoveWebsite('claude.ai')
          : settings.toggleQuickWebsite('claude.ai', true),
      );
      expect(settings.customWebsites).toEqual(['example.com']);
      expect(write).toHaveBeenCalledWith({ [StorageKeys.PROMPT_CUSTOM_WEBSITES]: ['example.com'] });
      expect(mocks.remove).not.toHaveBeenCalled();
    },
  );

  const removeSite = (action: 'remove' | 'quick', domain: string) =>
    action === 'remove'
      ? settings.handleRemoveWebsite(domain)
      : settings.toggleQuickWebsite(domain, true);

  it.each(['remove', 'quick'] as const)(
    '%s keeps the parent-domain grant a subdomain-only plugin depends on',
    async (action) => {
      mocks.contains.mockResolvedValue(true);
      await hydrate(['deepseek.com']);
      render({ pluginManifests: [{ matches: ['https://chat.deepseek.com/*'] }] });
      await act(async () => removeSite(action, 'deepseek.com'));
      expect(settings.customWebsites).toEqual([]);
      expect(mocks.remove).not.toHaveBeenCalled();
    },
  );

  it.each(['remove', 'quick'] as const)(
    '%s still revokes when only a lookalike host has a plugin',
    async (action) => {
      mocks.contains.mockResolvedValue(true);
      await hydrate(['deepseek.com']);
      render({
        pluginManifests: [
          { matches: ['https://evildeepseek.com/*'] },
          { matches: ['https://chat.evildeepseek.com/*'] },
        ],
      });
      await act(async () => removeSite(action, 'deepseek.com'));
      expect(mocks.remove).toHaveBeenCalledWith({
        origins: ['https://*.deepseek.com/*', 'http://*.deepseek.com/*'],
      });
    },
  );

  it('removing a parent site keeps the grant a remaining subdomain site still uses', async () => {
    mocks.contains.mockResolvedValue(true);
    await hydrate(['example.com', 'app.example.com']);
    await act(async () => settings.handleRemoveWebsite('example.com'));
    expect(settings.customWebsites).toEqual(['app.example.com']);
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it('removes an ordinary host grant only after persisting the reduced website list', async () => {
    mocks.contains.mockResolvedValue(true);
    await hydrate(['example.com']);
    events = [];
    await act(async () => settings.handleRemoveWebsite('example.com'));
    expect(events).toEqual(['write', 'remove']);
    expect(mocks.remove).toHaveBeenCalledWith({
      origins: ['https://*.example.com/*', 'http://*.example.com/*'],
    });
    expect(settings.customWebsites).toEqual([]);
  });
});
