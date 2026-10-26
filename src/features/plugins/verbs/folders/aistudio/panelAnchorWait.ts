import { startMachine } from '../../../runtime/stateMachine';

type AnchorState =
  | { readonly status: 'waiting' }
  | { readonly status: 'settled'; readonly anchor: HTMLElement | null };
type AnchorEvent = { readonly type: 'finish'; readonly anchor: HTMLElement | null };

/** The observer and deadline belong only to the pending mount, and vanish on cancellation. */
export function waitForAIStudioAnchor(
  read: () => HTMLElement | null,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<HTMLElement | null> {
  const found = read();
  if (found || signal.aborted) return Promise.resolve(signal.aborted ? null : found);
  return new Promise((resolve) => {
    startMachine<AnchorState, AnchorEvent>(
      {
        id: 'aistudioPanelAnchor',
        transition: (state, event) =>
          state.status === 'waiting' ? { status: 'settled', anchor: event.anchor } : state,
        effects: {
          waiting: (stay) => {
            stay.scope.on(signal, 'abort', () => stay.send({ type: 'finish', anchor: null }));
            stay.scope.timer(() => stay.send({ type: 'finish', anchor: null }), timeoutMs);
            stay.scope.observe(document.body, { childList: true, subtree: true }, () => {
              const anchor = read();
              if (anchor) stay.send({ type: 'finish', anchor });
            });
          },
          settled: (stay) => resolve(stay.state().anchor),
        },
      },
      { status: 'waiting' },
    );
  });
}
