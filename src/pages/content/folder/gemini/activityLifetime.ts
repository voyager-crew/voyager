import { type Machine, startMachine } from '@/features/plugins/runtime/stateMachine';

import { watchRouteChanges } from '../../utils/routeWatcher';
import { geminiPageAccountFingerprint } from '../session/geminiAccountRoute';

type SendState = { status: 'pending' } | { status: 'complete' };
type SendEvent = { type: 'complete' };

/** Wait until native handlers have accepted the event, while retaining its route/account owner. */
export function deferActivitySend(event: Event, apply: () => void): Machine<SendState, SendEvent> {
  const href = location.href;
  const account = geminiPageAccountFingerprint();
  return startMachine<SendState, SendEvent>(
    {
      id: 'folderActivitySend',
      transition: (state, message) =>
        message.type === 'complete' ? { status: 'complete' } : state,
      effects: {
        pending: (stay) => {
          stay.scope.effect(() => watchRouteChanges(() => stay.send({ type: 'complete' })));
          stay.scope.timer(() => {
            // A different account or route must never inherit a send's stored activity time.
            if (
              !stay.signal.aborted &&
              location.href === href &&
              geminiPageAccountFingerprint() === account &&
              !event.defaultPrevented
            )
              apply();
            stay.send({ type: 'complete' });
          }, 0);
        },
      },
    },
    { status: 'pending' },
  );
}

type TrackingState =
  | { status: 'loading' }
  | { status: 'active' }
  | { status: 'idle'; reason: 'cancelled' | 'unready' };
type TrackingEvent = { type: 'ready'; ready: boolean } | { type: 'cancel' };

/** Match the folder session's account poll instead of scanning during every streamed mutation. */
const ACCOUNT_POLL_MS = 1200;

/** Startup owns its pending initialization; a stop cannot be undone by a late ready result. */
export function startActivityLifetime(options: {
  initialize(signal: AbortSignal): Promise<boolean>;
  activate(): () => void;
  onCancelled?(): void;
}): { ready: Promise<void>; isRunning(): boolean; stop(): void } {
  const href = location.href;
  const account = geminiPageAccountFingerprint();
  const ownsPage = () => location.href === href && geminiPageAccountFingerprint() === account;
  let settle = () => {};
  const ready = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const machine = startMachine<TrackingState, TrackingEvent>(
    {
      id: 'folderActivityTracking',
      transition: (state, event) =>
        state.status !== 'loading'
          ? state
          : event.type === 'cancel'
            ? { status: 'idle', reason: 'cancelled' }
            : event.ready
              ? { status: 'active' }
              : { status: 'idle', reason: 'unready' },
      effects: {
        loading: (stay) => {
          stay.scope.effect(() => () => settle());
          stay.scope.effect(() => watchRouteChanges(() => stay.send({ type: 'cancel' })));
          stay.scope.timer(
            () => {
              if (!ownsPage()) stay.send({ type: 'cancel' });
            },
            ACCOUNT_POLL_MS,
            { repeat: true },
          );
          void options.initialize(stay.signal).then(
            (ready) => stay.send(ownsPage() ? { type: 'ready', ready } : { type: 'cancel' }),
            () => stay.send({ type: 'ready', ready: false }),
          );
        },
        active: (stay) => {
          stay.scope.effect(options.activate);
        },
        idle: (stay) => {
          // A changed page gets a fresh owner; failed initialization waits for an explicit retry.
          if (stay.state().reason === 'cancelled') options.onCancelled?.();
        },
      },
    },
    { status: 'loading' },
  );
  return {
    ready,
    isRunning: () => !machine.stopped && machine.state.status !== 'idle',
    stop: () => {
      void machine.stop();
    },
  };
}
