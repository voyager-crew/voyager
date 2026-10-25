import { getBundledGeminiTurnView, getGeminiBundledRevision } from '@/core/gemini/selectors/bundle';
import {
  GEMINI_TURN_PROFILE_KEYS,
  type GeminiSelectorFile,
  type GeminiSelectorHost,
  type GeminiTurnProfiles,
} from '@/core/gemini/selectors/types';
import { StorageKeys } from '@/core/types/common';
import { EXTENSION_VERSION } from '@/core/utils/version';
import { type Machine, startMachine } from '@/features/plugins/runtime/stateMachine';
import { isGeminiSelectorHost } from '@/features/plugins/sites/hostPolicy';

import {
  type GeminiSelectorCacheEntry,
  clearGeminiSelectorCaches,
  geminiSelectorAttemptKey,
  geminiSelectorCacheKey,
  readCachedGeminiSelectorFile,
  readGeminiSelectorAttempt,
} from './cache';
import {
  IDLE_CHECK,
  type SelectorCheckEvent,
  type SelectorCheckState,
  createSelectorCheckEffects,
  selectorCheckTransition,
} from './checkMachine';
import { isGeminiSelectorRemoteEnabledAtBuild } from './config';
import type {
  GeminiSelectorRefreshResult,
  GeminiSelectorResponse,
  GeminiSelectorStatus,
} from './messages';
import { GEMINI_SELECTOR_TIMEOUT_MS, geminiSelectorFileUrl } from './policy';
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

/** One background owner; no timer or caller can bypass the opt-in gate. */
export class GeminiSelectorRefresher {
  private readonly storage: GeminiSelectorStorage;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly extensionVersion: string;
  private readonly bundledRevision: number;
  private readonly buildEnabled: boolean;
  private readonly timeoutMs: number;
  private readonly checks = new Map<
    GeminiSelectorHost,
    Machine<SelectorCheckState, SelectorCheckEvent>
  >();

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

  /** Withdraws consent from every running check; each still saves its attempt time. */
  abortAll(): void {
    for (const check of this.checks.values()) check.send({ type: 'withdrawn' });
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
    const check = this.checkFor(host);
    return new Promise((reply) => {
      check.send({ type: 'check', force: options.force === true, reply });
    });
  }

  private checkFor(host: GeminiSelectorHost): Machine<SelectorCheckState, SelectorCheckEvent> {
    const existing = this.checks.get(host);
    if (existing) return existing;
    const check = startMachine<SelectorCheckState, SelectorCheckEvent>(
      {
        id: 'geminiSelectorCheck',
        transition: selectorCheckTransition,
        effects: createSelectorCheckEffects({
          timeoutMs: this.timeoutMs,
          now: this.now,
          status: (result) => this.status(host, result),
          isEnabled: () => loadGeminiSelectorEnabled(this.storage),
          fetchFile: (signal) => this.fetchFile(host, signal),
          commit: (file, withdrawn) => this.accept(host, file, withdrawn),
          recordAttempt: (attemptedAt) =>
            this.storage.set({ [geminiSelectorAttemptKey(host)]: { lastAttemptAt: attemptedAt } }),
        }),
      },
      IDLE_CHECK,
    );
    this.checks.set(host, check);
    return check;
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
    withdrawn: () => boolean,
  ): Promise<GeminiSelectorRefreshResult> {
    const cacheKey = geminiSelectorCacheKey(host);
    const values = await this.storage.get([StorageKeys.GEMINI_SELECTOR_ONLINE_FIXES, cacheKey]);
    if (
      withdrawn() ||
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
    if (withdrawn() || !(await loadGeminiSelectorEnabled(this.storage))) {
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
