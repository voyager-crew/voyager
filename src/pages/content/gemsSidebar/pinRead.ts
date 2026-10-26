import { getGeminiSelectorView } from '@/core/gemini/selectors';
import { GEMINI_GEMS_PROFILE_KEYS } from '@/core/gemini/selectors/gemsKeys';
import { startMachine } from '@/features/plugins/runtime/stateMachine';

import { watchRouteChanges } from '../utils/routeWatcher';
import { currentAccountSegment } from './catalog';

type State =
  | { status: 'reading' }
  | { status: 'applying'; pinned: string[] }
  | { status: 'done' }
  | { status: 'failed'; error: unknown };
type Event =
  | { type: 'loaded'; pinned: string[] }
  | { type: 'end' }
  | { type: 'failed'; error: unknown };

function transition(state: State, event: Event): State {
  if (event.type === 'failed') return { status: 'failed', error: event.error };
  if (event.type === 'end') return { status: 'done' };
  return state.status === 'reading' ? { status: 'applying', pinned: event.pinned } : state;
}

/** The storage read belongs to the page that requested its pin buttons. */
export function readPinsForPage(
  signal: AbortSignal,
  read: () => Promise<string[]>,
  apply: (pinned: string[]) => void,
): Promise<void> {
  const accountSegment = currentAccountSegment();
  const online = GEMINI_GEMS_PROFILE_KEYS.some((key) =>
    getGeminiSelectorView().remoteKeys.has(key),
  );
  return new Promise((resolve, reject) => {
    startMachine<State, Event>(
      {
        id: 'gemsPinRead',
        transition,
        effects: {
          reading(stay) {
            stay.scope.on(signal, 'abort', () => stay.send({ type: 'end' }), { once: true });
            if (online) {
              stay.scope.effect(() =>
                watchRouteChanges(() => {
                  if (currentAccountSegment() !== accountSegment) stay.send({ type: 'end' });
                }),
              );
            }
            try {
              void read().then(
                (pinned) => {
                  // Same-account navigation keeps pins valid; polling can lag an account switch.
                  if (online && currentAccountSegment() !== accountSegment)
                    stay.send({ type: 'end' });
                  else stay.send({ type: 'loaded', pinned });
                },
                (error: unknown) => stay.send({ type: 'failed', error }),
              );
            } catch (error) {
              stay.send({ type: 'failed', error });
            }
          },
          applying(stay) {
            // The runtime logs effect exceptions; settle the caller's promise explicitly.
            try {
              apply(stay.state().pinned);
              stay.send({ type: 'end' });
            } catch (error) {
              stay.send({ type: 'failed', error });
            }
          },
          done() {
            resolve();
          },
          failed(stay) {
            reject(stay.state().error);
          },
        },
      },
      signal.aborted ? { status: 'done' } : { status: 'reading' },
    );
  });
}
