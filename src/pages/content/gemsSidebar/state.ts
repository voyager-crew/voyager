import browser from 'webextension-polyfill';

import { StorageKeys } from '@/core/types/common';

import {
  DEFAULT_COUNT,
  type GemCacheEnvelope,
  type GemMetadata,
  type GemMruEntry,
  canPruneCatalogDeletes,
  catalogForAccount,
  clampCount,
  currentAccountSegment,
  deletedCatalogGemIds,
  gemItemsEqual,
  parseGemHref,
  readGemMetadata,
  sanitizePinnedIds,
  selectVisibleGems,
  upsertMru,
} from './catalog';
import type { GemsListSource } from './selectorQueries';

interface GemMruEnvelope {
  entries: GemMruEntry[];
}

const EXPANDED_STORAGE_KEY = 'gvGemsSidebarExpanded';
const MRU_CAPTURE_RETRY_MS = 400;
const MRU_CAPTURE_MAX_ATTEMPTS = 6;

/** Owns persisted data, settings, cross-tab changes and bounded page-identity capture. */
export function createGemsState(
  refreshInjector: () => void,
  refreshExpandedState: () => void,
  initialCount: unknown = DEFAULT_COUNT,
  signal?: AbortSignal,
) {
  let currentCount = clampCount(initialCount);
  let currentCache: GemCacheEnvelope = { items: [], cachedAt: 0 };
  let currentMru: GemMruEntry[] = [];
  let currentPinned: string[] = [];
  let expanded = true;
  let mruRetryTimer: number | null = null;
  let mruCaptureAttempts = 0;
  let stopped = false;
  const isStopped = () => stopped || signal?.aborted === true;
  let storageListener:
    | ((changes: Record<string, chrome.storage.StorageChange>, areaName: string) => void)
    | null = null;

  /**
   * Persists the scraped catalog, skipping the write when
   * nothing changed: every storage.local.set fans out through storage.onChanged
   * to every open Gemini tab, and the /gems/view observer re-scrapes on each
   * re-render — without this check a no-op scrape would broadcast a fresh
   * envelope (new cachedAt) to all tabs every time. `cachedAt` has no TTL
   * consumer, so not refreshing it is safe.
   */
  async function saveCache(
    items: GemMetadata[],
    source: GemsListSource = 'bundled',
  ): Promise<void> {
    if (isStopped()) return;
    const accountSegment = currentAccountSegment();
    if (
      currentCache.accountSegment === accountSegment &&
      gemItemsEqual(currentCache.items, items)
    ) {
      return;
    }
    const envelope: GemCacheEnvelope = { items, cachedAt: Date.now(), accountSegment };
    // A complete remotely located list can still be premade Gems, not the user's catalog.
    const deletedIds =
      source === 'bundled' && canPruneCatalogDeletes(currentCache.accountSegment, accountSegment)
        ? deletedCatalogGemIds(currentCache.items, items)
        : new Set();
    try {
      await browser.storage.local.set({ [StorageKeys.GV_GEMS_LIST_CACHE]: envelope });
      // An accepted storage write cannot be cancelled; never start its follow-up pruning after off.
      if (isStopped() || currentAccountSegment() !== accountSegment) return;
      currentCache = envelope;
      if (deletedIds.size > 0) {
        const nextMru = currentMru.filter((entry) => !deletedIds.has(entry.id));
        if (nextMru.length !== currentMru.length) {
          currentMru = nextMru;
          await saveMru(currentMru);
          if (isStopped() || currentAccountSegment() !== accountSegment) return;
        }

        const nextPinned = currentPinned.filter((id) => !deletedIds.has(id));
        if (nextPinned.length !== currentPinned.length) {
          currentPinned = nextPinned;
          await browser.storage.sync.set({ [StorageKeys.GV_GEMS_PINNED]: currentPinned });
        }
        if (!isStopped()) refreshInjector();
      }
    } catch (error) {
      console.warn('[GemsSidebar] Failed to persist gems cache:', error);
    }
  }

  async function loadCache(): Promise<GemCacheEnvelope> {
    try {
      const result = await browser.storage.local.get(StorageKeys.GV_GEMS_LIST_CACHE);
      const raw = (result as Record<string, unknown>)[StorageKeys.GV_GEMS_LIST_CACHE];
      if (raw && typeof raw === 'object' && Array.isArray((raw as GemCacheEnvelope).items)) {
        return raw as GemCacheEnvelope;
      }
    } catch (error) {
      console.warn('[GemsSidebar] Failed to load gems cache:', error);
    }
    return { items: [], cachedAt: 0 };
  }

  // -----------------------------------------------------------------------------
  // MRU (recently-used) tracking
  // -----------------------------------------------------------------------------

  async function loadMru(): Promise<GemMruEntry[]> {
    try {
      const result = await browser.storage.local.get(StorageKeys.GV_GEMS_MRU);
      const raw = (result as Record<string, unknown>)[StorageKeys.GV_GEMS_MRU];
      if (raw && typeof raw === 'object' && Array.isArray((raw as GemMruEnvelope).entries)) {
        return (raw as GemMruEnvelope).entries.filter(
          (e): e is GemMruEntry =>
            !!e && typeof e.id === 'string' && typeof e.lastUsedAt === 'number',
        );
      }
    } catch (error) {
      console.warn('[GemsSidebar] Failed to load gems MRU:', error);
    }
    return [];
  }

  async function saveMru(entries: GemMruEntry[]): Promise<void> {
    if (isStopped()) return;
    try {
      await browser.storage.local.set({ [StorageKeys.GV_GEMS_MRU]: { entries } });
    } catch (error) {
      console.warn('[GemsSidebar] Failed to persist gems MRU:', error);
    }
  }

  function clearMruRetry(): void {
    if (mruRetryTimer !== null) {
      clearTimeout(mruRetryTimer);
      mruRetryTimer = null;
    }
    mruCaptureAttempts = 0;
  }

  /**
   * If we're on a `/gem/<id>` page, record that gem as just-used (and capture its
   * name/icon for the sidebar). The hero renders async, so retry a few times
   * before giving up. No-op when the feature is disabled or we're not on a gem
   * page.
   */
  function recordGemUsageFromPage(): void {
    if (isStopped() || currentCount <= 0) return;
    if (!parseGemHref(location.pathname)) {
      clearMruRetry();
      return;
    }

    const meta = readGemMetadata(location.pathname);
    if (!meta) {
      if (mruCaptureAttempts < MRU_CAPTURE_MAX_ATTEMPTS && mruRetryTimer === null) {
        mruRetryTimer = window.setTimeout(() => {
          mruRetryTimer = null;
          mruCaptureAttempts += 1;
          recordGemUsageFromPage();
        }, MRU_CAPTURE_RETRY_MS);
      }
      return;
    }

    clearMruRetry();
    // Already front-of-list with identical metadata? Skip the write — inside a
    // gem, every conversation switch re-runs this capture, and rewriting an
    // unchanged MRU just broadcasts storage.onChanged to every open tab.
    // lastUsedAt stays stale in that case, which is fine: the entry is already
    // ranked first and the ordering can't change until another gem is used.
    const head = currentMru[0];
    if (
      head &&
      head.id === meta.id &&
      head.href === meta.href &&
      head.name === meta.name &&
      head.iconLetter === meta.iconLetter
    ) {
      return;
    }
    currentMru = upsertMru(currentMru, meta, Date.now());
    void saveMru(currentMru);
    refreshInjector();
  }

  async function toggleExpanded(): Promise<void> {
    if (isStopped()) return;
    expanded = !expanded;
    refreshExpandedState();
    try {
      await browser.storage.local.set({ [EXPANDED_STORAGE_KEY]: expanded });
    } catch (error) {
      console.warn('[GemsSidebar] Failed to persist expanded state:', error);
    }
  }

  /** Gems to render: pinned first (pinned order), then recent up to the count. */
  function visibleGems(): GemMetadata[] {
    const catalog = catalogForAccount(currentCache, currentAccountSegment());
    return selectVisibleGems(currentPinned, currentMru, catalog, currentCount);
  }

  async function loadInitialState(): Promise<void> {
    try {
      const sync = await browser.storage.sync.get({
        [StorageKeys.GV_GEMS_PINNED]: [],
      });
      if (isStopped()) return;
      currentPinned = sanitizePinnedIds(sync[StorageKeys.GV_GEMS_PINNED]);
    } catch (error) {
      console.warn('[GemsSidebar] Failed to load pinned gems:', error);
      if (isStopped()) return;
      currentPinned = [];
    }

    try {
      const local = await browser.storage.local.get({ [EXPANDED_STORAGE_KEY]: true });
      if (isStopped()) return;
      expanded = (local as Record<string, unknown>)[EXPANDED_STORAGE_KEY] !== false;
    } catch {
      expanded = true;
    }

    if (isStopped()) return;
    const cache = await loadCache();
    if (isStopped()) return;
    currentCache = cache;
    const mru = await loadMru();
    if (!isStopped()) currentMru = mru;
  }

  function setupStorageListener(): void {
    if (isStopped()) return;
    storageListener = (changes, areaName) => {
      if (isStopped()) return;
      if (areaName === 'sync' && changes[StorageKeys.GV_GEMS_PINNED]) {
        currentPinned = sanitizePinnedIds(changes[StorageKeys.GV_GEMS_PINNED].newValue);
        refreshInjector();
      }
      if (areaName === 'local' && changes[StorageKeys.GV_GEMS_LIST_CACHE]) {
        const raw = changes[StorageKeys.GV_GEMS_LIST_CACHE].newValue as
          | GemCacheEnvelope
          | undefined;
        if (raw && Array.isArray(raw.items)) {
          currentCache = raw;
          refreshInjector();
        }
      }
      if (areaName === 'local' && changes[StorageKeys.GV_GEMS_MRU]) {
        // Cross-tab sync: another tab opened a gem.
        const raw = changes[StorageKeys.GV_GEMS_MRU].newValue as GemMruEnvelope | undefined;
        if (raw && Array.isArray(raw.entries)) {
          currentMru = raw.entries;
          refreshInjector();
        }
      }
      if (areaName === 'local' && changes[EXPANDED_STORAGE_KEY]) {
        // Cross-tab sync: another tab toggled the chevron.
        const next = changes[EXPANDED_STORAGE_KEY].newValue !== false;
        if (next !== expanded) {
          expanded = next;
          refreshExpandedState();
        }
      }
    };
    browser.storage.onChanged.addListener(storageListener);
  }

  return {
    load: loadInitialState,
    setCount(value: unknown) {
      if (isStopped()) return;
      const next = clampCount(value);
      if (next === currentCount) return;
      currentCount = next;
      refreshInjector();
    },
    watch: setupStorageListener,
    saveCache,
    recordUsage: recordGemUsageFromPage,
    toggleExpanded,
    visible: visibleGems,
    get count() {
      return currentCount;
    },
    get expanded() {
      return expanded;
    },
    stop() {
      stopped = true;
      clearMruRetry();
      if (storageListener) {
        browser.storage.onChanged.removeListener(storageListener);
        storageListener = null;
      }
    },
  };
}
