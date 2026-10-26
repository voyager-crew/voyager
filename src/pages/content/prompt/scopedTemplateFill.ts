import { startMachine } from '@/features/plugins/runtime/stateMachine';

import {
  openTemplateFill,
  type TemplateFillHandle,
  type TemplateFillOptions,
} from './PromptTemplateFill';
import { promptPageScope, watchPromptPageScope } from './promptPageScope';

type State = { status: 'open' } | { status: 'submitted'; value: string } | { status: 'closed' };
type Event = { type: 'submit'; value: string } | { type: 'close' };

/** An idle slash menu must not keep watching every account/header mutation. */
export function openScopedTemplateFill(options: TemplateFillOptions): TemplateFillHandle {
  const identity = promptPageScope();
  let fill: TemplateFillHandle | undefined;
  const machine = startMachine<State, Event>(
    {
      id: 'promptTemplateFill',
      transition: (state, event) => {
        if (state.status !== 'open') return state;
        return event.type === 'submit'
          ? { status: 'submitted', value: event.value }
          : { status: 'closed' };
      },
      effects: {
        open: (stay) => {
          fill = openTemplateFill({
            ...options,
            onSubmit: (value) => {
              // Submission may race the account observer; the original page must still own it.
              stay.send(
                identity === promptPageScope() ? { type: 'submit', value } : { type: 'close' },
              );
            },
            onCancel: () => stay.send({ type: 'close' }),
          });
          const stop = watchPromptPageScope(() => stay.send({ type: 'close' }));
          stay.scope.effect(() => () => {
            stop();
            fill?.close();
          });
        },
        submitted: (stay) => options.onSubmit(stay.state().value),
        closed: () => options.onCancel?.(),
      },
    },
    { status: 'open' },
  );
  return {
    close: () => machine.send({ type: 'close' }),
    get slots() {
      return fill?.slots ?? [];
    },
  };
}
