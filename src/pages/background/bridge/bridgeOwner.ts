/**
 * Local Bridge owner in the background (spec §2.6, §3.1): wires the pieces,
 * runs the long poll against `voyager serve`, and answers the popup.
 *
 * Listeners are registered synchronously at worker start, as every owner here
 * does. Every handler first awaits `ready` (the session state has been read
 * back), so a message that wakes a fresh worker is judged against the stored
 * task, never against empty memory.
 *
 * The poll loop runs while the builtin is on, a pairing exists and the
 * 127.0.0.1 permission is granted. It keeps polling when the policy denies, so
 * the server can tell `voyager` callers why (`policy-denied` / `policy-stale`)
 * instead of reporting the extension offline; tasks are then refused one by
 * one. The `gv-bridge-wake` alarm restarts the loop after the worker was
 * stopped, and takes over after the unreachable-server backoff reaches 60 s.
 */
import { logger } from '@/core/services/LoggerService';
import { StorageKeys } from '@/core/types/common';
import { EXTENSION_VERSION } from '@/core/utils/version';
import { DEFAULT_PARALLEL_JOBS } from '@/features/bridge/parallelJobs';
import {
  type BridgeBrowser,
  type ErrorCode,
  OP_VERSIONS,
  bridgeError,
  type OpCapability,
  type OpName,
  isPolicyExemptOp,
} from '@/features/bridge/protocol';
import { BUNDLED_SITE_ADAPTERS } from '@/features/plugins/catalog/sites';
import {
  hostCatalogStorageKey,
  loadHostCatalogCache,
} from '@/features/plugins/remote/hostCatalogCache';
import type { HostCatalogRefreshResult } from '@/features/plugins/remote/hostCatalogRefresh';
import { isPluginEnabled } from '@/features/plugins/storage/pluginDefaults';

import { createBlobRelay } from './bridgeBlobRelay';
import { createBlobUploadRelay } from './bridgeBlobUpload';
import { createBridgeClient } from './bridgeClient';
import { SUPPORTED_BRIDGE_OPS, createBridgeDispatcher } from './bridgeDispatcher';
import { createLeaseProbe } from './bridgeLeaseProbe';
import { createBridgePairing, parsePairing } from './bridgePairing';
import {
  PARALLEL_CHANGE_RULE,
  parallelJobsOf,
  parseParallelChange,
  readBridgeParallel,
  writeBridgeParallel,
} from './bridgeParallel';
import {
  BRIDGE_PLUGIN_ID,
  BRIDGE_POLICY_HOST,
  LOOPBACK_ORIGIN_PATTERN,
  createBridgePolicy,
} from './bridgePolicy';
import { isUpgradeSide, policyLabel, readPolledAccount, refusedOps } from './bridgePollReplies';
import {
  type BridgeMessageOwner,
  type BridgeStatusData,
  createBridgeRuntimeMessageHandler,
} from './bridgeRuntimeMessages';
import { type TabsApi, createBridgeTabs } from './bridgeTabs';
import { type StorageAreaLike, createBridgeTaskStore } from './bridgeTaskStore';
import { createCatalogRefreshRunner } from './catalogRefreshOp';
import { createPageLeaseArbiter } from './pageLease';

export const BRIDGE_WAKE_ALARM = 'gv-bridge-wake';
const BACKOFF_START_MS = 5_000;
const BACKOFF_MAX_MS = 60_000;

export interface BridgeOwnerEnv {
  readonly session: StorageAreaLike;
  readonly local: StorageAreaLike;
  readonly tabs: TabsApi;
  readonly fetch: typeof fetch;
  readonly hasOrigin: (pattern: string) => Promise<boolean>;
  readonly refreshCatalog: () => Promise<unknown>;
  /** A forced catalog check of any host, for the `catalog.refresh` op. */
  readonly refreshCatalogNow: (host: string) => Promise<HostCatalogRefreshResult>;
  readonly loadOnlineUpdatesEnabled: () => Promise<boolean>;
  /** Write the "plugin online updates" switch the catalog refresher obeys. */
  readonly saveOnlineUpdatesEnabled: (enabled: boolean) => Promise<void>;
  readonly alarms?: {
    get(name: string): Promise<unknown>;
    create(name: string, info: { periodInMinutes: number }): Promise<void> | void;
    clear(name: string): Promise<unknown>;
  };
  readonly browser: BridgeBrowser;
  readonly now?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface BridgeOwner {
  readonly handleMessage: (
    message: unknown,
    sender: chrome.runtime.MessageSender,
  ) => Promise<unknown> | null;
  /** Start the poll loop when its conditions hold (alarm, startup, grants). */
  wake(): Promise<void>;
  onAlarm(name: string): void;
  onStorageChanged(changes: Record<string, chrome.storage.StorageChange>, area: string): void;
  onPermissionsAdded(origins: readonly string[] | undefined): void;
  onPermissionsRemoved(): void;
  onTabRemoved(tabId: number): void;
  /** Resolves when the current poll loop has exited (tests). */
  idle(): Promise<void>;
}

export function createBridgeOwner(env: BridgeOwnerEnv): BridgeOwner {
  const now = env.now ?? (() => Date.now());
  const sleep = env.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const store = createBridgeTaskStore({ session: env.session, local: env.local });
  const client = createBridgeClient(env.fetch);
  const tabs = createBridgeTabs({ store, api: env.tabs, now });
  // Hydrate: read the session state back before any handler acts on it.
  const ready = Promise.all([store.listTasks(), store.listTabs()]).then(
    () => undefined,
    (error: unknown) => logger.warn('Bridge session state unreadable', { error: String(error) }),
  );
  const awaitReady = () => ready;

  const probe = createLeaseProbe(tabs, env.tabs);
  const lease = createPageLeaseArbiter({ area: env.session, ready: awaitReady, probe, now });
  const policy = createBridgePolicy({
    local: env.local,
    loadEntry: () => loadHostCatalogCache(BRIDGE_POLICY_HOST),
    packaged: BUNDLED_SITE_ADAPTERS.find((site) => site.id === 'chatgpt') ?? null,
    extensionVersion: EXTENSION_VERSION,
    hasOrigin: env.hasOrigin,
    refreshCatalog: env.refreshCatalog,
    loadOnlineUpdatesEnabled: env.loadOnlineUpdatesEnabled,
    now,
    neverExpires: import.meta.env.VOYAGER_DEV_BRIDGE_POLICY_NO_EXPIRY,
  });

  let server: BridgeStatusData['server'] = 'unknown';
  let lastPollAt: number | undefined;
  let lastError: BridgeStatusData['lastError'];
  const noteError = (error: {
    readonly code: ErrorCode;
    readonly details?: Readonly<Record<string, unknown>>;
  }) => {
    const upgrade = error.details?.upgrade;
    lastError = isUpgradeSide(upgrade) ? { code: error.code, upgrade } : { code: error.code };
  };

  const pairing = createBridgePairing({
    local: env.local,
    session: env.session,
    client,
    browser: env.browser,
    hasLoopbackPermission: () => env.hasOrigin(LOOPBACK_ORIGIN_PATTERN).catch(() => false),
    onPaired: () => {
      lastError = undefined;
      void policy.refresh().then(() => wake());
    },
    now,
  });
  const connection = () => pairing.load();
  const dispatcher = createBridgeDispatcher({
    store,
    lease,
    policy,
    tabs,
    client,
    connection,
    ready: awaitReady,
    refreshCatalog: createCatalogRefreshRunner({
      refresh: env.refreshCatalogNow,
      loadEntry: loadHostCatalogCache,
      extensionVersion: EXTENSION_VERSION,
    }),
    parallelJobs: async () => parallelJobsOf(await readBridgeParallel(env.local)),
    now,
  });
  const blobRelay = createBlobRelay({ store, client, connection, ready: awaitReady, now });
  const blobUpload = createBlobUploadRelay({ store, client, connection, ready: awaitReady, now });

  let loopGeneration = 0;
  let loop: Promise<void> | null = null;
  let loopRunsGeneration = -1;
  let pollAbort: AbortController | null = null;

  const ensureAlarm = async () => {
    try {
      if (env.alarms && !(await env.alarms.get(BRIDGE_WAKE_ALARM))) {
        await env.alarms.create(BRIDGE_WAKE_ALARM, { periodInMinutes: 1 });
      }
    } catch {
      // Without the alarm the loop still runs; it only cannot restart a stopped worker.
    }
  };
  const clearAlarm = () => void env.alarms?.clear(BRIDGE_WAKE_ALARM)?.catch(() => undefined);

  const stop = () => {
    loopGeneration += 1;
    pollAbort?.abort();
  };

  const runLoop = async (generation: number): Promise<void> => {
    await ready;
    let backoff = 0;
    /** Ops this serve refused to hear of: an older CLI rejects a poll naming an op it does not know. */
    let unknownToServer = new Set<OpName>();
    while (generation === loopGeneration) {
      const record = await pairing.load();
      if (!record) return;
      const gate = await policy.status();
      if (!gate.enabled || !gate.permissions.loopback) return;
      await ensureAlarm();
      await dispatcher.drainOutbox();
      const verdict = gate.verdict;
      const allowed = verdict.state === 'allowed' ? verdict.allow : [];
      // Offered under a denying policy too: they are how a stale or broken policy gets fixed.
      const ops: OpCapability[] = [...SUPPORTED_BRIDGE_OPS]
        .filter((op) => isPolicyExemptOp(op) || (gate.permissions.chatgpt && allowed.includes(op)))
        .filter((op) => !unknownToServer.has(op))
        .map((name) => ({ name, v: OP_VERSIONS[name] }));
      pollAbort = new AbortController();
      const reply = await client.poll(
        record,
        {
          capabilities: { ops },
          inflight: await dispatcher.inflight(),
          policy: { revision: verdict.revision ?? 0, state: policyLabel(verdict) },
          account: await readPolledAccount(env.local),
          maxTasks: await dispatcher.capacity(),
        },
        pollAbort.signal,
      );
      pollAbort = null;
      if (generation !== loopGeneration) return;
      if (!reply.ok) {
        if (reply.error.code === 'cancelled') return;
        const refused = refusedOps(reply.error, ops);
        if (refused.length > 0) {
          // CLI 0.1.0 drops the whole poll over one new op: offer the rest without it.
          unknownToServer = new Set([...unknownToServer, ...refused]);
          continue;
        }
        noteError(reply.error);
        if (reply.error.code !== 'server-unreachable') {
          server = 'online';
          return; // unauthorized or protocol-mismatch: wait for the person
        }
        server = 'offline';
        // The serve that comes back may be a newer one.
        unknownToServer = new Set();
        backoff = backoff === 0 ? BACKOFF_START_MS : backoff * 2;
        if (backoff > BACKOFF_MAX_MS) return; // the wake alarm takes over
        await sleep(backoff);
        continue;
      }
      server = 'online';
      lastPollAt = now();
      lastError = undefined;
      backoff = 0;
      const message = reply.data;
      if (!message) continue;
      if (message.kind === 'unpaired') {
        await dispatcher.stopAll('not-paired', 'voyager serve dropped this pairing.');
        await pairing.forget();
        await store.clearOutbox();
        return;
      }
      // Tagged with the pairing this poll used: a reply of a replaced pairing runs nothing.
      if (message.kind === 'abort')
        await dispatcher.onAbort(message.taskId, message.reason, record);
      else await dispatcher.onTask(message.task, record);
    }
  };

  const wake = async (): Promise<void> => {
    // A loop told to stop may still be finishing its poll; start the next one after it.
    if (loop && loopRunsGeneration !== loopGeneration) return loop.then(() => wake());
    if (loop) return loop;
    const generation = loopGeneration;
    loopRunsGeneration = generation;
    loop = runLoop(generation)
      .catch((error: unknown) => logger.warn('Bridge poll loop stopped', { error: String(error) }))
      .finally(() => {
        loop = null;
      });
    return loop;
  };

  const shutDown = async (code: 'bridge-disabled' | 'not-paired', message: string) => {
    stop();
    clearAlarm();
    // The stopped tasks' results get their one delivery try first.
    await dispatcher.stopAll(code, message);
    // Results wait only for the server they belong to; reply text must not outlive the pairing.
    await store.clearOutbox();
  };

  const status = async (): Promise<BridgeStatusData> => {
    const [record, gate, tasks, parallel] = await Promise.all([
      pairing.load(),
      policy.status(),
      dispatcher.tasks(),
      readBridgeParallel(env.local),
    ]);
    return {
      permission: gate.permissions.loopback,
      paired: record
        ? { serverId: record.serverId, port: record.port, pairedAt: record.pairedAt }
        : null,
      server: record ? server : 'unknown',
      ...(lastPollAt !== undefined ? { lastPollAt } : {}),
      policy: policyLabel(gate.verdict),
      onlineUpdatesEnabled: gate.onlineUpdatesEnabled,
      parallel: parallel.enabled,
      parallelJobs: parallel.jobs,
      activeTasks: tasks.map((task) => ({ jobId: task.jobId, op: task.op })),
      ...(lastError ? { lastError } : {}),
    };
  };

  const pairReply = (attempt: ReturnType<typeof pairing.lastAttempt>) => {
    if (attempt.state === 'failed') {
      noteError(attempt.error);
      return { ok: false as const, error: attempt.error };
    }
    return { ok: true as const, data: { pending: attempt.state === 'pending' } };
  };

  const messageOwner: BridgeMessageOwner = {
    status: async () => {
      try {
        return { ok: true, data: await status() };
      } catch (error) {
        logger.warn('Bridge status failed', { error: String(error) });
        return {
          ok: true,
          data: {
            permission: false,
            paired: null,
            server: 'unknown',
            policy: 'unknown',
            onlineUpdatesEnabled: true,
            parallel: false,
            parallelJobs: DEFAULT_PARALLEL_JOBS,
            activeTasks: [],
          },
        };
      }
    },
    pairIntent: async (port, code) => pairReply(await pairing.recordIntent({ port, code })),
    pair: async (port, code) => {
      const attempt = await pairing.pair({ port, code });
      if (attempt.state !== 'paired') return pairReply(attempt);
      const record = await pairing.load();
      return { ok: true, data: record ? { serverId: record.serverId } : {} };
    },
    unpair: async () => {
      await shutDown('not-paired', 'The bridge was unpaired.');
      await pairing.unpair();
      lastError = undefined;
      return { ok: true, data: { unpaired: true } };
    },
    enableRefresh: async () => {
      // The refresher obeys the switch, so it has to be on before the check can run.
      try {
        await env.saveOnlineUpdatesEnabled(true);
      } catch (error) {
        logger.warn('Bridge could not turn on online plugin updates', { error: String(error) });
        return {
          ok: false,
          error: bridgeError('policy-stale', 'Online plugin updates could not be turned on.'),
        };
      }
      await policy.refresh();
      void wake();
      return { ok: true, data: { policy: policyLabel((await policy.status()).verdict) } };
    },
    setParallel: async (enabled, jobs) => {
      const change = parseParallelChange(enabled, jobs);
      if (!change) {
        return { ok: false, error: bridgeError('bad-request', PARALLEL_CHANGE_RULE) };
      }
      await writeBridgeParallel(env.local, change);
      // Poll again now, so the server hears the new capacity instead of after its hold.
      stop();
      void wake();
      const kept = await readBridgeParallel(env.local);
      return { ok: true, data: { parallel: kept.enabled, parallelJobs: kept.jobs } };
    },
    hello: (sender, docNonce) => dispatcher.onHello(sender, docNonce),
    progress: (sender, message) => dispatcher.onProgress(sender, message),
    done: (sender, message) => dispatcher.onDone(sender, message),
    blobRead: (sender, message) => blobRelay.read(sender, message),
    blobCreate: (sender, message) => blobUpload.create(sender, message),
    blobWrite: (sender, message) => blobUpload.write(sender, message),
    blobCommit: (sender, message) => blobUpload.commit(sender, message),
  };

  const catalogKey = hostCatalogStorageKey(BRIDGE_POLICY_HOST);
  const enabledIn = (value: unknown): boolean =>
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? isPluginEnabled(value as Record<string, { enabled?: unknown }>, BRIDGE_PLUGIN_ID)
      : isPluginEnabled({}, BRIDGE_PLUGIN_ID);

  // Every tab the browser closes lands in `onTabRemoved`: while unpaired or off, skip its
  // session reads. A tab record or lease left behind is replaced or probed away later.
  let engaged: Promise<boolean> | null = null;
  const isEngaged = (): Promise<boolean> =>
    (engaged ??= env.local
      .get([StorageKeys.BRIDGE_PAIRING, StorageKeys.PLUGINS_STATE])
      .then(
        (values) =>
          parsePairing(values[StorageKeys.BRIDGE_PAIRING]) !== null &&
          enabledIn(values[StorageKeys.PLUGINS_STATE]),
      )
      .catch(() => {
        engaged = null;
        return true;
      }));

  return {
    handleMessage: createBridgeRuntimeMessageHandler(messageOwner),
    wake,
    onAlarm: (name) => {
      if (name !== BRIDGE_WAKE_ALARM) return;
      void dispatcher.tick().catch(() => undefined);
      void wake();
    },
    onStorageChanged: (changes, area) => {
      if (area !== 'local') return;
      if (changes[StorageKeys.PLUGINS_STATE] || changes[StorageKeys.BRIDGE_PAIRING]) engaged = null;
      const state = changes[StorageKeys.PLUGINS_STATE];
      if (state) {
        const was = enabledIn(state.oldValue);
        const is = enabledIn(state.newValue);
        if (!was && is) void policy.refresh().then(() => wake());
        if (was && !is) void shutDown('bridge-disabled', 'The ChatGPT bridge was turned off.');
      }
      const paired = changes[StorageKeys.BRIDGE_PAIRING];
      if (paired && paired.newValue === undefined) {
        void shutDown('not-paired', 'The bridge was unpaired.');
      } else if (paired) {
        const was = parsePairing(paired.oldValue);
        const is = parsePairing(paired.newValue);
        if (was && is && was.serverId !== is.serverId) {
          // Another server: the old poll and the task it sent must not carry over to it.
          void shutDown('not-paired', 'The bridge was paired with another server.').then(() =>
            wake(),
          );
        } else if (was && is && was.token !== is.token) {
          stop(); // the old poll's token is gone; poll again with the new one
          void wake();
        } else {
          void wake();
        }
      }
      if (changes[catalogKey]) void dispatcher.recheckPolicy();
    },
    onPermissionsAdded: (origins) => {
      if (origins?.includes(LOOPBACK_ORIGIN_PATTERN)) {
        void pairing.completeIntent().then(() => wake());
      } else {
        void wake();
      }
    },
    onPermissionsRemoved: () => {
      void dispatcher.recheckPolicy();
      void env.hasOrigin(LOOPBACK_ORIGIN_PATTERN).then((granted) => {
        if (!granted) stop();
      });
    },
    onTabRemoved: (tabId) =>
      void isEngaged().then((on) => (on ? dispatcher.onTabRemoved(tabId) : undefined)),
    idle: async () => {
      await loop;
    },
  };
}
