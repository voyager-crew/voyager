import {
  detectAccountContextFromDocument,
  detectAccountPlatformFromUrl,
} from '@/core/services/AccountIsolationService';
import { type Machine, startMachine } from '@/features/plugins/runtime/stateMachine';

import { watchRouteChanges } from '../utils/routeWatcher';
import { PROMPT_ACCOUNT_ATTRIBUTES, promptAccountMutation } from './promptAccountMutation';

export function promptPageScope(): string {
  const pageUrl = window.location.href;
  // Other sites have no account scope; a reply's email must not cancel an intercepted send.
  if (!detectAccountPlatformFromUrl(pageUrl)) return pageUrl;
  const account = detectAccountContextFromDocument(pageUrl, document);
  return `${pageUrl}\u0000${account.routeUserId ?? ''}\u0000${account.email ?? ''}`;
}

/** Native account detection is packaged; changed locators never choose the lifetime's identity. */
export function watchPromptPageScope(onChange: () => void): () => void {
  let identity = promptPageScope();
  const check = () => {
    const next = promptPageScope();
    if (next === identity) return;
    identity = next;
    onChange();
  };
  const stopRoute = watchRouteChanges(check);
  const platform = detectAccountPlatformFromUrl(window.location.href);
  const observer = platform
    ? new MutationObserver((records) => {
        if (records.some((record) => promptAccountMutation(record, platform))) check();
      })
    : null;
  observer?.observe(document.documentElement, {
    subtree: true,
    childList: true,
    characterData: platform === 'aistudio',
    attributeOldValue: true,
    attributeFilter: PROMPT_ACCOUNT_ATTRIBUTES,
  });
  return () => {
    stopRoute();
    observer?.disconnect();
  };
}

type TaskState<T> = { status: 'reading' } | { status: 'ready'; value: T } | { status: 'retired' };
type TaskEvent<T> = { type: 'resolved'; value: T } | { type: 'retire' };

/** The read may finish after navigation, but its result cannot act on the next page/account. */
export function startPromptScopedRead<T>(options: {
  read: () => Promise<T>;
  accept: (value: T) => void;
  failed: (error: unknown) => void;
  isCurrent?: () => boolean;
  invalidatedBy?: (invalidate: () => void) => () => void;
}): Machine<TaskState<T>, TaskEvent<T>> {
  const identity = promptPageScope();
  const isCurrent = options.isCurrent ?? (() => identity === promptPageScope());
  return startMachine<TaskState<T>, TaskEvent<T>>(
    {
      id: 'promptScopedRead',
      transition: (state, event) => {
        if (event.type === 'retire') return { status: 'retired' };
        return state.status === 'reading' ? { status: 'ready', value: event.value } : state;
      },
      effects: {
        reading: (stay) => {
          if (options.invalidatedBy) {
            stay.scope.effect(() => options.invalidatedBy!(() => stay.send({ type: 'retire' })));
          }
          stay.scope.effect(() =>
            watchPromptPageScope(() => {
              if (!isCurrent()) stay.send({ type: 'retire' });
            }),
          );
          void options
            .read()
            .then((value) => {
              // A promise can settle before the route/account observer flushes.
              if (!isCurrent()) stay.send({ type: 'retire' });
              else stay.send({ type: 'resolved', value });
            })
            .catch((error: unknown) => {
              if (!stay.signal.aborted && isCurrent()) options.failed(error);
              stay.send({ type: 'retire' });
            });
        },
        ready: (stay) => options.accept(stay.state().value),
      },
    },
    { status: 'reading' },
  );
}

/** Send replay keeps its zero-delay ordering, with the pending timer owned by its phase. */
export function createPromptSendReplay(): {
  schedule: (replay: () => void) => void;
  destroy: () => void;
} {
  type State = { status: 'waiting' } | { status: 'retired' };
  type Event = { type: 'retire' };
  const pending = new Set<Machine<State, Event>>();
  return {
    schedule: (replay) => {
      const identity = promptPageScope();
      const machine = startMachine<State, Event>(
        {
          id: 'promptSendReplay',
          transition: () => ({ status: 'retired' }),
          effects: {
            waiting: (stay) => {
              stay.scope.effect(() => watchPromptPageScope(() => stay.send({ type: 'retire' })));
              const timer = window.setTimeout(() => {
                // Navigation may happen in the same turn as send interception, before observers run.
                if (!stay.signal.aborted && identity === promptPageScope()) replay();
                stay.send({ type: 'retire' });
              }, 0);
              stay.scope.effect(() => () => window.clearTimeout(timer));
            },
          },
        },
        { status: 'waiting' },
      );
      pending.add(machine);
      machine.subscribe(() => pending.delete(machine));
    },
    destroy: () => {
      for (const machine of pending) machine.send({ type: 'retire' });
      pending.clear();
    },
  };
}
