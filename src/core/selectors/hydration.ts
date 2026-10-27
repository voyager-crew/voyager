/**
 * One page's selector hydration, as explicit state for `startMachine`.
 *
 *   reading ─read─▶ settled{by: 'read'}
 *   reading ─deadline/invalidated─▶ settled{by: 'fallback'}   (bundled view)
 *   reading | settled ─retire─▶ retired
 *
 * `settled` and `retired` resolve `ready`. A read that answers after the
 * deadline, an invalidation or retirement reaches a dead stay, so it can
 * neither install its view nor count as `read`.
 */
import type { StateEffects } from '@/features/plugins/runtime/stateMachine';

import type { SiteSelectorView } from './types';

export const SITE_SELECTOR_STARTUP_TIMEOUT_MS = 250;

/** How hydration ended: the stored read in time, the bundle, or the page retired first. */
export type SiteSelectorSettlement = 'read' | 'fallback' | 'retired';

export type HydrationState =
  | { readonly status: 'reading' }
  | {
      readonly status: 'settled';
      readonly by: 'read' | 'fallback';
      /** The remote view this page installed, if any. */
      readonly view: SiteSelectorView | null;
    }
  | { readonly status: 'retired'; readonly view: SiteSelectorView | null };

export type HydrationEvent =
  | { readonly type: 'read'; readonly view: SiteSelectorView | null }
  | { readonly type: 'deadline' }
  /** The stored data changed while it was being read. */
  | { readonly type: 'invalidated' }
  | { readonly type: 'retire' };

export function hydrationTransition(state: HydrationState, event: HydrationEvent): HydrationState {
  if (event.type === 'retire') {
    if (state.status === 'retired') return state;
    return { status: 'retired', view: state.status === 'settled' ? state.view : null };
  }
  if (state.status !== 'reading') return state;
  if (event.type === 'read') return { status: 'settled', by: 'read', view: event.view };
  return { status: 'settled', by: 'fallback', view: null };
}

export interface HydrationPorts {
  readonly lifetime: AbortSignal;
  readonly timeoutMs: number;
  read(): Promise<unknown>;
  /** OFF releases native consumers even if the independent cached-adapter read is pending. */
  readOnlineUpdates?(): Promise<boolean>;
  /** The remote view a stored file yields, or null; throws when a selector does not parse. */
  toView(raw: unknown): SiteSelectorView | null;
  /** Subscribes to changes that make a pending read stale; returns the unsubscribe. */
  invalidatedBy?(invalidate: () => void): () => void;
  install(view: SiteSelectorView): void;
  /** Restores the bundle unless another hydration installed its own view since. */
  release(view: SiteSelectorView): void;
  settle(settlement: SiteSelectorSettlement): void;
}

export function createHydrationEffects(
  ports: HydrationPorts,
): StateEffects<HydrationState, HydrationEvent> {
  return {
    reading: (stay) => {
      stay.scope.on(ports.lifetime, 'abort', () => stay.send({ type: 'retire' }));
      const { invalidatedBy } = ports;
      if (invalidatedBy) {
        stay.scope.effect(() => invalidatedBy(() => stay.send({ type: 'invalidated' })));
      }
      // A stalled extension API must not hold feature startup behind a network-sized timeout.
      stay.scope.timer(() => stay.send({ type: 'deadline' }), ports.timeoutMs);
      const { readOnlineUpdates } = ports;
      if (readOnlineUpdates) {
        void Promise.resolve()
          .then(() => (stay.signal.aborted ? false : readOnlineUpdates()))
          .then(
            (enabled) => {
              if (!enabled) stay.send({ type: 'invalidated' });
            },
            () => stay.send({ type: 'invalidated' }),
          );
      }
      void Promise.resolve()
        .then(() => (stay.signal.aborted ? null : ports.read()))
        .then((raw) => {
          if (!stay.signal.aborted) stay.send({ type: 'read', view: ports.toView(raw) });
        })
        .catch(() => {
          // Storage errors and native syntax errors both leave the complete bundled view in place.
          stay.send({ type: 'read', view: null });
        });
    },
    settled: (stay) => {
      stay.scope.on(ports.lifetime, 'abort', () => stay.send({ type: 'retire' }));
      const { view, by } = stay.state();
      if (view) ports.install(view);
      ports.settle(by);
    },
    retired: (stay) => {
      const { view } = stay.state();
      if (view) ports.release(view);
      ports.settle('retired');
    },
  };
}
