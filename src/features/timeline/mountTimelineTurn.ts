import { isUserEvent } from '@/core/utils/userEvent';
import { startMachine } from '@/features/plugins/runtime/stateMachine';

type MountState =
  | { readonly status: 'waiting' }
  | { readonly status: 'finished'; readonly element: HTMLElement | null };
type MountEvent = { readonly type: 'finished'; readonly element: HTMLElement | null };

/** An unmounted marker owns its native paging until the next jump or user scroll. */
export function startTimelineTurnMount(
  viewport: HTMLElement,
  load: (signal: AbortSignal) => Promise<HTMLElement | null>,
  onWaiting: ((waiting: boolean) => void) | undefined,
  onMounted: (element: HTMLElement) => void,
) {
  let complete: () => void = () => {};
  const finished = new Promise<void>((resolve) => {
    complete = resolve;
  });
  const machine = startMachine<MountState, MountEvent>(
    {
      id: 'timeline-turn-mount',
      transition: (state, event) =>
        state.status === 'waiting' ? { status: 'finished', element: event.element } : state,
      effects: {
        waiting(stay) {
          onWaiting?.(true);
          stay.scope.effect(() => () => onWaiting?.(false));
          const interrupt = (event: Event) => {
            if (isUserEvent(event)) stay.send({ type: 'finished', element: null });
          };
          const options = { passive: true, capture: true };
          stay.scope.on(viewport, 'wheel', interrupt, options);
          stay.scope.on(viewport, 'touchmove', interrupt, options);
          void load(stay.signal).then(
            (element) => stay.send({ type: 'finished', element }),
            () => stay.send({ type: 'finished', element: null }),
          );
        },
        finished(stay) {
          complete();
          const { element } = stay.state();
          if (element && viewport.contains(element)) onMounted(element);
        },
      },
    },
    { status: 'waiting' },
  );
  return {
    finished,
    stop: () => {
      complete();
      return machine.stop();
    },
  };
}
