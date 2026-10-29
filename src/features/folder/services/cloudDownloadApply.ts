import {
  captureCloudSyncSnapshot,
  finishCloudSyncSnapshot,
  readCloudSyncSnapshot,
  type SnapshotContext,
  type StorageWriteKey,
} from '@/core/services/CloudSyncSnapshotService';
import { startMachine, type Stay } from '@/features/plugins/runtime/stateMachine';

type State = { snapshotId?: string } & (
  | { status: 'snapshot' }
  | { status: 'folders' }
  | { status: 'extras' }
  | { status: 'catalog' }
  | { status: 'finished'; catalogRestored: boolean }
  | { status: 'cancelled' }
  | { status: 'failed'; error: unknown }
);

type Event =
  | { type: 'snapshotted'; snapshotId?: string }
  | { type: 'foldersSaved' }
  | { type: 'extrasSaved' }
  | { type: 'catalogSaved'; restored: boolean }
  | { type: 'cancel' }
  | { type: 'fail'; error: unknown };

function transition(state: State, event: Event): State {
  if (['finished', 'cancelled', 'failed'].includes(state.status)) return state;
  switch (event.type) {
    case 'cancel':
      return { ...state, status: 'cancelled' };
    case 'fail':
      return { ...state, status: 'failed', error: event.error };
    case 'snapshotted':
      return state.status === 'snapshot'
        ? { status: 'folders', snapshotId: event.snapshotId }
        : state;
    case 'foldersSaved':
      return state.status === 'folders' ? { ...state, status: 'extras' } : state;
    case 'extrasSaved':
      return state.status === 'extras' ? { ...state, status: 'catalog' } : state;
    case 'catalogSaved':
      return state.status === 'catalog'
        ? { ...state, status: 'finished', catalogRestored: event.restored }
        : state;
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

export type FolderCloudApplyResult =
  | { status: 'applied'; catalogRestored: boolean }
  | { status: 'cancelled' };

/** Each phase may finish late; only the active stay can start the next write. */
export async function applyFolderCloudDownload(options: {
  context: SnapshotContext;
  keys: readonly StorageWriteKey[];
  /** Extend a slot the background began before returning the download. */
  snapshotId?: string;
  current(): boolean;
  saveFolders?: (snapshotId: string) => Promise<boolean>;
  restoreExtras?: (snapshotId: string) => Promise<boolean>;
  restoreCatalog?: (snapshotId: string) => Promise<boolean>;
}): Promise<FolderCloudApplyResult> {
  let resolve!: (result: FolderCloudApplyResult) => void;
  let reject!: (error: unknown) => void;
  const completion = new Promise<FolderCloudApplyResult>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  const run = (stay: Stay<State, Event>, operation: () => Promise<Event>) => {
    stay.scope.on(window, 'pagehide', () => stay.send({ type: 'cancel' }));
    void (async () => {
      if (!options.current()) {
        stay.send({ type: 'cancel' });
        return;
      }
      const state = stay.state();
      if (state.status !== 'snapshot' && state.snapshotId !== undefined) {
        const snapshot = await readCloudSyncSnapshot();
        if (stay.signal.aborted) return;
        if (!options.current()) {
          stay.send({ type: 'cancel' });
          return;
        }
        if (snapshot?.id !== state.snapshotId)
          throw new Error('Cloud snapshot is no longer current');
      }
      if (stay.signal.aborted) return;
      const pending = operation();
      if (state.status !== 'snapshot')
        stay.scope.effect(
          () => async () => {
            await pending.catch(() => undefined);
          },
          'finish-owner-receipt',
        );
      const event = await pending;
      if (stay.signal.aborted) return;
      stay.send(options.current() ? event : { type: 'cancel' });
    })().catch((error: unknown) => {
      if (!stay.signal.aborted) stay.send({ type: 'fail', error });
    });
  };
  const runOwner = (
    owner: ((snapshotId: string) => Promise<boolean>) | undefined,
    state: State,
    absent: boolean,
  ) => {
    if (!owner) return Promise.resolve(absent);
    if (!state.snapshotId) return Promise.reject(new Error('Cloud snapshot is missing'));
    return owner(state.snapshotId);
  };
  const machine = startMachine<State, Event>(
    {
      id: 'folder-cloud-download-apply',
      transition,
      effects: {
        snapshot: (stay) =>
          run(stay, async () => {
            if (
              options.keys.length > 0 ||
              options.snapshotId !== undefined ||
              options.saveFolders ||
              options.restoreExtras ||
              options.restoreCatalog
            ) {
              // No owner starts writing until the entire slot is durable.
              const snapshot = await captureCloudSyncSnapshot({
                context: options.context,
                keys: options.keys,
                snapshotId: options.snapshotId,
              });
              if (stay.signal.aborted) await finishCloudSyncSnapshot(snapshot.id);
              return { type: 'snapshotted', snapshotId: snapshot.id };
            }
            return { type: 'snapshotted' };
          }),
        folders: (stay) =>
          run(stay, async () =>
            (await runOwner(options.saveFolders, stay.state(), true))
              ? { type: 'foldersSaved' }
              : { type: 'cancel' },
          ),
        extras: (stay) =>
          run(stay, async () =>
            (await runOwner(options.restoreExtras, stay.state(), true))
              ? { type: 'extrasSaved' }
              : { type: 'cancel' },
          ),
        catalog: (stay) =>
          run(stay, async () => ({
            type: 'catalogSaved',
            restored: await runOwner(options.restoreCatalog, stay.state(), false),
          })),
        finished: (stay) =>
          resolve({ status: 'applied', catalogRestored: stay.state().catalogRestored }),
        cancelled: () => resolve({ status: 'cancelled' }),
        failed: (stay) => reject(stay.state().error),
      },
    },
    { status: 'snapshot' },
  );
  try {
    return await completion;
  } finally {
    await machine.stop();
    if (machine.state.snapshotId) await finishCloudSyncSnapshot(machine.state.snapshotId);
  }
}
