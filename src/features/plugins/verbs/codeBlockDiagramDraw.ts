import { type Machine, startMachine } from '../runtime/stateMachine';

type DrawState = { status: 'preparing' } | { status: 'rendering' } | { status: 'settled' };
type DrawEvent = { type: 'prepared'; ready: boolean } | { type: 'finished' };

/** Library preparation and rendering have separate lifetimes; teardown invalidates both results. */
export function startDiagramDraw(
  prepare: () => Promise<boolean>,
  render: (signal: AbortSignal) => Promise<void>,
  settled: () => void,
): Machine<DrawState, DrawEvent> {
  return startMachine<DrawState, DrawEvent>(
    {
      id: 'codeBlockDiagramDraw',
      transition(state, event) {
        if (state.status === 'preparing' && event.type === 'prepared')
          return { status: event.ready ? 'rendering' : 'settled' };
        if (state.status === 'rendering' && event.type === 'finished') return { status: 'settled' };
        return state;
      },
      effects: {
        preparing(stay) {
          void prepare().then(
            (ready) => stay.send({ type: 'prepared', ready }),
            () => stay.send({ type: 'prepared', ready: false }),
          );
        },
        rendering(stay) {
          void render(stay.signal).then(
            () => stay.send({ type: 'finished' }),
            () => stay.send({ type: 'finished' }),
          );
        },
        settled,
      },
    },
    { status: 'preparing' },
  );
}
