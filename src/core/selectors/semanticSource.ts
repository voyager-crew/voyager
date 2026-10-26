import { startMachine } from '@/features/plugins/runtime/stateMachine';

type SemanticSource = 'adapter' | 'snapshot';
type State =
  | { readonly status: 'reading' }
  | { readonly status: 'settled'; readonly source: SemanticSource }
  | { readonly status: 'retired' };
type Event =
  | { readonly type: 'read'; readonly enabled: boolean }
  | { readonly type: 'invalidated' }
  | { readonly type: 'retire' };

interface Input {
  readonly lifetime: AbortSignal;
  read(): Promise<boolean>;
  invalidatedBy?(invalidate: () => void): () => void;
}

function transition(state: State, event: Event): State {
  if (event.type === 'retire') return { status: 'retired' };
  if (state.status !== 'reading') return state;
  return {
    status: 'settled',
    source: event.type === 'read' && !event.enabled ? 'adapter' : 'snapshot',
  };
}

/** Initial settings can settle after profile startup without delaying it or adopting late profiles. */
export function startSemanticSource(input: Input) {
  return startMachine<State, Event>(
    {
      id: 'siteSemanticSource',
      transition,
      effects: {
        reading: (stay) => {
          stay.scope.on(input.lifetime, 'abort', () => stay.send({ type: 'retire' }));
          if (input.invalidatedBy) {
            stay.scope.effect(() => input.invalidatedBy!(() => stay.send({ type: 'invalidated' })));
          }
          void Promise.resolve()
            .then(() => (stay.signal.aborted ? true : input.read()))
            .then(
              (enabled) => stay.send({ type: 'read', enabled }),
              () => stay.send({ type: 'invalidated' }),
            );
        },
        settled: (stay) => {
          stay.scope.on(input.lifetime, 'abort', () => stay.send({ type: 'retire' }));
        },
      },
    },
    input.lifetime.aborted ? { status: 'retired' } : { status: 'reading' },
  );
}
