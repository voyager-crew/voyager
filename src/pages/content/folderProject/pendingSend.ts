import { startMachine } from '@/features/plugins/runtime/stateMachine';

type PendingState = { status: 'idle' } | { status: 'pending' };
type PendingEvent = { type: 'begin' } | { type: 'clear' } | { type: 'expire' };

/** A first-send intent ends on navigation, account retirement, feature stop, or expiry. */
export function createPendingProjectSend(onExpire: () => void): {
  isPending(): boolean;
  begin(): void;
  clear(): void;
} {
  const machine = startMachine<PendingState, PendingEvent>(
    {
      id: 'folderProjectPendingSend',
      transition: (state, event) => {
        if (event.type === 'begin') return { status: 'pending' };
        return state.status === 'idle' ? state : { status: 'idle' };
      },
      effects: {
        pending: (stay) => {
          // Longer than the first response to a paper/PDF, whose URL may settle after 30 seconds.
          stay.scope.timer(() => {
            stay.send({ type: 'expire' });
            onExpire();
          }, 60_000);
        },
      },
    },
    { status: 'idle' },
  );
  return {
    isPending: () => machine.state.status === 'pending',
    begin: () => {
      machine.send({ type: 'clear' });
      machine.send({ type: 'begin' });
    },
    clear: () => machine.send({ type: 'clear' }),
  };
}
