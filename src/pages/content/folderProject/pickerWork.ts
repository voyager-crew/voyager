import { startMachine } from '@/features/plugins/runtime/stateMachine';

import { watchRouteChanges } from '../utils/routeWatcher';

type WorkState = { status: 'running' } | { status: 'complete' };
type WorkEvent = { type: 'complete' };

/** A mount/load owns its callbacks only while this route and account still own the picker. */
export function startPickerWork(options: {
  run(signal: AbortSignal, isCurrent: () => boolean): Promise<void>;
  onAccountChange?: (listener: () => void) => () => void;
  currentAccount?: () => string | null;
}): { done: Promise<void>; cancel(): void } {
  const account = options.currentAccount?.();
  // A newly readable control confirms the account; only two known identities prove a switch.
  const accountChanged = () => {
    const current = options.currentAccount?.();
    return account != null && current != null && current !== account;
  };
  const href = location.href;
  let settle = () => {};
  const done = new Promise<void>((resolve) => {
    settle = resolve;
  });
  const machine = startMachine<WorkState, WorkEvent>(
    {
      id: 'folderProjectPickerWork',
      transition: (state, event) => (event.type === 'complete' ? { status: 'complete' } : state),
      effects: {
        running: (stay) => {
          stay.scope.effect(() => () => settle());
          stay.scope.effect(() => watchRouteChanges(() => stay.send({ type: 'complete' })));
          if (options.onAccountChange)
            stay.scope.effect(() =>
              options.onAccountChange!(() => {
                if (accountChanged()) stay.send({ type: 'complete' });
              }),
            );
          void options
            .run(
              stay.signal,
              () => !stay.signal.aborted && location.href === href && !accountChanged(),
            )
            .then(
              () => stay.send({ type: 'complete' }),
              () => stay.send({ type: 'complete' }),
            );
        },
      },
    },
    { status: 'running' },
  );
  return {
    done,
    cancel: () => {
      void machine.stop();
    },
  };
}

/** The aborted phase cancels its frame and resolves immediately, including when the page is hidden. */
export function waitForProjectAnchor(
  selector: string | (() => HTMLElement | null),
  timeoutMs: number,
  signal: AbortSignal,
): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    let frame = 0;
    const deadline = Date.now() + timeoutMs;
    const finish = (element: HTMLElement | null) => {
      cancelAnimationFrame(frame);
      signal.removeEventListener('abort', abort);
      resolve(element);
    };
    const abort = () => finish(null);
    const check = () => {
      if (signal.aborted) return finish(null);
      const element =
        typeof selector === 'function' ? selector() : document.querySelector<HTMLElement>(selector);
      if (element && element.getBoundingClientRect().height > 0) return finish(element);
      if (Date.now() > deadline) return finish(null);
      frame = requestAnimationFrame(check);
    };
    signal.addEventListener('abort', abort, { once: true });
    check();
  });
}
