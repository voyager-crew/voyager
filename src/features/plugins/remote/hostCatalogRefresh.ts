/**
 * HostCatalogRefresher — the ONLY network writer for the remote plugin catalog.
 *
 * Runs in the background. A content script or the popup sends
 * `PLUGIN_CATALOG_REFRESH_MESSAGE { host, force }`; this class decides whether
 * a request is due and, if so, fetches `<base>/hosts/<host>.json` at most once
 * per host at a time (single flight across every open tab), validates it and
 * writes the per-host cache entry.
 *
 * Gates, in order (a manual `force` skips only scheduling and page eligibility):
 *   1. build flag          — a build compiled without the remote channel never fetches;
 *   2. host shape          — only plain hostnames get a file name;
 *   3. user settings       — online-update switch, check interval, failure backoff,
 *                            writer-version staleness (hostCatalogPolicy);
 *   4. page eligibility    — at least one ENABLED plugin (bundled or already
 *                            cached remote) targets the host, or Gemini locator
 *                            profiles serve the native page. AI Studio stays excluded.
 *
 * Privacy: the request carries no cookies, no extension identifier and no
 * page content — only the host name in the path.
 */
import { logger } from '@/core/services/LoggerService';
import { EXTENSION_VERSION } from '@/core/utils/version';

import { isGeminiSelectorHost } from '../sites/hostPolicy';
import { siteAdapterToData } from '../sites/siteAdapterData';
import { listPluginManifests } from '../sources/defaultSources';
import { loadPluginState } from '../storage/pluginState';
import { isRemotePluginCatalogEnabledAtBuild, resolvePluginCatalogBaseUrl } from './config';
import {
  type HostCatalogCacheEntry,
  hostCatalogSignature,
  loadHostCatalogCache,
  saveHostCatalogCache,
} from './hostCatalogCache';
import {
  runHostCatalogCheck,
  subscribeCatalogUpdatesOff,
  type CatalogCheckPreparation,
  type CatalogCheckWrite,
} from './hostCatalogCheckMachine';
import { validateHostCatalogFile } from './hostCatalogFile';
import {
  decideHostCatalogRefresh,
  hasEnabledPluginForHost,
  hostCatalogFileUrl,
  isEligibleCatalogHost,
} from './hostCatalogPolicy';
import { type PluginCatalogSettings, loadPluginCatalogSettings } from './hostCatalogSettings';

export type HostCatalogRefreshStatus =
  | 'updated'
  | 'unchanged'
  | 'missing'
  | 'failed'
  | 'skipped'
  | 'ineligible'
  | 'invalid-host'
  | 'disabled';

export interface HostCatalogRefreshResult {
  readonly ok: true;
  readonly status: HostCatalogRefreshStatus;
  /** Skip reason or error text; diagnostic only. */
  readonly reason?: string;
  readonly checkedAt?: number;
}

export interface HostCatalogRefreshOptions {
  readonly force?: boolean;
}

export interface HostCatalogRefresherOptions {
  readonly baseUrl?: string;
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => number;
  readonly extensionVersion?: string;
  readonly enabled?: boolean;
  readonly loadSettings?: () => Promise<PluginCatalogSettings>;
  readonly loadEntry?: (host: string) => Promise<HostCatalogCacheEntry | null>;
  readonly saveEntry?: (entry: HostCatalogCacheEntry) => Promise<void>;
  readonly isHostEligible?: (host: string, entry: HostCatalogCacheEntry | null) => Promise<boolean>;
  /** Bound on one fetch including body parsing; defaults to 15 s. */
  readonly timeoutMs?: number;
  readonly subscribeOff?: (off: () => void) => () => void;
}

/**
 * Default page-eligibility check: an enabled plugin from the bundled snapshot
 * or from the host's own cached remote catalog targets `https://<host>/`.
 */
export async function defaultIsHostEligible(
  host: string,
  entry: HostCatalogCacheEntry | null,
): Promise<boolean> {
  if (isGeminiSelectorHost(host)) return true;
  const [snapshot, state] = await Promise.all([listPluginManifests(), loadPluginState()]);
  const manifests = entry?.status === 'ok' ? [...snapshot, ...entry.manifests] : snapshot;
  return hasEnabledPluginForHost(manifests, state, host);
}

/** A request that neither settles nor aborts would pin its host in `inFlight` forever. */
export const DEFAULT_HOST_CATALOG_TIMEOUT_MS = 15_000;

export class HostCatalogRefresher {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly extensionVersion: string;
  private readonly enabled: boolean;
  private readonly loadSettings: () => Promise<PluginCatalogSettings>;
  private readonly loadEntry: (host: string) => Promise<HostCatalogCacheEntry | null>;
  private readonly saveEntry: (entry: HostCatalogCacheEntry) => Promise<void>;
  private readonly isHostEligible: (
    host: string,
    entry: HostCatalogCacheEntry | null,
  ) => Promise<boolean>;
  private readonly inFlight = new Map<string, Promise<HostCatalogRefreshResult>>();
  private readonly timeoutMs: number;
  private readonly subscribeOff: (off: () => void) => () => void;

  constructor(options: HostCatalogRefresherOptions = {}) {
    this.baseUrl = options.baseUrl ?? resolvePluginCatalogBaseUrl();
    this.fetchImpl = options.fetchImpl ?? ((...args) => fetch(...args));
    this.now = options.now ?? (() => Date.now());
    this.extensionVersion = options.extensionVersion ?? EXTENSION_VERSION;
    this.enabled = options.enabled ?? isRemotePluginCatalogEnabledAtBuild();
    this.loadSettings = options.loadSettings ?? loadPluginCatalogSettings;
    this.loadEntry = options.loadEntry ?? loadHostCatalogCache;
    this.saveEntry = options.saveEntry ?? saveHostCatalogCache;
    this.isHostEligible = options.isHostEligible ?? defaultIsHostEligible;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_HOST_CATALOG_TIMEOUT_MS;
    this.subscribeOff = options.subscribeOff ?? subscribeCatalogUpdatesOff;
  }

  /** Single flight per host: concurrent callers share one network pass. */
  refresh(
    host: string,
    options: HostCatalogRefreshOptions = {},
  ): Promise<HostCatalogRefreshResult> {
    const normalized = typeof host === 'string' ? host.trim().toLowerCase() : '';
    if (!this.enabled) return Promise.resolve({ ok: true, status: 'disabled' });
    if (!isEligibleCatalogHost(normalized))
      return Promise.resolve({ ok: true, status: 'invalid-host' });

    const existing = this.inFlight.get(normalized);
    if (existing) return existing;
    const pass = this.perform(normalized, options.force === true).finally(() => {
      this.inFlight.delete(normalized);
    });
    this.inFlight.set(normalized, pass);
    return pass;
  }

  private perform(host: string, force: boolean): Promise<HostCatalogRefreshResult> {
    return runHostCatalogCheck({
      timeoutMs: this.timeoutMs,
      subscribeOff: this.subscribeOff,
      prepare: (signal) => this.prepare(host, force, signal),
      fetch: ({ entry, attemptedAt }, signal) =>
        this.fetchCandidate(host, entry, attemptedAt, signal),
      save: this.saveEntry,
      failure: ({ entry, attemptedAt }, reason) => {
        logger.warn('Host catalog refresh failed', { host, error: reason });
        return {
          entry: {
            host,
            status: entry?.status ?? 'unknown',
            manifests: entry?.status === 'ok' ? entry.manifests : [],
            fetchedAt: entry?.fetchedAt ?? 0,
            lastAttemptAt: attemptedAt,
            failureCount: (entry?.failureCount ?? 0) + 1,
            extensionVersion: entry?.extensionVersion || this.extensionVersion,
            ...(entry?.generatedAt ? { generatedAt: entry.generatedAt } : {}),
            ...(entry?.site ? { site: entry.site } : {}),
            ...(entry?.revoked ? { revoked: entry.revoked } : {}),
          },
          result: { ok: true, status: 'failed', reason, checkedAt: attemptedAt },
        };
      },
    });
  }

  private async prepare(
    host: string,
    force: boolean,
    signal: AbortSignal,
  ): Promise<CatalogCheckPreparation> {
    const disabled: CatalogCheckPreparation = {
      kind: 'settled',
      result: { ok: true, status: 'skipped', reason: 'disabled' },
    };
    const settings = await this.loadSettings();
    // Manual checks bypass scheduling, never the channel's off switch.
    if (signal.aborted || !settings.onlineUpdatesEnabled) return disabled;
    const entry = await this.loadEntry(host);
    if (signal.aborted) return disabled;
    if (!force) {
      const decision = decideHostCatalogRefresh({
        entry,
        now: this.now(),
        onlineUpdatesEnabled: settings.onlineUpdatesEnabled,
        interval: settings.checkInterval,
        extensionVersion: this.extensionVersion,
      });
      if (!decision.refresh)
        return {
          kind: 'settled',
          result: { ok: true, status: 'skipped', reason: decision.reason },
        };
      const eligible = await this.isHostEligible(host, entry);
      if (signal.aborted) return disabled;
      if (!eligible) return { kind: 'settled', result: { ok: true, status: 'ineligible' } };
    }
    return { kind: 'ready', context: { entry, attemptedAt: this.now() } };
  }

  /** Fetch and validate a candidate only; the machine owns permission to commit it. */
  private async fetchCandidate(
    host: string,
    entry: HostCatalogCacheEntry | null,
    now: number,
    signal: AbortSignal,
  ): Promise<CatalogCheckWrite> {
    const response = await this.fetchImpl(hostCatalogFileUrl(this.baseUrl, host), {
      cache: 'no-cache',
      credentials: 'omit',
      redirect: 'follow',
      signal,
    });
    if (response.status === 404) {
      return {
        entry: {
          host,
          status: 'missing',
          manifests: [],
          fetchedAt: now,
          lastAttemptAt: now,
          failureCount: 0,
          extensionVersion: this.extensionVersion,
        },
        result: { ok: true, status: 'missing', checkedAt: now },
      };
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const validation = validateHostCatalogFile(await response.json(), host);
    if (!validation) throw new Error('Unrecognized host catalog file');
    if (validation.issues.length > 0) {
      logger.warn('Host catalog: skipped invalid entries', {
        host,
        issues: validation.issues,
      });
    }
    if (validation.siteIssues.length > 0) {
      logger.warn('Host catalog: applied the site adapter without parts this build cannot read', {
        host,
        issues: validation.siteIssues,
      });
    }
    const next: HostCatalogCacheEntry = {
      host,
      status: 'ok',
      manifests: validation.manifests,
      ...(validation.revoked ? { revoked: validation.revoked } : {}),
      fetchedAt: now,
      lastAttemptAt: now,
      failureCount: 0,
      extensionVersion: this.extensionVersion,
      ...(validation.generatedAt ? { generatedAt: validation.generatedAt } : {}),
      ...(validation.site ? { site: siteAdapterToData(validation.site) } : {}),
    };
    const changed = hostCatalogSignature(entry) !== hostCatalogSignature(next);
    return {
      entry: next,
      result: { ok: true, status: changed ? 'updated' : 'unchanged', checkedAt: now },
    };
  }
}

/** Parse the runtime message payload; rejects anything but a plain host string. */
export function parseHostCatalogRefreshPayload(
  payload: unknown,
): { host: string; force: boolean } | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const host = (payload as { host?: unknown }).host;
  if (typeof host !== 'string') return null;
  return { host, force: (payload as { force?: unknown }).force === true };
}
