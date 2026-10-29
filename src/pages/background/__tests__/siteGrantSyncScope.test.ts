/**
 * A grant the browser reports to the background puts its supported site back
 * in what syncs, even when the popup or panel that asked has already closed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { markSiteIncluded } from '@/core/services/CloudSyncScope';
import { StorageKeys } from '@/core/types/common';
import { CATALOG_SITES } from '@/pages/popup/utils/siteAccessSites';
import { type MemoryStorage, createMemoryStorage } from '@/tests/memoryStorage';

const { contains } = vi.hoisted(() => ({ contains: vi.fn() }));

vi.mock('webextension-polyfill', () => ({
  default: {
    get storage() {
      return globalThis.chrome.storage;
    },
    permissions: { contains },
    scripting: {
      getRegisteredContentScripts: vi.fn(async () => []),
      registerContentScripts: vi.fn(async () => {}),
      unregisterContentScripts: vi.fn(async () => {}),
    },
  },
}));
vi.mock('@/features/plugins/sources/defaultSources', () => ({
  listPluginManifests: vi.fn(async () => []),
}));
vi.mock('../enabledPlugins', () => ({ loadEnabledPlugins: vi.fn(async () => []) }));

type Added = chrome.permissions.Permissions;
const SCOPE = StorageKeys.CLOUD_SYNC_SCOPE;
const claude = CATALOG_SITES.find(({ id }) => id === 'claude')!;

describe('a grant the background sees joins cloud sync', () => {
  let memory: MemoryStorage;
  let onAdded: (permissions: Added) => void;
  /** The listener's work for the last event; the listener itself returns nothing. */
  let handled: Promise<void>;
  let originalStorage: typeof chrome.storage;
  let originalPermissions: typeof chrome.permissions;

  const scopeWrites = () =>
    vi.mocked(memory.api.local.set).mock.calls.filter(([items]) => SCOPE in items).length;
  const claudeIncluded = () =>
    (memory.values.local.get(SCOPE) as { sites: Record<string, boolean> } | undefined)?.sites
      .claude;

  /** Delivers the event as Chrome does, and waits for the listener's work to finish. */
  async function grant(permissions: Added): Promise<void> {
    onAdded(permissions);
    await handled;
  }

  beforeEach(async () => {
    memory = createMemoryStorage();
    vi.spyOn(memory.api.local, 'set');
    originalStorage = chrome.storage;
    originalPermissions = chrome.permissions;
    chrome.storage = memory.api as typeof chrome.storage;
    chrome.permissions = {
      onAdded: { addListener: vi.fn() },
      onRemoved: { addListener: vi.fn() },
    } as unknown as typeof chrome.permissions;
    chrome.runtime.getManifest = vi.fn((): chrome.runtime.Manifest => ({
      manifest_version: 3,
      name: 'Voyager',
      version: '0.0.0',
      host_permissions: ['https://gemini.google.com/*'],
    }));
    contains.mockReset().mockResolvedValue(true);
    // Claude was turned off in what syncs before.
    await memory.api.local.set({ [SCOPE]: { shared: true, sites: { claude: false } } });
    vi.mocked(memory.api.local.set).mockClear();

    const { createSiteAccessRegistration } = await import('../siteAccessRegistration');
    const { registerBackgroundSettingListeners } = await import('../registrationSettings');
    const siteAccess = createSiteAccessRegistration();
    const permissionAdded = siteAccess.permissionAdded;
    siteAccess.permissionAdded = (origins) => (handled = permissionAdded(origins));
    registerBackgroundSettingListeners({ siteAccess, mainWorld: {} as never });
    onAdded = vi.mocked(chrome.permissions.onAdded.addListener).mock.calls[0][0];
  });
  afterEach(() => {
    chrome.storage = originalStorage;
    chrome.permissions = originalPermissions;
    vi.restoreAllMocks();
  });

  it('puts Claude back in sync when its access is granted', async () => {
    await grant({ origins: ['https://claude.ai/*'], permissions: [] });

    expect(contains).toHaveBeenCalledWith({ origins: ['https://claude.ai/*'] });
    expect(claudeIncluded()).toBe(true);
  });

  it.each<[string, Added]>([
    ['an API permission alone', { origins: [], permissions: ['notifications'] }],
    ['a frame the site embeds', { origins: [...claude.companionOrigins], permissions: [] }],
    ['another website', { origins: ['https://example.com/*'], permissions: [] }],
  ])('leaves what syncs alone for %s', async (_, permissions) => {
    await grant(permissions);

    expect(claudeIncluded()).toBe(false);
    expect(scopeWrites()).toBe(0);
  });

  it('leaves what syncs alone when the access is no longer held', async () => {
    contains.mockResolvedValue(false);
    await grant({ origins: ['https://claude.ai/*'], permissions: [] });

    expect(claudeIncluded()).toBe(false);
  });

  it('changes nothing more when the popup or panel already included the site', async () => {
    await markSiteIncluded('claude');
    await grant({ origins: ['https://claude.ai/*'], permissions: [] });
    await markSiteIncluded('claude');

    expect(claudeIncluded()).toBe(true);
    expect(scopeWrites()).toBe(1);
  });
});
