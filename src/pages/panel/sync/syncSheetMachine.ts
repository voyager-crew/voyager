import { type Machine, startMachine } from '@/features/plugins/runtime/stateMachine';

import type { Connection, StatusRow } from './syncProtocol';

export interface SheetData {
  /** Null until the first answer. */
  readonly connection: Connection | null;
  readonly rows: readonly StatusRow[];
  /** Rows whose account no page here confirms; they show 无法确认账号 and no switch. */
  readonly unconfirmed: readonly string[];
  readonly loaded: boolean;
}

export type SheetNotice =
  | { readonly kind: 'connectFailed' }
  | { readonly kind: 'restored'; readonly restored: number; readonly failed: number };

/** Connection, statuses and the cloud-only actions; a run is its own machine. */
export type SheetState =
  | { readonly status: 'loading'; readonly data: SheetData; readonly again: boolean }
  | { readonly status: 'stale'; readonly data: SheetData }
  | { readonly status: 'ready'; readonly data: SheetData }
  | { readonly status: 'connecting'; readonly data: SheetData }
  | { readonly status: 'disconnecting'; readonly data: SheetData }
  | { readonly status: 'restoring'; readonly data: SheetData; readonly rows: readonly string[] };

export type SheetEvent =
  | { readonly type: 'refresh' }
  | { readonly type: 'loaded'; readonly data: SheetData }
  | { readonly type: 'connect' }
  | { readonly type: 'disconnect' }
  | { readonly type: 'restore'; readonly rows: readonly string[] }
  | { readonly type: 'settled' };

export const EMPTY_SHEET: SheetData = {
  connection: null,
  rows: [],
  unconfirmed: [],
  loaded: false,
};

export function transition(state: SheetState, event: SheetEvent): SheetState {
  const busy = state.status !== 'ready' && state.status !== 'stale';
  switch (event.type) {
    case 'refresh':
      if (state.status === 'loading') return state.again ? state : { ...state, again: true };
      return busy ? state : { status: 'loading', data: state.data, again: false };
    case 'loaded':
      if (state.status !== 'loading') return state;
      // A refresh asked while this answer was on its way reads again.
      return state.again
        ? { status: 'stale', data: event.data }
        : { status: 'ready', data: event.data };
    case 'connect':
      return busy ? state : { status: 'connecting', data: state.data };
    case 'disconnect':
      return busy ? state : { status: 'disconnecting', data: state.data };
    case 'restore':
      return busy || !event.rows.length
        ? state
        : { status: 'restoring', data: state.data, rows: event.rows };
    case 'settled':
      return state.status === 'connecting' ||
        state.status === 'disconnecting' ||
        state.status === 'restoring'
        ? { status: 'loading', data: state.data, again: false }
        : state;
    default:
      return state;
  }
}

export interface SheetDeps {
  load(signal: AbortSignal): Promise<SheetData>;
  connect(): Promise<boolean>;
  disconnect(): Promise<void>;
  restore(rows: readonly string[]): Promise<{ restored: number; failed: number }>;
  notify(notice: SheetNotice): void;
}

export function startSheetMachine(deps: SheetDeps): Machine<SheetState, SheetEvent> {
  return startMachine<SheetState, SheetEvent>(
    {
      id: 'panel-sync-sheet',
      transition,
      effects: {
        loading(stay) {
          void deps.load(stay.signal).then(
            (data) => stay.send({ type: 'loaded', data }),
            () => stay.send({ type: 'loaded', data: { ...stay.state().data, loaded: true } }),
          );
        },
        stale(stay) {
          stay.send({ type: 'refresh' });
        },
        connecting(stay) {
          void deps.connect().then((ok) => {
            if (stay.signal.aborted) return;
            if (!ok) deps.notify({ kind: 'connectFailed' });
            stay.send({ type: 'settled' });
          });
        },
        disconnecting(stay) {
          void deps.disconnect().finally(() => stay.send({ type: 'settled' }));
        },
        restoring(stay) {
          void deps.restore(stay.state().rows).then((result) => {
            if (stay.signal.aborted) return;
            deps.notify({ kind: 'restored', ...result });
            stay.send({ type: 'settled' });
          });
        },
      },
    },
    // Nothing is read until the sheet first opens.
    { status: 'ready', data: EMPTY_SHEET },
  );
}
