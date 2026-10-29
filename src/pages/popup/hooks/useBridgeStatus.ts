import { useCallback, useEffect, useRef, useState } from 'react';

import browser from 'webextension-polyfill';

import { clampParallelJobs } from '@/features/bridge/parallelJobs';
import {
  CATALOG_REFRESH_DEFAULT_HOST,
  type ErrorCode,
  type OpName,
  isErrorCode,
  isOpName,
} from '@/features/bridge/protocol';
import type {
  BridgeEnableRefreshMessage,
  BridgePairIntentMessage,
  BridgePairMessage,
  BridgeSetParallelMessage,
  BridgeStatusMessage,
  BridgeUnpairMessage,
} from '@/features/bridge/runtimeMessages';
import { CHATGPT_LOCAL_BRIDGE_PLUGIN_ID } from '@/features/plugins/builtin/chatgptLocalBridge/manifest';
import { subscribeHostCatalog } from '@/features/plugins/remote/hostCatalogCache';
import { isPluginEnabled } from '@/features/plugins/storage/pluginDefaults';
import { loadPluginState, subscribePluginState } from '@/features/plugins/storage/pluginState';

export { CHATGPT_LOCAL_BRIDGE_PLUGIN_ID };

/** The loopback origin `voyager serve` listens on; granted only through the pairing gesture. */
export const BRIDGE_HOST_ORIGINS: readonly string[] = ['http://127.0.0.1/*'];

/** How often an open card asks the background again. */
export const BRIDGE_STATUS_POLL_MS = 3_000;

export type BridgeServerState = 'online' | 'offline' | 'unknown';
export type BridgePolicyState = 'allowed' | 'denied' | 'stale' | 'unknown';
export type BridgeUpgradeSide = 'extension' | 'cli';

/**
 * What `gv.bridge.status` answers, inside `{ ok: true, data }`. The popup reads
 * only these fields; the pairing token never leaves the background.
 */
export interface BridgeStatus {
  /** Whether `http://127.0.0.1/*` is granted. */
  readonly permission: boolean;
  readonly paired: {
    readonly serverId: string;
    readonly port: number;
    readonly pairedAt: number;
  } | null;
  /** `online` after a successful poll, `offline` once the server stops answering. */
  readonly server: BridgeServerState;
  /** `Date.now()` of the last poll the server answered. */
  readonly lastPollAt?: number;
  readonly policy: BridgePolicyState;
  /** `gvPluginOnlineUpdatesEnabled`; a stale policy cannot refresh while it is off. */
  readonly onlineUpdatesEnabled: boolean;
  /** `gvBridgeParallel`: jobs may run side by side, each in its own tab. */
  readonly parallel: boolean;
  /** `gvBridgeParallelJobs`: how many at once while `parallel` is on (2–10). */
  readonly parallelJobs: number;
  /** The step each running job is on, oldest job first. */
  readonly activeTasks: readonly BridgeActiveTask[];
  /** The last pairing or connection failure, kept until the next success. */
  readonly lastError?: { readonly code: ErrorCode; readonly upgrade?: BridgeUpgradeSide };
}

export interface BridgeActiveTask {
  readonly jobId: string;
  readonly op: OpName;
}

/** A popup action's outcome; `no-response` means the background never answered. */
export type BridgeActionResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly code: ErrorCode | 'no-response';
      readonly upgrade?: BridgeUpgradeSide;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function upgradeSide(value: unknown): BridgeUpgradeSide | undefined {
  return value === 'extension' || value === 'cli' ? value : undefined;
}

function readPaired(value: unknown): BridgeStatus['paired'] {
  if (!isRecord(value) || typeof value.serverId !== 'string') return null;
  const port = finiteNumber(value.port);
  const pairedAt = finiteNumber(value.pairedAt);
  if (port === undefined || pairedAt === undefined) return null;
  return { serverId: value.serverId, port, pairedAt };
}

function readActiveTasks(value: unknown): BridgeActiveTask[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((task: unknown) =>
    isRecord(task) && typeof task.jobId === 'string' && isOpName(task.op)
      ? [{ jobId: task.jobId, op: task.op }]
      : [],
  );
}

function readLastError(value: unknown): BridgeStatus['lastError'] {
  if (!isRecord(value) || !isErrorCode(value.code)) return undefined;
  const upgrade = upgradeSide(value.upgrade);
  return upgrade ? { code: value.code, upgrade } : { code: value.code };
}

/** Narrow the background's answer; anything malformed reads as "no status". */
export function parseBridgeStatus(response: unknown): BridgeStatus | null {
  if (!isRecord(response) || response.ok !== true || !isRecord(response.data)) return null;
  const data = response.data;
  const server: BridgeServerState =
    data.server === 'online' || data.server === 'offline' ? data.server : 'unknown';
  const policy: BridgePolicyState =
    data.policy === 'allowed' || data.policy === 'denied' || data.policy === 'stale'
      ? data.policy
      : 'unknown';
  const lastPollAt = finiteNumber(data.lastPollAt);
  const lastError = readLastError(data.lastError);
  return {
    permission: data.permission === true,
    paired: readPaired(data.paired),
    server,
    policy,
    onlineUpdatesEnabled: data.onlineUpdatesEnabled === true,
    parallel: data.parallel === true,
    parallelJobs: clampParallelJobs(data.parallelJobs),
    activeTasks: readActiveTasks(data.activeTasks),
    ...(lastPollAt !== undefined ? { lastPollAt } : {}),
    ...(lastError ? { lastError } : {}),
  };
}

function parseActionResult(response: unknown): BridgeActionResult {
  if (!isRecord(response)) return { ok: false, code: 'no-response' };
  if (response.ok === true) return { ok: true };
  const error = response.error;
  if (!isRecord(error) || !isErrorCode(error.code)) return { ok: false, code: 'no-response' };
  const upgrade = isRecord(error.details) ? upgradeSide(error.details.upgrade) : undefined;
  return upgrade ? { ok: false, code: error.code, upgrade } : { ok: false, code: error.code };
}

async function sendAction(
  message:
    | BridgePairMessage
    | BridgeUnpairMessage
    | BridgeEnableRefreshMessage
    | BridgeSetParallelMessage,
): Promise<BridgeActionResult> {
  try {
    return parseActionResult(await browser.runtime.sendMessage(message));
  } catch {
    return { ok: false, code: 'no-response' };
  }
}

/**
 * Pair from a click. Call it straight from the handler: the intent goes out
 * before the first await and the permission request is that first await,
 * which Firefox requires of a user gesture.
 */
export async function pairBridge(port: number, code: string): Promise<BridgeActionResult> {
  const intent: BridgePairIntentMessage = { type: 'gv.bridge.pairIntent', port, code };
  // Not awaited: Chrome can close the popup while its permission prompt is
  // open, so the background holds the intent and pairs when the grant lands.
  void browser.runtime.sendMessage(intent).catch(() => {});
  let granted = false;
  try {
    granted = await browser.permissions.request({ origins: [...BRIDGE_HOST_ORIGINS] });
  } catch {
    granted = false;
  }
  if (!granted) return { ok: false, code: 'permission-missing' };
  return sendAction({ type: 'gv.bridge.pair', port, code });
}

/** Ask again for loopback access an existing pairing lost; call it straight from a click. */
export async function requestBridgeAccess(): Promise<boolean> {
  try {
    return await browser.permissions.request({ origins: [...BRIDGE_HOST_ORIGINS] });
  } catch {
    return false;
  }
}

export function unpairBridge(): Promise<BridgeActionResult> {
  return sendAction({ type: 'gv.bridge.unpair' });
}

export function enableBridgeRefresh(): Promise<BridgeActionResult> {
  return sendAction({ type: 'gv.bridge.enableRefresh' });
}

export interface BridgeParallelChange {
  readonly enabled?: boolean;
  /** Whole number within `MIN_PARALLEL_JOBS`–`MAX_PARALLEL_JOBS`. */
  readonly jobs?: number;
}

/** Allow or stop jobs running side by side, or change how many; the background keeps both. */
export function setBridgeParallel(change: BridgeParallelChange): Promise<BridgeActionResult> {
  return sendAction({ type: 'gv.bridge.setParallel', ...change });
}

/** Whether the bridge builtin is on, following later toggles in the plugin list. */
export function useBridgePluginEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let active = true;
    void loadPluginState().then((state) => {
      if (active) setEnabled(isPluginEnabled(state, CHATGPT_LOCAL_BRIDGE_PLUGIN_ID));
    });
    const unsubscribe = subscribePluginState((state) => {
      setEnabled(isPluginEnabled(state, CHATGPT_LOCAL_BRIDGE_PLUGIN_ID));
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  return enabled;
}

/**
 * The background's bridge status while `active`, asked again every few seconds
 * and whenever host access or the bridge rules' catalog changes. `null` until
 * the background answers.
 */
export function useBridgeStatus(active: boolean) {
  const [status, setStatus] = useState<BridgeStatus | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async (): Promise<void> => {
    const message: BridgeStatusMessage = { type: 'gv.bridge.status' };
    try {
      const next = parseBridgeStatus(await browser.runtime.sendMessage(message));
      if (mounted.current && next) setStatus(next);
    } catch {
      // The service worker may be restarting; the next tick asks again.
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    if (!active)
      return () => {
        mounted.current = false;
      };
    void refresh();
    const timer = setInterval(() => void refresh(), BRIDGE_STATUS_POLL_MS);
    const askAgain = (): void => void refresh();
    const permissions = browser.permissions;
    permissions?.onAdded?.addListener(askAgain);
    permissions?.onRemoved?.addListener(askAgain);
    // The rules ride in chatgpt.com's catalog (`catalog.refresh`'s default host), so a check
    // of it, the plugin card's manual one included, can clear a stale notice at once. A
    // renewal of unchanged rules moves only `fetchedAt`, a bookkeeping write.
    const unsubscribeCatalog = subscribeHostCatalog(CATALOG_REFRESH_DEFAULT_HOST, askAgain, {
      includeBookkeeping: true,
    });
    return () => {
      mounted.current = false;
      clearInterval(timer);
      permissions?.onAdded?.removeListener(askAgain);
      permissions?.onRemoved?.removeListener(askAgain);
      unsubscribeCatalog();
    };
  }, [active, refresh]);

  return { status, refresh };
}
