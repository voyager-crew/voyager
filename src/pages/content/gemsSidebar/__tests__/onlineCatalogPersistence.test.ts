import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import browser from 'webextension-polyfill';

import { StorageKeys } from '@/core/types/common';

import { installGeminiSelectorPatch } from '../../__tests__/geminiOnlineSelectorFixture';
import { createGemsScraper } from '../scraper';
import { createGemsState } from '../state';

vi.mock('webextension-polyfill', () => ({
  default: {
    storage: {
      local: { get: vi.fn(), set: vi.fn() },
      sync: { get: vi.fn(), set: vi.fn() },
      onChanged: { addListener: vi.fn(), removeListener: vi.fn() },
    },
  },
}));

const owned = { id: 'owned', name: 'My Gem', href: '/gem/owned', lastUsedAt: 1 };
const premade = { id: 'premade', name: 'Premade Gem', href: '/gem/premade' };

function mountList(bundled: boolean): void {
  document.body.innerHTML = `<section class="gems-list" ${bundled ? 'data-test-id="your-gems-list"' : ''}>
    <bot-list-row><a class="bot-row" href="/gem/premade">
      <span class="title-container">Premade Gem</span>
    </a></bot-list-row>
  </section>`;
}

describe('Gems catalog persistence after online repair', () => {
  let stopPatch: (() => void) | undefined;
  let state: ReturnType<typeof createGemsState>;
  let scraper: ReturnType<typeof createGemsScraper> | undefined;
  let local: Record<string, unknown>;
  let sync: Record<string, unknown>;

  beforeEach(async () => {
    vi.useFakeTimers();
    window.history.pushState({}, '', '/u/1/gems/view');
    local = {
      [StorageKeys.GV_GEMS_LIST_CACHE]: { items: [owned], cachedAt: 1, accountSegment: '/u/1' },
      [StorageKeys.GV_GEMS_MRU]: { entries: [owned] },
    };
    sync = { [StorageKeys.GV_GEMS_PINNED]: ['owned'] };
    vi.mocked(browser.storage.local.get).mockImplementation(async () => local);
    vi.mocked(browser.storage.sync.get).mockImplementation(async () => sync);
    vi.mocked(browser.storage.local.set).mockImplementation(async (items) => {
      Object.assign(local, items);
    });
    vi.mocked(browser.storage.sync.set).mockImplementation(async (items) => {
      Object.assign(sync, items);
    });
    state = createGemsState(
      () => {},
      () => {},
    );
    await state.load();
    vi.mocked(browser.storage.local.set).mockClear();
    vi.mocked(browser.storage.sync.set).mockClear();
  });

  afterEach(() => {
    scraper?.stop();
    scraper = undefined;
    state.stop();
    stopPatch?.();
    stopPatch = undefined;
    document.body.replaceChildren();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function scrape(): Promise<void> {
    scraper = createGemsScraper(state.saveCache, async () => {});
    scraper.start();
    await vi.advanceTimersByTimeAsync(300);
  }

  it('keeps synced pins and MRU when the repaired list is premade Gems before Your Gems renders', async () => {
    mountList(false);
    stopPatch = await installGeminiSelectorPatch({ 'gems.list': ['.gems-list'] });
    await scrape();

    expect(local[StorageKeys.GV_GEMS_LIST_CACHE]).toMatchObject({ items: [premade] });
    expect(local[StorageKeys.GV_GEMS_MRU]).toEqual({ entries: [owned] });
    expect(sync[StorageKeys.GV_GEMS_PINNED]).toEqual(['owned']);
    expect(state.visible()).toEqual([owned, premade]);
  });

  it('leaves saved Gems untouched while the bundled Your Gems list has not rendered', async () => {
    mountList(false);
    await scrape();
    expect(local[StorageKeys.GV_GEMS_LIST_CACHE]).toMatchObject({ items: [owned] });
    expect(local[StorageKeys.GV_GEMS_MRU]).toEqual({ entries: [owned] });
    expect(sync[StorageKeys.GV_GEMS_PINNED]).toEqual(['owned']);
    expect(browser.storage.local.set).not.toHaveBeenCalled();
    expect(browser.storage.sync.set).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'still prunes deleted personal Gems through the bundled list (remote rejected: %s)',
    async (remote) => {
      mountList(true);
      if (remote) stopPatch = await installGeminiSelectorPatch({ 'gems.list': ['.missing-list'] });
      await scrape();
      expect(local[StorageKeys.GV_GEMS_LIST_CACHE]).toMatchObject({ items: [premade] });
      expect(local[StorageKeys.GV_GEMS_MRU]).toEqual({ entries: [] });
      expect(sync[StorageKeys.GV_GEMS_PINNED]).toEqual([]);
    },
  );
});
