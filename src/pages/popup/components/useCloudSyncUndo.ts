import { useCallback, useEffect, useRef, useState } from 'react';

import { undoCloudSyncSnapshot } from '@/core/services/CloudSyncSnapshotService';
import type { CloudSyncUndoResult } from '@/core/services/cloudSyncSnapshotTypes';
import { type Machine, startMachine } from '@/features/plugins/runtime/stateMachine';

export type CloudSyncUndoState =
  | { readonly status: 'idle' }
  | { readonly status: 'offered'; readonly snapshotId: string }
  | { readonly status: 'undoing'; readonly snapshotId: string }
  | {
      readonly status: 'settled';
      readonly snapshotId: string;
      readonly result: CloudSyncUndoResult;
    };

type UndoEvent =
  | { readonly type: 'offer'; readonly snapshotId: string }
  | { readonly type: 'withdraw' }
  | { readonly type: 'undo' }
  | { readonly type: 'done'; readonly result: CloudSyncUndoResult };

const IDLE: CloudSyncUndoState = { status: 'idle' };

/** A failed undo leaves its slot resumable, so the offer stays. */
const canRetry = (state: CloudSyncUndoState): boolean =>
  state.status === 'settled' && state.result.status === 'failed';

export function transitionCloudSyncUndo(
  state: CloudSyncUndoState,
  event: UndoEvent,
): CloudSyncUndoState {
  switch (event.type) {
    case 'offer':
      return { status: 'offered', snapshotId: event.snapshotId };
    // A new action ends the offer; an undo still running reports to nobody.
    case 'withdraw':
      return state.status === 'idle' ? state : IDLE;
    case 'undo':
      return state.status === 'offered' || canRetry(state)
        ? { status: 'undoing', snapshotId: (state as { snapshotId: string }).snapshotId }
        : state;
    case 'done':
      return state.status === 'undoing'
        ? { status: 'settled', snapshotId: state.snapshotId, result: event.result }
        : state;
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

/**
 * The Undo a popup download result offers, for that download's snapshot only.
 * The machine stops with the popup and with each new action, so an undo that
 * settles late never replaces a newer result.
 */
export function useCloudSyncUndo(onSettled: (result: CloudSyncUndoResult) => void) {
  const [state, setState] = useState<CloudSyncUndoState>(IDLE);
  const machine = useRef<Machine<CloudSyncUndoState, UndoEvent> | null>(null);
  const settled = useRef(onSettled);
  useEffect(() => {
    settled.current = onSettled;
  }, [onSettled]);

  useEffect(() => {
    const started = startMachine<CloudSyncUndoState, UndoEvent>(
      {
        id: 'popup-cloud-sync-undo',
        transition: transitionCloudSyncUndo,
        effects: {
          undoing: (stay) => {
            void undoCloudSyncSnapshot(stay.state().snapshotId).then((result) =>
              stay.send({ type: 'done', result }),
            );
          },
          settled: (stay) => settled.current(stay.state().result),
        },
      },
      IDLE,
    );
    const unsubscribe = started.subscribe((next) => setState(next));
    machine.current = started;
    return () => {
      unsubscribe();
      machine.current = null;
      void started.stop();
    };
  }, []);

  const offer = useCallback(
    (snapshotId: string) => machine.current?.send({ type: 'offer', snapshotId }),
    [],
  );
  const withdraw = useCallback(() => machine.current?.send({ type: 'withdraw' }), []);
  const undo = useCallback(() => machine.current?.send({ type: 'undo' }), []);

  return {
    /** An Undo button is shown: right after the download, or again after a failed undo. */
    offered: state.status === 'offered' || canRetry(state),
    busy: state.status === 'undoing',
    offer,
    withdraw,
    undo,
  };
}

export type CloudSyncUndo = ReturnType<typeof useCloudSyncUndo>;
