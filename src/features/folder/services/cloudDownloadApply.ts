import { CloudSyncFailure } from '@/core/services/CloudSyncFailure';
import {
  captureCloudSyncSnapshot,
  finishCloudSyncSnapshot,
  readCloudSyncSnapshot,
  type SnapshotContext,
  type StorageWriteKey,
} from '@/core/services/CloudSyncSnapshotService';
import { startMachine, type Stay } from '@/features/plugins/runtime/stateMachine';

import {
  FolderCloudApplyError,
  type FolderCloudApplyPart,
  type FolderCloudApplyResult,
} from './cloudDownloadApplyResult';

export { FolderCloudApplyError, type FolderCloudApplyResult } from './cloudDownloadApplyResult';

type Phase = 'snapshot' | 'folders' | 'extras' | 'catalog';
type Progress = {
  snapshotId?: string;
  restored: FolderCloudApplyPart[];
  catalogRestored: boolean;
};
type Termination =
  | { status: 'active' }
  | { status: 'cancelled' }
  | { status: 'failed'; error: unknown };
type ActiveState = {
  [K in Phase]: Progress & { status: K; termination: Termination };
}[Phase];
type State =
  | ActiveState
  | (Progress & { status: 'finishing'; termination: Termination })
  | (Progress & { status: 'finished' | 'cancelled' })
  | (Progress & { status: 'failed'; error: unknown });

type Event =
  | { type: 'snapshotted'; snapshotId?: string }
  | { type: 'foldersSaved'; restored: boolean }
  | { type: 'extrasSaved'; restored: boolean }
  | { type: 'catalogSaved'; restored: boolean }
  | { type: 'cancel' }
  | { type: 'stopped' }
  | { type: 'fail'; error: unknown }
  | { type: 'finished' }
  | { type: 'finishFailed'; error: unknown };

function transition(state: State, event: Event): State {
  if (!('termination' in state)) return state;
  const progress: Progress = {
    snapshotId: state.snapshotId,
    restored: state.restored,
    catalogRestored: state.catalogRestored,
  };
  const next = (status: Phase | 'finished', changes: Partial<Progress> = {}): State => {
    const settled = { ...progress, ...changes };
    if (state.termination.status !== 'active' || status === 'finished')
      return { ...settled, status: 'finishing', termination: state.termination };
    return { ...settled, status, termination: { status: 'active' } };
  };
  switch (event.type) {
    case 'cancel':
      // Keep this stay alive so its already-issued owner can report the value it committed.
      return state.termination.status === 'active'
        ? { ...state, termination: { status: 'cancelled' } }
        : state;
    case 'stopped':
      return {
        ...progress,
        status: 'finishing',
        termination:
          state.termination.status === 'active' ? { status: 'cancelled' } : state.termination,
      };
    case 'fail':
      return {
        ...progress,
        status: 'finishing',
        termination:
          state.termination.status === 'active'
            ? { status: 'failed', error: event.error }
            : state.termination,
      };
    case 'finished':
    case 'finishFailed': {
      if (state.status !== 'finishing') return state;
      const termination =
        state.termination.status === 'active' && event.type === 'finishFailed'
          ? { status: 'failed' as const, error: event.error }
          : state.termination;
      if (termination.status === 'failed')
        return { ...progress, status: 'failed', error: termination.error };
      return { ...progress, status: termination.status === 'cancelled' ? 'cancelled' : 'finished' };
    }
    case 'snapshotted':
      return state.status === 'snapshot'
        ? next('folders', { snapshotId: event.snapshotId })
        : state;
    case 'foldersSaved':
      return state.status === 'folders'
        ? next('extras', {
            restored: event.restored ? [...state.restored, 'folders'] : state.restored,
          })
        : state;
    case 'extrasSaved':
      return state.status === 'extras'
        ? next('catalog', {
            restored: event.restored ? [...state.restored, 'extras'] : state.restored,
          })
        : state;
    case 'catalogSaved':
      return state.status === 'catalog'
        ? next('finished', {
            catalogRestored: event.restored,
            restored: event.restored ? [...state.restored, 'catalog'] : state.restored,
          })
        : state;
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

/** Each phase drains its issued work; cancellation prevents any later owner from starting. */
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
  let complete!: () => void;
  const completion = new Promise<void>((resolve) => {
    complete = resolve;
  });
  const run = (stay: Stay<ActiveState, Event>, operation: () => Promise<Event>) => {
    stay.scope.on(window, 'pagehide', () => stay.send({ type: 'cancel' }));
    const stopped = () => !options.current() || stay.state().termination.status !== 'active';
    const pending = (async () => {
      if (stopped()) {
        stay.send({ type: 'stopped' });
        return;
      }
      const state = stay.state();
      if (state.status !== 'snapshot' && state.snapshotId !== undefined) {
        const snapshot = await readCloudSyncSnapshot();
        if (stopped()) {
          stay.send({ type: 'stopped' });
          return;
        }
        if (snapshot?.id !== state.snapshotId)
          throw new CloudSyncFailure('snapshot_superseded', 'Cloud snapshot is no longer current');
      }
      const event = await operation();
      if (!options.current()) stay.send({ type: 'cancel' });
      stay.send(event);
    })().catch((error: unknown) => stay.send({ type: 'fail', error }));
    stay.scope.effect(
      () => async () => {
        await pending;
      },
      'finish-owner-receipt',
    );
  };
  const runOwner = (
    owner: ((snapshotId: string) => Promise<boolean>) | undefined,
    state: State,
  ): Promise<boolean | undefined> => {
    if (!owner) return Promise.resolve(undefined);
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
              const snapshot = await captureCloudSyncSnapshot({
                context: options.context,
                keys: options.keys,
                snapshotId: options.snapshotId,
              }).catch((cause: unknown) => {
                throw new CloudSyncFailure(
                  'snapshot_failed',
                  cause instanceof Error ? cause.message : String(cause),
                  { cause },
                );
              });
              return { type: 'snapshotted', snapshotId: snapshot.id };
            }
            return { type: 'snapshotted' };
          }),
        folders: (stay) =>
          run(stay, async () => {
            const saved = await runOwner(options.saveFolders, stay.state());
            return saved === false
              ? { type: 'stopped' }
              : { type: 'foldersSaved', restored: saved === true };
          }),
        extras: (stay) =>
          run(stay, async () => {
            const saved = await runOwner(options.restoreExtras, stay.state());
            return saved === false
              ? { type: 'stopped' }
              : { type: 'extrasSaved', restored: saved === true };
          }),
        catalog: (stay) =>
          run(stay, async () => ({
            type: 'catalogSaved',
            restored: (await runOwner(options.restoreCatalog, stay.state())) === true,
          })),
        finishing: (stay) => {
          stay.scope.on(window, 'pagehide', () => stay.send({ type: 'cancel' }));
          void (async () => {
            if (!options.current()) stay.send({ type: 'cancel' });
            const { snapshotId } = stay.state();
            if (snapshotId) await finishCloudSyncSnapshot(snapshotId);
            if (!options.current()) stay.send({ type: 'cancel' });
            stay.send({ type: 'finished' });
          })().catch((error: unknown) => stay.send({ type: 'finishFailed', error }));
        },
        finished: complete,
        cancelled: complete,
        failed: complete,
      },
    },
    {
      status: 'snapshot',
      termination: { status: 'active' },
      snapshotId: options.snapshotId,
      restored: [],
      catalogRestored: false,
    },
  );
  await completion;
  await machine.stop();
  const state = machine.state;
  if (state.status === 'failed')
    throw new FolderCloudApplyError(state.restored, state.error, state.snapshotId);
  const progress = { restored: state.restored, snapshotId: state.snapshotId };
  return state.status === 'finished'
    ? { ...progress, status: 'applied', catalogRestored: state.catalogRestored }
    : { ...progress, status: 'cancelled' };
}
