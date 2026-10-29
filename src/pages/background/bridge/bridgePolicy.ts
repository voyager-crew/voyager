/**
 * Bridge policy (spec §3.5): whether an op may run right now. Recomputed before
 * every dispatch from storage, never from an adapter snapshot a handler holds.
 *
 * An op is allowed only when ALL of these hold:
 *   1. the `voyager.chatgpt-local-bridge` builtin is on and the chatgpt.com and
 *      127.0.0.1 host permissions are granted;
 *   2. the cached chatgpt.com catalog entry was fetched by this extension
 *      version and carries a valid site with a valid `bridge` section;
 *   3. its revision is stamped and not older than the packaged site (the
 *      packaged copy itself never authorizes a production build; an equal
 *      revision is the catalog published from the same commit) and not older
 *      than the highest revision accepted so far (the high-water mark);
 *   4. it was fetched within the last 24 h (the accepted revocation delay);
 *   5. the op is in `bridge.allow`.
 * Anything else denies. `POLICY_EXEMPT_OPS` need only the builtin on and the
 * 127.0.0.1 permission. A deny is never undone by a 404, bad data or the
 * packaged copy: those only ever deny themselves. Unstamped builds (packaged
 * revision 0: dev and tests) also accept the packaged section when no remote
 * policy applies, so the bridge can be developed before it is published.
 */
import { StorageKeys } from '@/core/types/common';
import {
  type ErrorCode,
  type OpName,
  isOpName,
  isPolicyExemptOp,
} from '@/features/bridge/protocol';
import { CHATGPT_LOCAL_BRIDGE_PLUGIN_ID } from '@/features/plugins/builtin/chatgptLocalBridge/manifest';
import {
  type HostCatalogCacheEntry,
  siteAdapterFromEntry,
} from '@/features/plugins/remote/hostCatalogCache';
import { isPluginEnabled } from '@/features/plugins/storage/pluginDefaults';
import type { SiteAdapter } from '@/features/plugins/types';

import type { StorageAreaLike } from './bridgeTaskStore';

export const BRIDGE_PLUGIN_ID = CHATGPT_LOCAL_BRIDGE_PLUGIN_ID;
export const BRIDGE_POLICY_HOST = 'chatgpt.com';
export const CHATGPT_ORIGIN_PATTERN = 'https://chatgpt.com/*';
export const LOOPBACK_ORIGIN_PATTERN = 'http://127.0.0.1/*';
export const POLICY_MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** A job that starts with an older policy asks for a catalog check first. */
export const POLICY_REFRESH_AGE_MS = 6 * 60 * 60 * 1000;

export interface PolicyHighWater {
  readonly revision: number;
  readonly allow: readonly OpName[];
}

export type PolicyVerdict =
  | {
      readonly state: 'allowed';
      readonly source: 'remote' | 'packaged';
      readonly revision: number;
      readonly fetchedAt: number | null;
      readonly allow: readonly OpName[];
    }
  | {
      readonly state: 'denied';
      readonly code: Extract<ErrorCode, 'policy-denied' | 'policy-stale'>;
      readonly reason: string;
      readonly revision: number | null;
      readonly fetchedAt: number | null;
    };

export interface PolicyEvaluationInput {
  readonly entry: HostCatalogCacheEntry | null;
  readonly extensionVersion: string;
  /** The packaged chatgpt adapter; its `catalogRevision` is the floor for remote data. */
  readonly packaged: SiteAdapter | null;
  readonly highWater: PolicyHighWater | null;
  readonly now: number;
  /** A Chrome dev build never fetches the catalog, so its cached policy cannot be refreshed. */
  readonly neverExpires?: boolean;
}

export interface PolicyEvaluation {
  readonly verdict: PolicyVerdict;
  /** Set when this evaluation raised the high-water mark; the caller persists it. */
  readonly nextHighWater?: PolicyHighWater;
}

const deny = (
  code: 'policy-denied' | 'policy-stale',
  reason: string,
  revision: number | null = null,
  fetchedAt: number | null = null,
): PolicyVerdict => ({ state: 'denied', code, reason, revision, fetchedAt });

function packagedFallback(
  input: PolicyEvaluationInput,
  remoteDenial: PolicyVerdict,
): PolicyVerdict {
  const packaged = input.packaged;
  const unstamped = (packaged?.catalogRevision ?? 0) === 0;
  if (!unstamped || !packaged?.bridge) return remoteDenial;
  const allow = packaged.bridge.allow;
  if (allow.length === 0) return deny('policy-denied', 'packaged policy allows nothing', 0);
  return { state: 'allowed', source: 'packaged', revision: 0, fetchedAt: null, allow };
}

/** The rules above as a pure function; storage I/O stays in `createBridgePolicy`. */
export function evaluateBridgePolicy(input: PolicyEvaluationInput): PolicyEvaluation {
  const { entry, highWater, now } = input;
  const floor = input.packaged?.catalogRevision ?? 0;
  if (!entry || entry.status === 'unknown') {
    return { verdict: packagedFallback(input, deny('policy-stale', 'no catalog fetched yet')) };
  }
  if (entry.status === 'missing') {
    return { verdict: packagedFallback(input, deny('policy-denied', 'no catalog published')) };
  }
  if (entry.extensionVersion !== input.extensionVersion) {
    return {
      verdict: packagedFallback(input, deny('policy-stale', 'catalog from another version')),
    };
  }
  const site = siteAdapterFromEntry(entry, input.extensionVersion);
  if (!site) return { verdict: packagedFallback(input, deny('policy-denied', 'no valid site')) };

  const revision = site.catalogRevision ?? 0;
  const fetchedAt = entry.fetchedAt;
  // A release and its catalog share one revision, so `<=` turned every first bridge build off.
  // Unstamped remote data (0) still never passes for published policy.
  if (revision === 0 || revision < floor) {
    return {
      verdict: packagedFallback(
        input,
        deny('policy-stale', 'catalog is older than this build', revision, fetchedAt),
      ),
    };
  }
  if (highWater && revision < highWater.revision) {
    return { verdict: deny('policy-stale', 'catalog revision went back', revision, fetchedAt) };
  }

  const published = site.bridge?.allow ?? [];
  const raised = !highWater || revision > highWater.revision;
  const nextHighWater = raised ? { revision, allow: [...published] } : undefined;
  // At the same revision only what both copies allow survives.
  const allow = raised ? published : published.filter((op) => highWater.allow.includes(op));

  let verdict: PolicyVerdict;
  if (!input.neverExpires && (now - fetchedAt > POLICY_MAX_AGE_MS || fetchedAt > now + 60_000)) {
    verdict = deny('policy-stale', 'policy older than 24 hours', revision, fetchedAt);
  } else if (!site.bridge) {
    verdict = deny('policy-denied', 'catalog has no valid bridge policy', revision, fetchedAt);
  } else if (allow.length === 0) {
    verdict = deny('policy-denied', 'policy allows nothing', revision, fetchedAt);
  } else {
    verdict = { state: 'allowed', source: 'remote', revision, fetchedAt, allow };
  }
  return nextHighWater ? { verdict, nextHighWater } : { verdict };
}

export function parseHighWater(raw: unknown): PolicyHighWater | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { revision, allow } = raw as { revision?: unknown; allow?: unknown };
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0) return null;
  return { revision, allow: Array.isArray(allow) ? allow.filter(isOpName) : [] };
}

export interface BridgeGateStatus {
  readonly enabled: boolean;
  readonly permissions: { readonly chatgpt: boolean; readonly loopback: boolean };
  readonly verdict: PolicyVerdict;
  readonly onlineUpdatesEnabled: boolean;
}

export interface BridgePolicyDeps {
  readonly local: StorageAreaLike;
  readonly loadEntry: () => Promise<HostCatalogCacheEntry | null>;
  readonly packaged: SiteAdapter | null;
  readonly extensionVersion: string;
  readonly hasOrigin: (pattern: string) => Promise<boolean>;
  /** Ask the catalog refresher for chatgpt.com; it honours the online-update switch. */
  readonly refreshCatalog: () => Promise<unknown>;
  readonly loadOnlineUpdatesEnabled: () => Promise<boolean>;
  readonly now?: () => number;
  readonly neverExpires?: boolean;
}

export interface BridgePolicy {
  status(): Promise<BridgeGateStatus>;
  /** The error that stops `op` now, or null when it may run. */
  checkOp(op: OpName): Promise<{ code: ErrorCode; message: string } | null>;
  refresh(): Promise<void>;
  /** Refresh first when the cached policy is older than `POLICY_REFRESH_AGE_MS`. */
  refreshIfOld(): Promise<void>;
}

export function createBridgePolicy(deps: BridgePolicyDeps): BridgePolicy {
  const now = deps.now ?? (() => Date.now());
  let highWaterWrite: Promise<unknown> = Promise.resolve();
  /** The highest mark this worker accepted, kept even when storing it failed. */
  let acceptedHighWater: PolicyHighWater | null = null;
  const higher = (a: PolicyHighWater | null, b: PolicyHighWater | null) =>
    !a ? b : !b || a.revision >= b.revision ? a : b;

  const readLocal = async (key: string): Promise<unknown> => (await deps.local.get(key))[key];

  const evaluate = async (): Promise<PolicyVerdict> => {
    const [entry, rawHighWater] = await Promise.all([
      deps.loadEntry(),
      readLocal(StorageKeys.BRIDGE_POLICY_HIGH_WATER),
    ]);
    const evaluation = evaluateBridgePolicy({
      entry,
      extensionVersion: deps.extensionVersion,
      packaged: deps.packaged,
      // A revoke whose write failed still counts: the stored mark alone may be behind.
      highWater: higher(parseHighWater(rawHighWater), acceptedHighWater),
      now: now(),
      neverExpires: deps.neverExpires,
    });
    const next = evaluation.nextHighWater;
    if (next) {
      acceptedHighWater = higher(acceptedHighWater, next);
      // Raise only: a concurrent evaluation that saw an older entry must not lower the mark.
      const write = async () => {
        const stored = parseHighWater(await readLocal(StorageKeys.BRIDGE_POLICY_HIGH_WATER));
        if (stored && stored.revision >= next.revision) return;
        await deps.local.set({ [StorageKeys.BRIDGE_POLICY_HIGH_WATER]: next });
      };
      // Run after a failed write too: a rejected chain would silently skip every later raise.
      const run = highWaterWrite.then(write, write);
      highWaterWrite = run.catch(() => undefined);
      await highWaterWrite;
    }
    return evaluation.verdict;
  };

  const status = async (): Promise<BridgeGateStatus> => {
    const [stateRaw, onlineRaw, chatgpt, loopback, verdict] = await Promise.all([
      readLocal(StorageKeys.PLUGINS_STATE),
      deps.loadOnlineUpdatesEnabled().catch(() => true),
      deps.hasOrigin(CHATGPT_ORIGIN_PATTERN).catch(() => false),
      deps.hasOrigin(LOOPBACK_ORIGIN_PATTERN).catch(() => false),
      evaluate(),
    ]);
    const state =
      typeof stateRaw === 'object' && stateRaw !== null && !Array.isArray(stateRaw)
        ? (stateRaw as Record<string, { enabled?: unknown } | undefined>)
        : {};
    return {
      enabled: isPluginEnabled(state, BRIDGE_PLUGIN_ID),
      permissions: { chatgpt, loopback },
      verdict,
      onlineUpdatesEnabled: onlineRaw,
    };
  };

  const refresh = async (): Promise<void> => {
    try {
      await deps.refreshCatalog();
    } catch {
      // A failed check leaves the cached policy as it was; the verdict says what it is worth.
    }
  };

  return {
    status,
    checkOp: async (op) => {
      const gate = await status();
      if (!gate.enabled) return { code: 'bridge-disabled', message: 'The ChatGPT bridge is off.' };
      // The policy comes from the catalog `catalog.refresh` fetches: gating it locks a stale one in.
      if (isPolicyExemptOp(op)) {
        return gate.permissions.loopback
          ? null
          : { code: 'permission-missing', message: 'Missing 127.0.0.1 access.' };
      }
      if (!gate.permissions.chatgpt || !gate.permissions.loopback) {
        return { code: 'permission-missing', message: 'Missing chatgpt.com or 127.0.0.1 access.' };
      }
      const verdict = gate.verdict;
      if (verdict.state === 'denied') {
        const hint =
          verdict.code === 'policy-stale' && !gate.onlineUpdatesEnabled
            ? ' Turn on online plugin updates so the policy can refresh.'
            : '';
        return { code: verdict.code, message: `Bridge policy: ${verdict.reason}.${hint}` };
      }
      if (!verdict.allow.includes(op)) {
        return { code: 'policy-denied', message: `The bridge policy does not allow ${op}.` };
      }
      return null;
    },
    refresh,
    refreshIfOld: async () => {
      const entry = await deps.loadEntry();
      if (!entry || now() - entry.fetchedAt > POLICY_REFRESH_AGE_MS) await refresh();
    },
  };
}
