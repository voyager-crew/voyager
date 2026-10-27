import { SITE_SELECTOR_STARTUP_TIMEOUT_MS } from '@/core/selectors/hydration';
import { startMachine } from '@/features/plugins/runtime/stateMachine';
import type { SiteAdapter } from '@/features/plugins/types';

interface PageSelectorAdapterInput {
  readonly bundled: SiteAdapter | null;
  readonly lifetime: AbortSignal;
  readonly read: () => Promise<SiteAdapter | null>;
  readonly timeoutMs?: number;
}

type AdapterState =
  | { readonly status: 'reading' }
  | { readonly status: 'settled'; readonly result: PageSelectorAdapterResult }
  | { readonly status: 'retired' };

type AdapterEvent =
  | { readonly type: 'read'; readonly adapter: SiteAdapter | null }
  | { readonly type: 'fallback' }
  | { readonly type: 'retire' };

export interface PageSelectorAdapter {
  readonly ready: Promise<PageSelectorAdapterResult>;
  readonly stop: () => void;
}

type PageSelectorAdapterResult = {
  readonly by: 'read' | 'fallback' | 'retired';
  readonly adapter: SiteAdapter | null;
};

/** Bound only the adapter result used by locator hydration and its refresh gate. */
export function startPageSelectorAdapter(input: PageSelectorAdapterInput): PageSelectorAdapter {
  let settle: (result: PageSelectorAdapterResult) => void = () => {};
  const ready = new Promise<PageSelectorAdapterResult>((resolve) => {
    settle = resolve;
  });
  const machine = startMachine<AdapterState, AdapterEvent>(
    {
      id: 'pageSelectorAdapter',
      transition: (state, event) => {
        if (event.type === 'retire') return { status: 'retired' };
        if (state.status !== 'reading') return state;
        return {
          status: 'settled',
          result:
            event.type === 'read'
              ? { by: 'read', adapter: event.adapter }
              : { by: 'fallback', adapter: input.bundled },
        };
      },
      effects: {
        reading: (stay) => {
          stay.scope.on(input.lifetime, 'abort', () => stay.send({ type: 'retire' }));
          // A hung cache must not outlive the page's bounded locator startup.
          stay.scope.timer(
            () => stay.send({ type: 'fallback' }),
            input.timeoutMs ?? SITE_SELECTOR_STARTUP_TIMEOUT_MS,
          );
          void Promise.resolve()
            .then(() => (stay.signal.aborted ? null : input.read()))
            .then(
              (adapter) => stay.send({ type: 'read', adapter }),
              () => stay.send({ type: 'fallback' }),
            );
        },
        settled: (stay) => settle(stay.state().result),
        retired: () => settle({ by: 'retired', adapter: input.bundled }),
      },
    },
    input.lifetime.aborted ? { status: 'retired' } : { status: 'reading' },
  );
  return { ready, stop: () => machine.send({ type: 'retire' }) };
}
