import type { SyncScopeRow } from '@/core/services/CloudSyncScope';
import type { CloudSyncPayload } from '@/core/services/CloudSyncTransferContext';
import type { DownloadFailure } from '@/core/services/cloudSyncNotices';
import type { UploadGuardRefusedFile } from '@/core/types/syncUploadGuard';
import { type Machine, startMachine } from '@/features/plugins/runtime/stateMachine';

import { type RunStep, resumeAfterGuard } from './syncPlan';
import type { UploadRefusal } from './syncTransfer';

/** An upload the toast's 撤销 can put back: the row's account and the files it replaced. */
export interface UploadedRow {
  readonly row: string;
  readonly payload: CloudSyncPayload;
  readonly files: readonly string[];
  /** Each file's cloud checksum right after this run wrote it. */
  readonly md5: Readonly<Record<string, string>>;
}

export interface RunRecord {
  /** Rows whose every step finished, in order. */
  readonly rows: readonly string[];
  /** The snapshot of each download; the slot keeps only the latest. */
  /**
   * The run's snapshot ids, each once: the first download opens the run's
   * snapshot and every later one extends it, so there is one. A second id
   * would be a download outside the run, which one Undo could not cover.
   */
  readonly snapshots: readonly string[];
  readonly uploads: readonly UploadedRow[];
  /** A download applied but its baseline was not recorded (decision E). */
  readonly unrecorded: boolean;
}

/** Why a run stopped, kept raw until the toast turns it into a reason. */
export type RunFailure =
  | {
      readonly op: 'upload';
      readonly error: string;
      readonly excludedRows?: readonly SyncScopeRow[];
      readonly partial?: boolean;
    }
  | { readonly op: 'download'; readonly failure: DownloadFailure };

export type StepResult =
  | {
      readonly kind: 'done';
      readonly snapshotId?: string;
      readonly upload?: UploadedRow;
      readonly unrecorded?: boolean;
    }
  | {
      readonly kind: 'refused';
      readonly files: readonly UploadGuardRefusedFile[];
      /** Either answer runs only while the refused accounts still hold. */
      readonly refusal: UploadRefusal;
    }
  | { readonly kind: 'failed'; readonly failure: RunFailure; readonly snapshotId?: string };

export type RunState =
  | { readonly status: 'idle' }
  | {
      readonly status: 'running';
      readonly steps: readonly RunStep[];
      readonly index: number;
      readonly record: RunRecord;
    }
  | {
      readonly status: 'guard';
      readonly steps: readonly RunStep[];
      readonly index: number;
      readonly record: RunRecord;
      readonly refused: readonly UploadGuardRefusedFile[];
      readonly refusal: UploadRefusal;
    }
  | { readonly status: 'finished'; readonly record: RunRecord; readonly error: RunFailure | null };

export type RunEvent =
  | { readonly type: 'start'; readonly steps: readonly RunStep[] }
  | { readonly type: 'stepDone'; readonly index: number; readonly result: StepResult }
  | { readonly type: 'stepFailed'; readonly result: StepResult }
  | { readonly type: 'complete' }
  | { readonly type: 'choose'; readonly choice: 'mergeInstead' | 'uploadAnyway' }
  | { readonly type: 'abandon' };

const UNKNOWN_FAILURE: RunFailure = { op: 'upload', error: 'sync_failed' };
const EMPTY: RunRecord = { rows: [], snapshots: [], uploads: [], unrecorded: false };

function withSnapshot(snapshots: readonly string[], id: string | undefined): readonly string[] {
  return id && !snapshots.includes(id) ? [...snapshots, id] : snapshots;
}

function withResult(
  record: RunRecord,
  steps: readonly RunStep[],
  index: number,
  result: StepResult,
) {
  if (result.kind !== 'done') return record;
  const row = steps[index]?.row ?? '';
  const last = !steps.slice(index + 1).some((step) => step.row === row);
  return {
    rows: last && !record.rows.includes(row) ? [...record.rows, row] : record.rows,
    snapshots: withSnapshot(record.snapshots, result.snapshotId),
    uploads: result.upload ? [...record.uploads, result.upload] : record.uploads,
    unrecorded: record.unrecorded || result.unrecorded === true,
  };
}

export function transition(state: RunState, event: RunEvent): RunState {
  switch (event.type) {
    case 'start':
      if (state.status === 'running' || state.status === 'guard' || !event.steps.length)
        return state;
      return { status: 'running', steps: event.steps, index: 0, record: EMPTY };
    case 'stepDone':
      if (state.status !== 'running' || event.index !== state.index) return state;
      return {
        ...state,
        index: state.index + 1,
        record: withResult(state.record, state.steps, state.index, event.result),
      };
    case 'stepFailed':
      if (state.status !== 'running') return state;
      // A forced retry whose token no longer matches is refused again: the warning returns.
      if (event.result.kind === 'refused')
        return {
          ...state,
          status: 'guard',
          refused: event.result.files,
          refusal: event.result.refusal,
        };
      return {
        status: 'finished',
        record: event.result.snapshotId
          ? {
              ...state.record,
              snapshots: withSnapshot(state.record.snapshots, event.result.snapshotId),
            }
          : state.record,
        error: event.result.kind === 'failed' ? event.result.failure : UNKNOWN_FAILURE,
      };
    case 'complete':
      return state.status === 'running'
        ? { status: 'finished', record: state.record, error: null }
        : state;
    case 'choose':
      if (state.status !== 'guard') return state;
      return {
        status: 'running',
        steps: resumeAfterGuard(state.steps, state.index, event.choice, state.refusal),
        index: state.index,
        record: state.record,
      };
    case 'abandon':
      // Closing the sheet on the warning ends the run; the refused row and those after it wait.
      return state.status === 'guard'
        ? { status: 'finished', record: state.record, error: null }
        : state;
    default:
      return state;
  }
}

export interface RunDeps {
  /** `runSnapshotId`: the run's snapshot once a download opened it, which later downloads extend. */
  runStep(
    step: RunStep,
    signal: AbortSignal,
    runSnapshotId: string | undefined,
  ): Promise<StepResult>;
}

/** One run at a time; the running stay works through the steps and stops at a refusal. */
export function startRunMachine(deps: RunDeps): Machine<RunState, RunEvent> {
  return startMachine<RunState, RunEvent>(
    {
      id: 'panel-sync-run',
      transition,
      effects: {
        running(stay) {
          void (async () => {
            for (;;) {
              const { steps, index, record } = stay.state();
              const step = steps[index];
              if (!step) {
                stay.send({ type: 'complete' });
                return;
              }
              const result = await deps
                .runStep(step, stay.signal, record.snapshots[0])
                .catch((error: unknown): StepResult => ({
                  kind: 'failed',
                  failure:
                    step.op === 'download'
                      ? { op: 'download', failure: { cause: error } }
                      : { op: 'upload', error: 'sync_failed' },
                }));
              if (stay.signal.aborted) return;
              if (result.kind !== 'done') {
                stay.send({ type: 'stepFailed', result });
                return;
              }
              stay.send({ type: 'stepDone', index, result });
              // The machine handles events in order; the next state() reads the advanced index.
              await Promise.resolve();
              if (stay.signal.aborted) return;
            }
          })();
        },
      },
    },
    { status: 'idle' },
  );
}
