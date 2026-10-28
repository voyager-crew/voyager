/**
 * The usage status runtime: account-scoped usage cache, `/usage` scraping,
 * silent refresh and the pill, for one run that lasts until `signal` aborts.
 *
 * The official plugin runs it, and the plugin host only mounts it while the
 * `gvUsageStatusEnabled` switch is on, so a run never reads that switch. The
 * MAIN-world bridge (`public/usage-observer.js`) stays in core; a run only adds
 * and removes its isolated-world listener.
 */
import browser from 'webextension-polyfill';

import { LoggerService } from '@/core/services/LoggerService';
import { StorageKeys } from '@/core/types/common';
import { isExtensionContextInvalidatedError } from '@/core/utils/extensionContext';
import { getCurrentLanguage, initI18n, onCachedLanguageChange } from '@/utils/i18n';
import { type AppLanguage, localeFromLanguage } from '@/utils/language';

import { watchRouteChanges } from '../utils/routeWatcher';
import { rememberGeminiUsageRootAtStartup, resolveGeminiUsageRoot } from './usageDom';
import { formatResetLabel, hydrateUsageResetEpochs, scrapeUsageFromDocument } from './usageParsing';
import { createUsagePill } from './usagePill';
import { createUsageRefresh } from './usageRefresh';
import {
  isUsagePathname,
  mergeUsageSnapshots,
  selectUsageSnapshotForAccount,
  snapshotEquals,
  usageAccountKeyFromPathname,
  usageCacheKeyForAccount,
} from './usageSnapshot';
import type { UsageMetric, UsageSnapshot } from './usageSnapshot';

const SCRAPE_DEBOUNCE_MS = 300;
const SCRAPE_RETRY_MS = 500;
const NAVIGATION_SETTLE_MS = 250;

const logger = LoggerService.getInstance().createChild('UsageStatus');

type StorageChanges = Record<string, chrome.storage.StorageChange>;

/** The one running run; a second start is refused. */
let activeRun: object | null = null;
let runSerial = 0;

function isOnUsagePage(): boolean {
  return isUsagePathname(location.pathname);
}

function currentUsageAccountKey(): string {
  return usageAccountKeyFromPathname(location.pathname);
}

async function saveSnapshot(next: UsageSnapshot): Promise<void> {
  try {
    await browser.storage.local.set({
      [usageCacheKeyForAccount(next.accountKey ?? currentUsageAccountKey())]: next,
      [StorageKeys.GV_USAGE_CACHE]: next,
    });
  } catch (error) {
    // A reloaded extension can no longer write; the next run saves a fresh snapshot.
    if (isExtensionContextInvalidatedError(error)) return;
    console.warn('[UsageStatus] Failed to persist usage cache:', error);
  }
}

async function loadSnapshot(
  accountKey: string,
  locale: string | undefined,
): Promise<UsageSnapshot | null> {
  try {
    const scopedKey = usageCacheKeyForAccount(accountKey);
    const result = await browser.storage.local.get([scopedKey, StorageKeys.GV_USAGE_CACHE]);
    const selected = selectUsageSnapshotForAccount(
      (result as Record<string, unknown>)[scopedKey],
      (result as Record<string, unknown>)[StorageKeys.GV_USAGE_CACHE],
      accountKey,
    );
    return selected
      ? hydrateUsageResetEpochs(selected, Date.now(), [
          document.documentElement.lang,
          locale,
          'en',
          'zh-CN',
          'zh-TW',
        ])
      : null;
  } catch (error) {
    if (!isExtensionContextInvalidatedError(error)) {
      console.warn('[UsageStatus] Failed to load usage cache:', error);
    }
  }
  return null;
}

/**
 * Runs usage status until `signal` aborts. The promise settles once the run is
 * attached, or as soon as it learns it was stopped while reading storage.
 * Stopping removes the pill, listeners, observers and timers; it never deletes
 * the usage cache, recipe or pill position.
 */
export function startUsageStatusRuntime({ signal }: { signal: AbortSignal }): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  if (activeRun) {
    logger.error('Usage status is already running; the second start is ignored');
    return Promise.resolve();
  }
  rememberGeminiUsageRootAtStartup();
  const run = {};
  activeRun = run;
  const serial = ++runSerial;
  const isCurrent = (): boolean => activeRun === run;

  let initialized = false;
  let collecting = false;
  let languageRevision = 0;
  let recipeChangedLive = false;
  let liveRecipe: unknown;
  let positionChangedLive = false;
  let livePosition: unknown;
  let snapshot: UsageSnapshot | null = null;
  let snapshotRevision = 0;
  // BCP-47 locale for reset-time formatting, derived from the Voyager language.
  let uiLocale: string | undefined;

  // Routes invalidate delayed work, even when the account is unchanged.
  let routeEpoch = 0;
  let routeAccountKey = currentUsageAccountKey();

  let scrapeObserver: MutationObserver | null = null;
  let scrapeTimer: number | null = null;
  let scrapeRetryTimer: number | null = null;
  let navigationTimer: number | null = null;
  let stopRouteWatcher: (() => void) | null = null;
  let storageListener: ((changes: StorageChanges, areaName: string) => void) | null = null;
  let stopFollowingLanguage: (() => void) | null = null;

  const pill = createUsagePill(() => refresh.requestReplay(true));
  const refresh = createUsageRefresh(
    () => ({
      enabled: collecting && isCurrent(),
      snapshot,
      locale: uiLocale,
      generation: serial,
    }),
    (next) => {
      if (!isCurrent() || !collecting || next.accountKey !== currentUsageAccountKey()) return;
      snapshot = next;
      snapshotRevision += 1;
      void saveSnapshot(next);
      pill.render(true, snapshot);
    },
    pill.setSpinning,
  );

  function isCurrentRoute(epoch: number, accountKey: string): boolean {
    return isCurrent() && epoch === routeEpoch && accountKey === currentUsageAccountKey();
  }

  function scheduleScrape(epoch: number, accountKey: string): void {
    if (!collecting) return;
    if (scrapeTimer !== null) return;
    scrapeTimer = window.setTimeout(() => {
      scrapeTimer = null;
      // The route poller may not have seen an account switch yet: the DOM read
      // now could still be the previous account's /usage page.
      if (!collecting || !isCurrentRoute(epoch, accountKey) || !isOnUsagePage()) return;
      const next = scrapeUsageFromDocument();
      if (!next) return; // transient empty render — keep the last good snapshot
      snapshot = mergeUsageSnapshots(
        snapshot,
        { ...next, accountKey, sourceStartedAt: next.updatedAt, regressionVerified: true },
        { allowRegression: true },
      );
      snapshotRevision += 1;
      void saveSnapshot(snapshot);
      pill.render(true, snapshot);
    }, SCRAPE_DEBOUNCE_MS);
  }

  /**
   * Watch the `/usage` page of `accountKey` as of route `epoch`. The observer
   * and its retry keep that identity: reading the account again when the DOM
   * mutates would file the previous account's page under an account the route
   * poller has not noticed yet (pushState sends no popstate).
   */
  function setupScrapeObserver(epoch: number, accountKey: string): void {
    if (!collecting || !isCurrentRoute(epoch, accountKey) || !isOnUsagePage()) return;

    const root = resolveGeminiUsageRoot(document, 'observe');
    if (!root) {
      // Angular hasn't mounted the usage component yet; retry shortly.
      if (scrapeRetryTimer === null) {
        scrapeRetryTimer = window.setTimeout(() => {
          scrapeRetryTimer = null;
          setupScrapeObserver(epoch, accountKey);
        }, SCRAPE_RETRY_MS);
      }
      return;
    }
    if (scrapeRetryTimer !== null) {
      clearTimeout(scrapeRetryTimer);
      scrapeRetryTimer = null;
    }

    scheduleScrape(epoch, accountKey);
    scrapeObserver?.disconnect();
    scrapeObserver = new MutationObserver(() => scheduleScrape(epoch, accountKey));
    scrapeObserver.observe(root, { childList: true, subtree: true, characterData: true });
  }

  function teardownScrapeObserver(): void {
    scrapeObserver?.disconnect();
    scrapeObserver = null;
    if (scrapeTimer !== null) {
      clearTimeout(scrapeTimer);
      scrapeTimer = null;
    }
    if (scrapeRetryTimer !== null) {
      clearTimeout(scrapeRetryTimer);
      scrapeRetryTimer = null;
    }
  }

  function stopCollection(): void {
    collecting = false;
    teardownScrapeObserver();
    refresh.stop();
    if (navigationTimer !== null) {
      clearTimeout(navigationTimer);
      navigationTimer = null;
    }
  }

  function clearForeignSnapshot(accountKey: string): void {
    if (snapshot?.accountKey !== accountKey) snapshot = null;
  }

  function mergeCached(
    next: UsageSnapshot | null,
    accountKey: string,
    revisionAtRead: number,
  ): void {
    // Live cache changes can have equal timestamps; a pending read must not overwrite them.
    if (snapshot?.accountKey === accountKey && snapshotRevision !== revisionAtRead) return;
    clearForeignSnapshot(accountKey);
    if (next)
      snapshot = mergeUsageSnapshots(snapshot, next, {
        allowRegression: next.regressionVerified === true,
      });
  }

  function startCollection(epoch: number, accountKey: string): void {
    if (!initialized || !isCurrentRoute(epoch, accountKey)) return;
    pill.render(true, snapshot);
    collecting = true;
    refresh.start();
    refresh.setEnabled(true);
    if (isOnUsagePage()) setupScrapeObserver(epoch, accountKey);
  }

  async function reloadCache(epoch: number, accountKey: string): Promise<void> {
    const revisionAtRead = snapshotRevision;
    const next = await loadSnapshot(accountKey, uiLocale);
    if (!initialized || !isCurrentRoute(epoch, accountKey)) return;
    mergeCached(next, accountKey, revisionAtRead);
    startCollection(epoch, accountKey);
  }

  /** Re-localize a metric's reset label from its epoch (used on language change). */
  function reformatReset(m: UsageMetric): string {
    return typeof m.resetEpoch === 'number'
      ? formatResetLabel(m.resetEpoch, Date.now(), uiLocale)
      : m.resetLabel;
  }

  /** Re-localize reset dates and the pill's labels once a new language has loaded. */
  function relocalize(language: AppLanguage): void {
    if (!isCurrent()) return;
    languageRevision += 1;
    uiLocale = localeFromLanguage(language);
    if (snapshot) {
      // Reformat reset labels under the new locale.
      snapshot = {
        ...snapshot,
        daily: snapshot.daily
          ? { ...snapshot.daily, resetLabel: reformatReset(snapshot.daily) }
          : null,
        weekly: snapshot.weekly
          ? { ...snapshot.weekly, resetLabel: reformatReset(snapshot.weekly) }
          : null,
      };
    }
    if (initialized) pill.render(true, snapshot);
  }

  function setupStorageListener(): void {
    // The pill's labels come from getTranslationSync, which follows only a loaded language.
    stopFollowingLanguage = onCachedLanguageChange(relocalize);
    storageListener = (changes, areaName) => {
      const accountKey = currentUsageAccountKey();
      const usageCacheChange =
        areaName === 'local'
          ? (changes[usageCacheKeyForAccount(accountKey)] ?? changes[StorageKeys.GV_USAGE_CACHE])
          : null;
      if (usageCacheChange) {
        const raw = usageCacheChange.newValue as UsageSnapshot | undefined;
        if (raw && typeof raw.updatedAt === 'number' && raw.accountKey === accountKey) {
          const merged = mergeUsageSnapshots(snapshot, raw, {
            allowRegression: raw.regressionVerified === true,
          });
          if (collecting && !snapshotEquals(merged, raw)) void saveSnapshot(merged);
          snapshot = merged;
          snapshotRevision += 1;
          if (initialized) pill.render(true, snapshot);
        }
      }
      if (areaName === 'local' && changes[StorageKeys.GV_USAGE_RECIPE]) {
        // Another tab calibrated the recipe — adopt it so this tab can replay too.
        recipeChangedLive = true;
        liveRecipe = changes[StorageKeys.GV_USAGE_RECIPE].newValue;
        if (initialized) refresh.adoptRecipe(liveRecipe);
      }
      if (areaName === 'local' && changes[StorageKeys.GV_USAGE_POS]) {
        // Another tab moved the bar — mirror its placement.
        positionChangedLive = true;
        livePosition = changes[StorageKeys.GV_USAGE_POS].newValue;
        if (initialized) pill.adoptPosition(livePosition);
      }
    };
    browser.storage.onChanged.addListener(storageListener);
  }

  /** Reload the account's cache and re-aim the scraper once the route settles. */
  function handleNavigation(): void {
    if (!initialized) return;
    if (navigationTimer !== null) clearTimeout(navigationTimer);
    const epoch = routeEpoch;
    const accountKey = currentUsageAccountKey();
    navigationTimer = window.setTimeout(() => {
      navigationTimer = null;
      void reloadCache(epoch, accountKey);
    }, NAVIGATION_SETTLE_MS);
  }

  function handleRouteChange(): void {
    const accountKey = currentUsageAccountKey();
    // Invalidate old cache reads and scrapes before waiting for the destination page to settle.
    routeEpoch += 1;
    // Same-account navigation keeps the refresh engine: stopping it froze an in-flight spinner and dropped a post-generation refresh.
    if (accountKey !== routeAccountKey) {
      stopCollection();
      snapshot = null;
    } else {
      teardownScrapeObserver();
    }
    routeAccountKey = accountKey;
    pill.render(true, snapshot);
    handleNavigation();
  }

  signal.addEventListener(
    'abort',
    () => {
      if (!isCurrent()) return;
      activeRun = null;
      routeEpoch += 1;
      stopCollection();
      pill.remove();
      stopRouteWatcher?.();
      stopRouteWatcher = null;
      if (storageListener) {
        browser.storage.onChanged.removeListener(storageListener);
        storageListener = null;
      }
      stopFollowingLanguage?.();
      stopFollowingLanguage = null;
    },
    { once: true },
  );

  // Live cache and preference changes must win even while their startup reads are pending.
  setupStorageListener();

  return (async () => {
    // Ensure the language is resolved before the first render so labels and
    // reset dates localize correctly (no frozen English).
    try {
      const revision = languageRevision;
      await initI18n();
      const language = await getCurrentLanguage();
      if (!isCurrent()) return;
      if (revision === languageRevision) uiLocale = localeFromLanguage(language);
    } catch {
      // best-effort — English fallback is acceptable
    }
    if (!isCurrent()) return;

    const loadedAccountKey = currentUsageAccountKey();
    const loadedEpoch = routeEpoch;
    const loadedRevision = snapshotRevision;
    const loaded = await loadSnapshot(loadedAccountKey, uiLocale);
    if (!isCurrent()) return;
    await refresh.loadRecipe();
    if (!isCurrent()) return;
    await pill.loadPosition();
    if (!isCurrent()) return;

    // The route moved to another account during the reads: never show or merge
    // the previous account's cache here; the navigation below loads the right one.
    const cacheCurrent = isCurrentRoute(loadedEpoch, loadedAccountKey);
    if (cacheCurrent) mergeCached(loaded, loadedAccountKey, loadedRevision);
    else clearForeignSnapshot(currentUsageAccountKey());
    routeAccountKey = currentUsageAccountKey();

    if (recipeChangedLive) refresh.adoptRecipe(liveRecipe);
    if (positionChangedLive) pill.adoptPosition(livePosition);
    initialized = true;
    pill.render(true, snapshot);
    stopRouteWatcher = watchRouteChanges(handleRouteChange);
    if (cacheCurrent) startCollection(routeEpoch, routeAccountKey);
    else handleNavigation();
  })();
}
