/**
 * Runs first in each scripted plugin's own `USER_SCRIPT` world, so it changes
 * that world's globals only, never the page's or another plugin's. Plain
 * DOM code with no imports: the Chrome build bundles it alone into
 * `SCRIPTED_PRELUDE_FILE`.
 *
 * It stops the two accidents that froze a page in the spike without
 * stopping a script: an observer whose callback re-triggers itself, and a
 * near-zero `setInterval`. A synchronous infinite loop is beyond any shim;
 * the background crash guard covers that.
 */

export const OBSERVER_CALLBACKS_PER_SECOND = 200;
export const MIN_INTERVAL_MS = 50;

export interface SafeguardScope {
  MutationObserver: typeof MutationObserver;
  setInterval: Window['setInterval'];
}

export interface SafeguardOptions {
  readonly now: () => number;
  readonly warn: (message: string) => void;
}

const DEFAULT_OPTIONS: SafeguardOptions = {
  now: () => performance.now(),
  warn: (message) => console.warn(message),
};

export function installScriptedSafeguards(
  scope: SafeguardScope,
  { now, warn }: SafeguardOptions = DEFAULT_OPTIONS,
): void {
  const NativeObserver = scope.MutationObserver;
  const tripped = new WeakSet<MutationObserver>();

  class GuardedMutationObserver extends NativeObserver {
    constructor(callback: MutationCallback) {
      let windowStart = Number.NEGATIVE_INFINITY;
      let calls = 0;
      super((records, observer) => {
        if (tripped.has(observer)) return;
        const time = now();
        if (time - windowStart >= 1000) {
          windowStart = time;
          calls = 0;
        }
        calls += 1;
        if (calls > OBSERVER_CALLBACKS_PER_SECOND) {
          tripped.add(observer);
          observer.disconnect();
          warn(
            `[Voyager] A plugin's MutationObserver ran more than ${OBSERVER_CALLBACKS_PER_SECOND} times in one second and was disconnected.`,
          );
          return;
        }
        callback.call(observer, records, observer);
      });
    }

    override observe(target: Node, options?: MutationObserverInit): void {
      if (!tripped.has(this)) super.observe(target, options);
    }
  }

  const nativeSetInterval = scope.setInterval;
  scope.MutationObserver = GuardedMutationObserver;
  scope.setInterval = (handler, timeout, ...args) =>
    nativeSetInterval.call(
      scope,
      handler,
      Math.max(MIN_INTERVAL_MS, Number(timeout) || 0),
      ...args,
    );
}
