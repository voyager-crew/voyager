import type { CleanupPositions } from '@/core/types/cleanupPositions';
import type { CleanupManager } from '@/core/utils/cleanupManager';
import { isExtensionContextInvalidatedError } from '@/core/utils/extensionContext';

/**
 * Lifecycle contract for Gemini / AI Studio native content modules.
 *
 * Two lifetimes are standardised here and nothing else:
 *
 * - **page teardown** — `start` hands back one `stop` that removes every
 *   listener, observer, timer, storage subscription and injected node the
 *   feature owns. `cleanupManager` runs it on unload at `position`.
 * - **popup toggle** — a feature with `toggle` is mounted and stopped while
 *   the page lives, without a reload, by `createNativeFeatureToggle`.
 *
 * Sidebar remounts and account changes are *not* covered: those lifetimes
 * differ per feature and stay inside each module.
 *
 * `src/pages/content/__tests__/nativeFeatureLifecycle.test.ts` enforces the
 * contract for every entry of `NATIVE_FEATURE_LIST`.
 */

/** One call tears down everything the feature set up. Must be idempotent. */
export type StopNativeFeature = () => void;

export interface NativeFeatureToggle {
  /** Storage key (sync or local area) whose value decides whether the feature runs. */
  readonly key: string;
  readonly isEnabled: (value: unknown) => boolean;
  /** Areas whose writes to `key` count; both when omitted. */
  readonly areas?: readonly ('sync' | 'local')[];
}

export interface NativeFeature {
  readonly id: string;
  /** Where `stop` runs relative to the other cleanups on page teardown. */
  readonly position: CleanupPositions;
  readonly start: () => StopNativeFeature | Promise<StopNativeFeature>;
  /**
   * Set only when `start` legitimately registers nothing under the lifecycle
   * test's Gemini fixture (a browser-channel gate, a platform-only feature).
   * The test then skips its "did something" check but still requires a clean
   * teardown. Never use it to silence a real leak.
   */
  readonly inertReason?: string;
  /** Present when the popup can turn the feature on and off while the page lives. */
  readonly toggle?: NativeFeatureToggle;
}

const stopRetired: StopNativeFeature = () => {};

/** Stop a feature whose page already retired; an orphan's chrome.* calls throw. */
function stopAfterRetirement(feature: NativeFeature, stop: StopNativeFeature): void {
  try {
    stop();
  } catch (error) {
    if (isExtensionContextInvalidatedError(error)) return;
    console.error(`[Gemini Voyager] ${feature.id}: stop after retirement failed`, error);
  }
}

/**
 * Start the feature and register its stop at the feature's cleanup position.
 *
 * `lifetime` is the content script's page lifetime, aborted only when a newer
 * copy retires this one. A start that is asked for, or finishes, after that
 * is stopped at once and not registered: the retirement teardown already ran
 * and would never reach it. Returns a no-op stop in that case. A cleanup run
 * that does not abort it (`beforeunload`, which the user may cancel) leaves
 * later mounts registering as before.
 * `beforeMount` shares the page's bounded selector readiness for consumers that
 * would otherwise capture the bundled view while catalog storage is pending.
 */
export async function mountNativeFeature(
  manager: CleanupManager,
  feature: NativeFeature,
  lifetime?: AbortSignal,
  beforeMount?: () => Promise<void>,
): Promise<StopNativeFeature> {
  if (lifetime?.aborted) return stopRetired;
  // A first-load repair must settle before the feature captures its page view.
  if (beforeMount) await beforeMount();
  if (lifetime?.aborted) return stopRetired;
  const stop = await feature.start();
  if (lifetime?.aborted) {
    stopAfterRetirement(feature, stop);
    return stopRetired;
  }
  manager.registerCleanupFunction(stop, feature.position);
  return stop;
}

type StorageChanges = Record<string, { newValue?: unknown } | undefined>;

export interface NativeFeatureToggleController {
  /** Feed `chrome.storage.onChanged` events; unrelated keys and areas are ignored. */
  handleChange(changes: StorageChanges, areaName: string): void;
  /**
   * Apply the value read at startup. Ignored when a change already arrived,
   * so a toggle flipped while the startup read was in flight wins.
   */
  applyInitial(enabled: boolean): Promise<void>;
  isMounted(): boolean;
  /**
   * Stop following storage and stop a start still in flight once it finishes:
   * page teardown cannot reach a stop that is registered after it ran. A
   * feature that is already mounted is left to the cleanup manager, which owns
   * its registered stop.
   */
  destroy(): void;
}

/**
 * Mount/stop a toggleable feature as its storage key flips. Requests are
 * applied strictly in order: a toggle that lands while an asynchronous start
 * is still running waits for it instead of racing it, and only the latest
 * requested state is applied after the queue drains. Once `lifetime` aborts
 * it behaves as destroyed, and its mounts follow `mountNativeFeature`.
 */
export function createNativeFeatureToggle(
  manager: CleanupManager,
  feature: NativeFeature,
  lifetime?: AbortSignal,
  beforeMount?: () => Promise<void>,
): NativeFeatureToggleController {
  const toggle = feature.toggle;
  if (!toggle) throw new Error(`${feature.id}: createNativeFeatureToggle needs a toggle`);

  let stop: StopNativeFeature | null = null;
  let desired: boolean | null = null;
  let queue: Promise<void> = Promise.resolve();
  let sawChange = false;
  let destroyed = false;
  const isDestroyed = (): boolean => destroyed || lifetime?.aborted === true;
  const areas = toggle.areas ?? ['sync', 'local'];

  const stopMounted = (): void => {
    if (!stop) return;
    const current = stop;
    stop = null;
    try {
      current();
    } finally {
      // Even when stop throws (e.g. an invalidated extension context), the
      // registration must go: page teardown must not call it a second time,
      // and a later enable must not stack another entry at this position.
      manager.withdrawCleanupFunctionsByPositionNumber(feature.position);
    }
  };

  const settle = async (): Promise<void> => {
    if (desired === null || isDestroyed()) return;
    const enabled = desired;
    desired = null;
    if (enabled && !stop) {
      const mounted = await mountNativeFeature(manager, feature, lifetime, beforeMount);
      // The page retired while it started: the mount already stopped it.
      if (lifetime?.aborted) return;
      stop = mounted;
      // Registered after page teardown ran, so nothing else will call it.
      if (destroyed) stopMounted();
    } else if (!enabled) {
      stopMounted();
    }
  };

  const request = (enabled: boolean): Promise<void> => {
    desired = enabled;
    queue = queue.then(settle, settle);
    return queue;
  };

  // A start or stop that throws must not surface as an unhandled rejection
  // from a storage listener; an invalidated context is expected on reload.
  const requestFromEvent = (enabled: boolean): void => {
    request(enabled).catch((error: unknown) => {
      if (isExtensionContextInvalidatedError(error)) return;
      console.error(`[Gemini Voyager] ${feature.id}: toggle failed`, error);
    });
  };

  return {
    handleChange(changes, areaName) {
      if (isDestroyed() || !areas.some((area) => area === areaName)) return;
      const change = changes[toggle.key];
      if (!change) return;
      sawChange = true;
      requestFromEvent(toggle.isEnabled(change.newValue));
    },
    applyInitial(enabled) {
      if (isDestroyed() || sawChange) return queue;
      return request(enabled);
    },
    isMounted() {
      return stop !== null;
    },
    destroy() {
      destroyed = true;
    },
  };
}
