import { getBundledGeminiTurnView, getGeminiBundledRevision } from '@/core/gemini/selectors/bundle';
import {
  GEMINI_TURN_PROFILE_KEYS,
  type GeminiSelectorFile,
  type GeminiSelectorHost,
  type GeminiTurnProfiles,
} from '@/core/gemini/selectors/types';
import { logger } from '@/core/services/LoggerService';
import { StorageKeys } from '@/core/types/common';
import { EXTENSION_VERSION } from '@/core/utils/version';
import { isGeminiSelectorHost } from '@/features/plugins/sites/hostPolicy';

import {
  type GeminiSelectorCacheEntry,
  clearGeminiSelectorCaches,
  geminiSelectorAttemptKey,
  geminiSelectorCacheKey,
  readCachedGeminiSelectorFile,
  readGeminiSelectorAttempt,
} from './cache';
import { isGeminiSelectorRemoteEnabledAtBuild } from './config';
import type {
  GeminiSelectorRefreshResult,
  GeminiSelectorResponse,
  GeminiSelectorStatus,
} from './messages';
import {
  GEMINI_SELECTOR_TIMEOUT_MS,
  geminiSelectorFileUrl,
  isGeminiSelectorCheckDue,
} from './policy';
import { readGeminiSelectorResponseBody } from './response';
import {
  type GeminiSelectorStorage,
  geminiSelectorStorage,
  isGeminiSelectorConsentEnabled,
  loadGeminiSelectorEnabled,
} from './settings';

export interface GeminiSelectorRefresherOptions {
  readonly storage?: GeminiSelectorStorage;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
  readonly extensionVersion?: string;
  readonly bundledRevision?: number;
  readonly buildEnabled?: boolean;
  readonly timeoutMs?: number;
}

interface Flight {
  readonly controller: AbortController;
  readonly promise: Promise<GeminiSelectorResponse>;
}

/** One background owner; no timer or caller can bypass the opt-in gate. */
export class GeminiSelectorRefresher {
  private readonly storage: GeminiSelectorStorage;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly extensionVersion: string;
  private readonly bundledRevision: number;
  private readonly buildEnabled: boolean;
  private readonly timeoutMs: number;
  private readonly inFlight = new Map<GeminiSelectorHost, Flight>();

  constructor(options: GeminiSelectorRefresherOptions = {}) {
    this.storage = options.storage ?? geminiSelectorStorage();
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
    this.now = options.now ?? (() => Date.now());
    this.extensionVersion = options.extensionVersion ?? EXTENSION_VERSION;
    this.bundledRevision = options.bundledRevision ?? getGeminiBundledRevision();
    this.buildEnabled = options.buildEnabled ?? isGeminiSelectorRemoteEnabledAtBuild();
    this.timeoutMs = options.timeoutMs ?? GEMINI_SELECTOR_TIMEOUT_MS;
  }

  async status(
    host: GeminiSelectorHost,
    result?: GeminiSelectorRefreshResult,
  ): Promise<GeminiSelectorStatus> {
    const cacheKey = geminiSelectorCacheKey(host);
    const attemptKey = geminiSelectorAttemptKey(host);
    const values = await this.storage.get([
      StorageKeys.GEMINI_SELECTOR_ONLINE_FIXES,
      cacheKey,
      attemptKey,
    ]);
    const enabled = isGeminiSelectorConsentEnabled(
      values[StorageKeys.GEMINI_SELECTOR_ONLINE_FIXES],
    );
    const file =
      enabled && this.buildEnabled
        ? readCachedGeminiSelectorFile(values[cacheKey], host, this.extensionVersion)
        : null;
    return {
      ok: true,
      enabled,
      buildEnabled: this.buildEnabled,
      cachedRevision:
        file && file.catalogRevision > this.bundledRevision ? file.catalogRevision : null,
      lastAttemptAt: readGeminiSelectorAttempt(values[attemptKey]),
      ...(result === undefined ? {} : { result }),
    };
  }

  abortAll(): void {
    for (const flight of this.inFlight.values()) flight.controller.abort();
    // Keep each slot until its final write settles, so an old cleanup cannot erase a newer pass.
  }

  async setEnabled(host: GeminiSelectorHost, enabled: boolean): Promise<GeminiSelectorStatus> {
    if (!enabled) {
      this.abortAll();
      await this.storage.set({ [StorageKeys.GEMINI_SELECTOR_ONLINE_FIXES]: false });
      // chrome.storage applies calls in order, so a later ON or cache write cannot precede this.
      await clearGeminiSelectorCaches(this.storage);
    } else {
      await this.storage.set({ [StorageKeys.GEMINI_SELECTOR_ONLINE_FIXES]: true });
    }
    return this.status(host);
  }

  /**
   * Worker start and consent storage events clear downloaded data unless consent is on now.
   * The stored value is re-read: a late OFF event must not abort a check a newer ON started.
   */
  async clearCachesUnlessEnabled(): Promise<void> {
    if (await loadGeminiSelectorEnabled(this.storage)) return;
    this.abortAll();
    await clearGeminiSelectorCaches(this.storage);
  }

  refresh(
    host: string,
    options: { readonly force?: boolean } = {},
  ): Promise<GeminiSelectorResponse> {
    if (!isGeminiSelectorHost(host))
      return Promise.resolve({ ok: false, error: 'invalid-request' });
    if (!this.buildEnabled) return this.status(host, 'disabled');
    const existing = this.inFlight.get(host);
    if (existing) return existing.promise;
    const controller = new AbortController();
    const promise = this.perform(host, options.force === true, controller)
      .catch((error: unknown): GeminiSelectorResponse => {
        logger.warn('Gemini selector refresh could not persist its state', {
          host,
          error: String(error),
        });
        return { ok: false, error: 'storage' };
      })
      .finally(() => {
        if (this.inFlight.get(host)?.controller === controller) this.inFlight.delete(host);
      });
    this.inFlight.set(host, { controller, promise });
    return promise;
  }

  private async perform(
    host: GeminiSelectorHost,
    force: boolean,
    controller: AbortController,
  ): Promise<GeminiSelectorStatus> {
    const state = await this.status(host);
    if (!state.enabled || controller.signal.aborted) return this.status(host, 'disabled');
    if (!force && !isGeminiSelectorCheckDue(state.lastAttemptAt, this.now())) {
      return this.status(host, 'notDue');
    }
    // Consent is checked again immediately before fetch; force only bypasses the due time.
    if (!(await loadGeminiSelectorEnabled(this.storage)) || controller.signal.aborted) {
      return this.status(host, 'disabled');
    }
    const attemptedAt = this.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    let result: GeminiSelectorRefreshResult = 'failed';
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(new Error('Gemini selector request was aborted'));
      controller.signal.addEventListener('abort', onAbort, { once: true });
      timer = setTimeout(() => controller.abort(), this.timeoutMs);
    });
    try {
      const file = await Promise.race([this.fetchFile(host, controller.signal), aborted]);
      if (timer !== undefined) clearTimeout(timer);
      result = await this.accept(host, file, controller.signal);
    } catch (error) {
      if (!controller.signal.aborted) {
        logger.warn('Gemini selector check failed', { host, error: String(error) });
      }
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (onAbort) controller.signal.removeEventListener('abort', onAbort);
      // Only completed attempts are persisted; a worker dying mid-fetch may retry once on restart.
      // The host's in-flight slot stays until this write settles, so OFF -> ON cannot start another.
      await this.storage.set({ [geminiSelectorAttemptKey(host)]: { lastAttemptAt: attemptedAt } });
    }
    if (!(await loadGeminiSelectorEnabled(this.storage))) result = 'disabled';
    return this.status(host, result);
  }

  private async fetchFile(
    host: GeminiSelectorHost,
    signal: AbortSignal,
  ): Promise<GeminiSelectorFile> {
    const response = await this.fetchImpl(geminiSelectorFileUrl(host), {
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      redirect: 'error',
      cache: 'no-cache',
      signal,
    });
    return readGeminiSelectorResponseBody(response, host, signal);
  }

  private async accept(
    host: GeminiSelectorHost,
    file: GeminiSelectorFile,
    signal: AbortSignal,
  ): Promise<GeminiSelectorRefreshResult> {
    const cacheKey = geminiSelectorCacheKey(host);
    const values = await this.storage.get([StorageKeys.GEMINI_SELECTOR_ONLINE_FIXES, cacheKey]);
    if (
      signal.aborted ||
      !isGeminiSelectorConsentEnabled(values[StorageKeys.GEMINI_SELECTOR_ONLINE_FIXES])
    ) {
      return 'disabled';
    }
    const previous = readCachedGeminiSelectorFile(values[cacheKey], host, this.extensionVersion);
    if (previous && file.catalogRevision < previous.catalogRevision) return 'failed';
    if (previous && file.catalogRevision === previous.catalogRevision) {
      return sameSelectors(previous, file) ? 'upToDate' : 'failed';
    }
    if (file.catalogRevision <= this.bundledRevision) return 'upToDate';
    const previousSelectors =
      previous && previous.catalogRevision > this.bundledRevision ? previous.selectors : {};
    const changed = !sameEffectiveSelectors(
      previousSelectors,
      file.selectors,
      getBundledGeminiTurnView().profiles,
    );
    const entry: GeminiSelectorCacheEntry = {
      format: 1,
      host,
      extensionVersion: this.extensionVersion,
      fetchedAt: this.now(),
      file,
    };
    await this.storage.set({ [cacheKey]: entry });
    // A queued storage write can finish after OFF removed the cache; discard that late result.
    if (signal.aborted || !(await loadGeminiSelectorEnabled(this.storage))) {
      await this.storage.remove(cacheKey);
      return 'disabled';
    }
    // Source revisions also advance for unrelated commits; only changed locators need a reload.
    return changed ? 'updated' : 'upToDate';
  }
}

function sameSelectors(left: GeminiSelectorFile, right: GeminiSelectorFile): boolean {
  const ordered = (file: GeminiSelectorFile) =>
    Object.entries(file.selectors).sort(([a], [b]) => a.localeCompare(b));
  return JSON.stringify(ordered(left)) === JSON.stringify(ordered(right));
}

function sameEffectiveSelectors(
  left: GeminiSelectorFile['selectors'],
  right: GeminiSelectorFile['selectors'],
  bundled: GeminiTurnProfiles,
): boolean {
  return GEMINI_TURN_PROFILE_KEYS.every((key) => {
    const before = left[key] ?? bundled[key];
    const after = right[key] ?? bundled[key];
    return (
      before.length === after.length && before.every((selector, index) => selector === after[index])
    );
  });
}
