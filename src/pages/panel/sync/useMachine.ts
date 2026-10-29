import { useCallback, useEffect, useRef, useState } from 'react';

import type { Machine, MachineEvent, MachineState } from '@/features/plugins/runtime/stateMachine';

/**
 * A machine for the component's lifetime: started on mount, stopped on
 * unmount, its state mirrored into React. Events sent before it starts or
 * after it stops are dropped, like a stay's own `send`.
 */
export function useMachine<S extends MachineState, E extends MachineEvent>(
  start: () => Machine<S, E>,
  initial: S,
): readonly [S, (event: E) => void] {
  const [state, setState] = useState<S>(initial);
  const machine = useRef<Machine<S, E> | null>(null);
  const factory = useRef(start);
  useEffect(() => {
    const started = factory.current();
    machine.current = started;
    setState(started.state);
    const unsubscribe = started.subscribe((next) => setState(next));
    return () => {
      unsubscribe();
      machine.current = null;
      void started.stop();
    };
  }, []);
  const send = useCallback((event: E) => machine.current?.send(event), []);
  return [state, send] as const;
}
