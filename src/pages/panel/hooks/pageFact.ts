import { useEffect, useRef } from 'react';

import { type StateEffects, startMachine } from '@/features/plugins/runtime/stateMachine';

import { useMachine } from '../sync/useMachine';

/**
 * Something the panel asks the page about itself (its outline, whether a
 * creation matches anything), keyed by what the answer depends on: the page
 * URL and whatever else the caller names. The first key asks at once; a key
 * that replaces another waits for the page to settle, then asks again. An
 * answer for an earlier key never lands, because leaving `asking` ends that
 * stay.
 *
 * idle → asking → known | unknown; a new key → settling → asking.
 */
export type PageFactState<T> =
  | { readonly status: 'idle' }
  | { readonly status: 'settling'; readonly key: string }
  | { readonly status: 'asking'; readonly key: string }
  | { readonly status: 'known'; readonly key: string; readonly fact: T }
  /** The page did not answer (no content script, an old page, a refusal). */
  | { readonly status: 'unknown'; readonly key: string };

export type PageFactEvent<T> =
  /** `null`: nothing to ask, such as a closed preview or no page to ask. */
  | { readonly type: 'want'; readonly key: string | null }
  | { readonly type: 'settled' }
  | { readonly type: 'answer'; readonly fact: T | null };

export const PAGE_FACT_IDLE = { status: 'idle' } as const;

export function pageFactTransition<T>(
  state: PageFactState<T>,
  event: PageFactEvent<T>,
): PageFactState<T> {
  switch (event.type) {
    case 'want':
      if (event.key === null) return state.status === 'idle' ? state : PAGE_FACT_IDLE;
      if (state.status === 'idle') return { status: 'asking', key: event.key };
      return state.key === event.key ? state : { status: 'settling', key: event.key };
    case 'settled':
      return state.status === 'settling' ? { status: 'asking', key: state.key } : state;
    case 'answer':
      if (state.status !== 'asking') return state;
      return event.fact === null
        ? { status: 'unknown', key: state.key }
        : { status: 'known', key: state.key, fact: event.fact };
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

export function pageFactEffects<T>({
  settleMs,
  ask,
}: {
  /** How long a new key waits before asking: a page that just navigated is still rendering. */
  readonly settleMs: number;
  readonly ask: () => Promise<T | null>;
}): StateEffects<PageFactState<T>, PageFactEvent<T>> {
  return {
    settling: (stay) => {
      stay.scope.timer(() => stay.send({ type: 'settled' }), settleMs);
    },
    asking: (stay) => {
      ask().then(
        (fact) => stay.send({ type: 'answer', fact }),
        () => stay.send({ type: 'answer', fact: null }),
      );
    },
  };
}

/** The page fact for `key`, asked through `ask`; `key` null leaves it idle. */
export function usePageFact<T>(
  key: string | null,
  ask: () => Promise<T | null>,
  settleMs: number,
): PageFactState<T> {
  const asker = useRef(ask);
  useEffect(() => {
    asker.current = ask;
  });
  const [state, send] = useMachine<PageFactState<T>, PageFactEvent<T>>(
    () =>
      startMachine<PageFactState<T>, PageFactEvent<T>>(
        {
          id: 'panelPageFact',
          transition: pageFactTransition,
          effects: pageFactEffects({ settleMs, ask: () => asker.current() }),
        },
        PAGE_FACT_IDLE,
      ),
    PAGE_FACT_IDLE,
  );
  useEffect(() => {
    send({ type: 'want', key });
  }, [key, send]);
  return state;
}
