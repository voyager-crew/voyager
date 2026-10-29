import { StorageKeys } from '@/core/types/common';
import { startMachine } from '@/features/plugins/runtime/stateMachine';
import {
  isRestorablePluginState,
  restorePluginState,
} from '@/features/plugins/storage/pluginState';
import type { TranslationKey } from '@/utils/translations';

import type { CloudApplySkip } from './CloudSyncApplyPlan';
import {
  type SnapshotContext,
  type CloudSyncAppliedValue,
  type CloudSyncKind,
  type StorageWriteKey,
  captureCloudSyncSnapshot,
  finishCloudSyncSnapshot,
  recordCloudSyncWrites,
  readCloudSyncSnapshot,
} from './CloudSyncSnapshotService';
import {
  filterBackupableSyncSettings,
  restoreBackupableSyncSettings,
} from './SettingsBackupService';
import { filterRestorableSyncSettings } from './settingsBackupValidation';

export type CloudRestorePart = CloudSyncKind;
export type CloudRestoreMode = 'merge' | 'overwrite';

export class CloudRestoreError extends Error {
  constructor(
    readonly restored: readonly CloudRestorePart[],
    readonly failed: readonly CloudRestorePart[],
    cause: unknown,
    readonly reason?: TranslationKey,
    readonly skipped: readonly CloudApplySkip[] = [],
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = 'CloudRestoreError';
  }
}

/** An owner declares its storage targets before its operation can run. */
export interface CloudRestoreStep {
  readonly parts: readonly CloudRestorePart[];
  readonly keys: readonly StorageWriteKey[];
  readonly run: (snapshotId: string) => Promise<boolean>;
}

export interface CloudRestoreInput {
  readonly mode: CloudRestoreMode;
  readonly highlightsRestored: boolean;
  readonly plugins?: Record<string, unknown>;
  readonly settings?: unknown;
  readonly storageUpdate: Record<string, unknown>;
  readonly storageParts?: readonly CloudRestorePart[];
  readonly storageKinds?: Readonly<Record<string, CloudSyncKind>>;
  readonly owners?: readonly CloudRestoreStep[];
  readonly snapshot: SnapshotContext;
  readonly snapshotId?: string;
  readonly skipped?: readonly CloudApplySkip[];
  readonly refusal?: Error;
  /** Rechecked after every async boundary, before another owner may write. */
  readonly current?: () => Promise<boolean>;
  readonly signal?: AbortSignal;
}

export interface CloudRestoreResult {
  readonly restored: readonly CloudRestorePart[];
  readonly skipped: readonly CloudApplySkip[];
  readonly snapshotId?: string;
}

type Progress = { index: number; restored: CloudRestorePart[] };
type AppliedProgress = Progress & { snapshotId: string };
type ApplyState =
  | ({ status: 'capturing' } & Progress)
  | ({ status: 'checking' } & AppliedProgress)
  | ({ status: 'writing' } & AppliedProgress)
  | ({ status: 'done' } & AppliedProgress)
  | ({ status: 'failed'; error: unknown; snapshotId?: string } & Progress);
type ApplyEvent =
  | { type: 'captured'; snapshotId: string }
  | { type: 'checked' }
  | { type: 'applied'; wrote: boolean }
  | { type: 'failed'; error: unknown };

/** Persist a single snapshot before the first owner, retaining it on partial failure. */
export async function applyCloudRestore(input: CloudRestoreInput): Promise<CloudRestoreResult> {
  const steps: CloudRestoreStep[] = [];
  const beforeWrite = async (snapshotId: string, writes: readonly CloudSyncAppliedValue[]) => {
    await recordCloudSyncWrites(snapshotId, writes);
    if (input.signal?.aborted || !((await input.current?.()) ?? true) || input.signal?.aborted)
      throw new Error('Download cancelled');
  };
  const emptyPluginOverwrite =
    input.mode === 'overwrite' &&
    input.plugins !== undefined &&
    Object.keys(input.plugins).length === 0;
  if (input.plugins !== undefined && !emptyPluginOverwrite) {
    steps.push({
      parts: ['plugins'],
      keys: [{ area: 'local', key: StorageKeys.PLUGINS_STATE }],
      run: async (snapshotId) => {
        if (!isRestorablePluginState(input.plugins)) return false;
        await restorePluginState(input.plugins, input.mode, (value) =>
          beforeWrite(snapshotId, [
            { area: 'local', key: StorageKeys.PLUGINS_STATE, kind: 'plugins', value },
          ]),
        );
        return true;
      },
    });
  }
  const settings = filterBackupableSyncSettings(filterRestorableSyncSettings(input.settings));
  if (Object.keys(settings).length) {
    steps.push({
      parts: ['settings'],
      keys: Object.keys(settings).map((key) => ({ area: 'sync', key })),
      run: async (snapshotId) => {
        const values = await restoreBackupableSyncSettings(
          settings,
          undefined,
          input.mode,
          (values) =>
            beforeWrite(
              snapshotId,
              Object.entries(values).map(([key, value]) => ({
                area: 'sync',
                key,
                kind: 'settings',
                value,
              })),
            ),
        );
        return Object.keys(values).length > 0;
      },
    });
  }
  if (Object.keys(input.storageUpdate).length) {
    steps.push({
      parts: input.storageParts ?? ['folders'],
      keys: Object.keys(input.storageUpdate).map((key) => ({ area: 'local', key })),
      run: async (snapshotId) => {
        const values = structuredClone(input.storageUpdate);
        await beforeWrite(
          snapshotId,
          Object.entries(values).map(([key, value]) => ({
            area: 'local',
            key,
            value,
            kind: input.storageKinds?.[key] ?? input.storageParts?.[0] ?? 'folders',
          })),
        );
        await chrome.storage.local.set(values);
        return true;
      },
    });
  }
  steps.push(...(input.owners ?? []));
  const restored: CloudRestorePart[] = input.highlightsRestored ? ['highlights'] : [];
  const skipped: CloudApplySkip[] = [...(input.skipped ?? [])];
  if (emptyPluginOverwrite && !skipped.some((skip) => skip.kind === 'plugins'))
    skipped.push({ kind: 'plugins', reason: 'empty-plugin-map' });
  if (input.refusal)
    throw new CloudRestoreError(
      restored,
      steps.flatMap((s) => s.parts),
      input.refusal,
      undefined,
      skipped,
    );
  if (!steps.length) return { restored, skipped, snapshotId: input.snapshotId };

  let complete!: (value: CloudRestoreResult) => void;
  let fail!: (error: CloudRestoreError) => void;
  const result = new Promise<CloudRestoreResult>((resolve, reject) => {
    complete = resolve;
    fail = reject;
  });
  const machine = startMachine<ApplyState, ApplyEvent>(
    {
      id: 'cloud-download-apply',
      transition(state, event) {
        if (state.status === 'done' || state.status === 'failed') return state;
        switch (event.type) {
          case 'failed':
            return { ...state, status: 'failed', error: event.error };
          case 'captured':
            return state.status === 'capturing'
              ? { ...state, status: 'checking', snapshotId: event.snapshotId }
              : state;
          case 'checked':
            return state.status === 'checking' ? { ...state, status: 'writing' } : state;
          case 'applied': {
            if (state.status !== 'writing') return state;
            const restored = event.wrote
              ? [...state.restored, ...steps[state.index].parts]
              : state.restored;
            return {
              ...state,
              status: state.index + 1 === steps.length ? 'done' : 'checking',
              index: state.index + 1,
              restored,
            };
          }
          default: {
            const _exhaustive: never = event;
            return _exhaustive;
          }
        }
      },
      effects: {
        capturing(stay) {
          void (async () => {
            if (input.signal?.aborted || !((await input.current?.()) ?? true))
              throw new Error('Download cancelled');
            if (stay.signal.aborted) return;
            const snapshot = await captureCloudSyncSnapshot({
              context: input.snapshot,
              keys: steps.flatMap((step) => step.keys),
              snapshotId: input.snapshotId,
            });
            if (stay.signal.aborted) {
              await finishCloudSyncSnapshot(snapshot.id);
              return;
            }
            stay.send({ type: 'captured', snapshotId: snapshot.id });
          })().catch((error) => stay.send({ type: 'failed', error }));
        },
        checking(stay) {
          void (async () => {
            if ((await readCloudSyncSnapshot())?.id !== stay.state().snapshotId)
              throw new Error('Cloud snapshot is no longer current');
            if (
              input.signal?.aborted ||
              !((await input.current?.()) ?? true) ||
              stay.signal.aborted
            )
              throw new Error('Download cancelled');
            stay.send({ type: 'checked' });
          })().catch((error) => stay.send({ type: 'failed', error }));
        },
        writing(stay) {
          const operation = steps[stay.state().index].run(stay.state().snapshotId);
          stay.scope.effect(
            () => async () => {
              await operation.catch(() => undefined);
            },
            'finish-owner-receipt',
          );
          void operation.then(
            (wrote) => stay.send({ type: 'applied', wrote }),
            (error) => stay.send({ type: 'failed', error }),
          );
        },
        done(stay) {
          complete({
            restored: stay.state().restored,
            skipped,
            snapshotId: stay.state().snapshotId,
          });
        },
        failed(stay) {
          const state = stay.state();
          fail(
            new CloudRestoreError(
              state.restored,
              steps.slice(state.index).flatMap((s) => s.parts),
              state.error,
              undefined,
              skipped,
            ),
          );
        },
      },
    },
    { status: 'capturing', index: 0, restored },
  );
  const abort = () => machine.send({ type: 'failed', error: new Error('Download cancelled') });
  input.signal?.addEventListener('abort', abort, { once: true });
  const outcome = await result.then(
    (value) => ({ ok: true, value }) as const,
    (error: unknown) => ({ ok: false, error }) as const,
  );
  input.signal?.removeEventListener('abort', abort);
  await machine.stop();
  const state = machine.state;
  if ('snapshotId' in state && state.snapshotId !== undefined) {
    try {
      await finishCloudSyncSnapshot(state.snapshotId);
    } catch (error) {
      // Cleanup must not hide which owner a failed write-ahead receipt prevented.
      if (outcome.ok) throw new CloudRestoreError(state.restored, [], error, undefined, skipped);
    }
  }
  if (!outcome.ok) throw outcome.error;
  return outcome.value;
}
