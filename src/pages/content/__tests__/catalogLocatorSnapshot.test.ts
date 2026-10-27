import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getGeminiBundledRevision, getGeminiSelectorView } from '@/core/gemini/selectors';
import { StorageKeys } from '@/core/types/common';
import { EXTENSION_VERSION } from '@/core/utils/version';
import geminiSite from '@/features/plugins/catalog/sites/gemini/site.json';
import { hostCatalogStorageKey } from '@/features/plugins/remote/hostCatalogCache';

import { startPageSelectors } from '../pageSelectorStartup';

const host = 'gemini.google.com';
const stops: Array<() => void> = [];

function cache(
  locators: unknown,
  catalogRevision = getGeminiBundledRevision() + 1,
  version = EXTENSION_VERSION,
) {
  return {
    [hostCatalogStorageKey(host)]: {
      host,
      status: 'ok',
      manifests: [],
      extensionVersion: version,
      fetchedAt: 1,
      lastAttemptAt: 1,
      failureCount: 0,
      site: { ...geminiSite, catalogRevision, ...(locators === undefined ? {} : { locators }) },
    },
  };
}

async function start() {
  const startup = startPageSelectors({
    url: 'https://gemini.google.com/u/1/app/test',
    doc: document,
    lifetime: new AbortController().signal,
  });
  stops.push(startup.stop);
  await startup.ready;
  return getGeminiSelectorView();
}

function users() {
  return Array.from(
    document.querySelectorAll(getGeminiSelectorView().profiles['turn.user'].join(',')),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('VOYAGER_PLUGIN_CATALOG_REMOTE', 'on');
  vi.mocked(chrome.storage.sync.get).mockResolvedValue({
    [StorageKeys.PLUGIN_ONLINE_UPDATES_ENABLED]: true,
  } as never);
  document.body.innerHTML =
    '<div class="user-query-container repaired-user" id="same">Same turn</div>';
});

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  vi.unstubAllEnvs();
  document.body.replaceChildren();
});

describe('catalog-backed Gemini page reads', () => {
  it('a newer catalog preserves the bundled DOM nodes and order through remote profiles', async () => {
    const bundled = users();
    vi.mocked(chrome.storage.local.get).mockResolvedValue(
      cache({ 'turn.user': ['.repaired-user'] }) as never,
    );
    const view = await start();
    expect(users()).toEqual(bundled);
    expect(users().map((node) => node.id)).toEqual(['same']);
    expect(view.remoteKeys.has('turn.user')).toBe(true);
  });

  it.each([0, 8, 9])('revision %i cannot replace the newer packaged adapter', async (revision) => {
    vi.stubEnv('VOYAGER_CATALOG_REVISION', '9');
    vi.mocked(chrome.storage.local.get).mockResolvedValue(
      cache({ 'turn.user': ['.foreign'] }, revision) as never,
    );
    const view = await start();
    expect(users().map((node) => node.id)).toEqual(['same']);
    expect(view.remoteKeys.size).toBe(0);
  });

  it.each([
    undefined,
    [],
    { 'turn.user': Array(33).fill('.foreign') },
    { 'turn.user': Array(32).fill('界'.repeat(2048)) },
  ])('a missing or malformed locators section keeps bundled page reads: %j', async (locators) => {
    vi.mocked(chrome.storage.local.get).mockResolvedValue(cache(locators) as never);
    const view = await start();
    expect(users().map((node) => node.id)).toEqual(['same']);
    expect(view.remoteKeys.size).toBe(0);
  });

  it('a future key does not withdraw the repaired turn snapshot at page startup', async () => {
    vi.mocked(chrome.storage.local.get).mockResolvedValue(
      cache({ 'turn.user': ['.repaired-user'], 'future.turn': ['.future'] }) as never,
    );
    const view = await start();
    expect(users().map((node) => node.id)).toEqual(['same']);
    expect(view.remoteKeys.has('turn.user')).toBe(true);
  });

  it('a cache from another extension version cannot retarget the page', async () => {
    vi.mocked(chrome.storage.local.get).mockResolvedValue(
      cache({ 'turn.user': ['.foreign'] }, 9999, 'old-build') as never,
    );
    await start();
    expect(users().map((node) => node.id)).toEqual(['same']);
  });

  it('an unparsable model menu leaves the turn repair usable', async () => {
    vi.mocked(chrome.storage.local.get).mockResolvedValue(
      cache({
        'turn.user': ['.repaired-user'],
        'modelPicker.items': ['['],
        'modelPicker.trigger': ['.foreign'],
      }) as never,
    );
    const view = await start();
    expect(users().map((node) => node.id)).toEqual(['same']);
    expect(view.remoteKeys.has('turn.user')).toBe(true);
    expect(view.remoteKeys.has('modelPicker.trigger')).toBe(false);
  });

  it('withdrawal returns the next document to the bundle without switching an open snapshot', async () => {
    vi.mocked(chrome.storage.local.get).mockResolvedValue(
      cache({ 'turn.user': ['.repaired-user'] }) as never,
    );
    const previous = await start();
    vi.mocked(chrome.storage.local.get).mockResolvedValue(
      cache({}, getGeminiBundledRevision() + 2) as never,
    );
    expect(getGeminiSelectorView()).toBe(previous);
    const next = await start();
    expect(users().map((node) => node.id)).toEqual(['same']);
    expect(previous.remoteKeys.has('turn.user')).toBe(true);
    expect(next.remoteKeys.size).toBe(0);
  });
});
