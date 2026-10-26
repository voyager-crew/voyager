/** One shared-catalog check: cancelled preparation/fetches can never begin a cache write. */
import { StorageKeys } from '@/core/types/common';

import { startMachine, type StateEffects } from '../runtime/stateMachine';
import type { HostCatalogCacheEntry } from './hostCatalogCache';
import type { HostCatalogRefreshResult } from './hostCatalogRefresh';

export interface CatalogCheckContext {
  readonly entry: HostCatalogCacheEntry | null;
  readonly attemptedAt: number;
}

export interface CatalogCheckWrite {
  readonly entry: HostCatalogCacheEntry;
  readonly result: HostCatalogRefreshResult;
}

export type CatalogCheckPreparation =
  | { readonly kind: 'ready'; readonly context: CatalogCheckContext }
  | { readonly kind: 'settled'; readonly result: HostCatalogRefreshResult };

type CheckState =
  | { readonly status: 'preparing' }
  | { readonly status: 'fetching'; readonly context: CatalogCheckContext }
  | { readonly status: 'committing'; readonly write: CatalogCheckWrite }
  | { readonly status: 'recording'; readonly context: CatalogCheckContext; readonly reason: string }
  | { readonly status: 'settled'; readonly result: HostCatalogRefreshResult };

type CheckEvent =
  | { readonly type: 'prepared'; readonly preparation: CatalogCheckPreparation }
  | { readonly type: 'fetched'; readonly write: CatalogCheckWrite }
  | { readonly type: 'failed'; readonly reason: string }
  | { readonly type: 'finished'; readonly result: HostCatalogRefreshResult }
  | { readonly type: 'off' };

const OFF_RESULT: HostCatalogRefreshResult = { ok: true, status: 'skipped', reason: 'disabled' };

function transition(state: CheckState, event: CheckEvent): CheckState {
  if (event.type === 'off') {
    // An already-started storage write settles; a pending response has no write authority.
    return state.status === 'preparing' || state.status === 'fetching'
      ? { status: 'settled', result: OFF_RESULT }
      : state;
  }
  switch (state.status) {
    case 'preparing':
      if (event.type === 'prepared') {
        return event.preparation.kind === 'ready'
          ? { status: 'fetching', context: event.preparation.context }
          : { status: 'settled', result: event.preparation.result };
      }
      if (event.type === 'failed') {
        return { status: 'settled', result: { ok: true, status: 'failed', reason: event.reason } };
      }
      return state;
    case 'fetching':
      if (event.type === 'fetched') return { status: 'committing', write: event.write };
      if (event.type === 'failed')
        return { status: 'recording', context: state.context, reason: event.reason };
      return state;
    case 'committing':
    case 'recording':
      if (event.type === 'finished') return { status: 'settled', result: event.result };
      if (event.type === 'failed')
        return { status: 'settled', result: { ok: true, status: 'failed', reason: event.reason } };
      return state;
    case 'settled':
      return state;
  }
}

/** Observe the actual OFF event, rather than letting a late settings read resurrect an ON check. */
export function subscribeCatalogUpdatesOff(off: () => void): () => void {
  const onChanged = (globalThis as { chrome?: typeof chrome }).chrome?.storage?.onChanged;
  if (!onChanged) return () => {};
  const listener = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area === 'sync' && changes[StorageKeys.PLUGIN_ONLINE_UPDATES_ENABLED]?.newValue === false)
      off();
  };
  onChanged.addListener(listener);
  return () => onChanged.removeListener(listener);
}

export interface CatalogCheckPorts {
  readonly timeoutMs: number;
  readonly subscribeOff: (off: () => void) => () => void;
  prepare(signal: AbortSignal): Promise<CatalogCheckPreparation>;
  fetch(context: CatalogCheckContext, signal: AbortSignal): Promise<CatalogCheckWrite>;
  save(entry: HostCatalogCacheEntry): Promise<void>;
  failure(context: CatalogCheckContext, reason: string): CatalogCheckWrite;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function runHostCatalogCheck(ports: CatalogCheckPorts): Promise<HostCatalogRefreshResult> {
  let settle: (result: HostCatalogRefreshResult) => void = () => {};
  const result = new Promise<HostCatalogRefreshResult>((resolve) => {
    settle = resolve;
  });
  const effects: StateEffects<CheckState, CheckEvent> = {
    preparing: (stay) => {
      stay.scope.effect(() => ports.subscribeOff(() => stay.send({ type: 'off' })));
      void Promise.resolve()
        .then(() => {
          if (stay.signal.aborted) return;
          return ports
            .prepare(stay.signal)
            .then((preparation) => stay.send({ type: 'prepared', preparation }));
        })
        .catch((error: unknown) => stay.send({ type: 'failed', reason: errorText(error) }));
    },
    fetching: (stay) => {
      stay.scope.effect(() => ports.subscribeOff(() => stay.send({ type: 'off' })));
      stay.scope.timer(
        () => stay.send({ type: 'failed', reason: `timeout after ${ports.timeoutMs}ms` }),
        ports.timeoutMs,
      );
      void Promise.resolve()
        .then(() => {
          if (stay.signal.aborted) return;
          return ports
            .fetch(stay.state().context, stay.signal)
            .then((write) => stay.send({ type: 'fetched', write }));
        })
        .catch((error: unknown) => stay.send({ type: 'failed', reason: errorText(error) }));
    },
    committing: (stay) => {
      const { write } = stay.state();
      void ports
        .save(write.entry)
        .then(() => stay.send({ type: 'finished', result: write.result }))
        .catch((error: unknown) => stay.send({ type: 'failed', reason: errorText(error) }));
    },
    recording: (stay) => {
      const { context, reason } = stay.state();
      const write = ports.failure(context, reason);
      void ports
        .save(write.entry)
        .then(() => stay.send({ type: 'finished', result: write.result }))
        .catch((error: unknown) => stay.send({ type: 'failed', reason: errorText(error) }));
    },
    settled: (stay) => settle(stay.state().result),
  };
  const machine = startMachine(
    { id: 'hostCatalogCheck', transition, effects },
    { status: 'preparing' },
  );
  return result.finally(() => machine.stop());
}
