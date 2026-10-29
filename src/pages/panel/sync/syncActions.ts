import { undoCloudSyncSnapshot } from '@/core/services/CloudSyncSnapshotService';
import type { CloudSyncPayload } from '@/core/services/CloudSyncTransferContext';
import type { CloudSyncUndoResult } from '@/core/services/cloudSyncSnapshotTypes';
import { StorageKeys } from '@/core/types/common';

import { type RunStep, revertibleFiles } from './syncPlan';
import { type StatusRow, type SyncSend, parseConnection, parseStatusRows } from './syncProtocol';
import type { RunRecord, StepResult } from './syncRunMachine';
import { type SheetPage, resolveRowContext, sharedRowPlatform } from './syncScopes';
import type { SheetData } from './syncSheetMachine';
import {
  type UploadOutcome,
  answerRefusal,
  downloadRow,
  restoreRowFiles,
  uploadRow,
} from './syncTransfer';

/** What the sheet's actions read at the moment they run: the page, its rows, the transport. */
export interface SheetEnvironment {
  readonly send: SyncSend;
  page(): SheetPage;
  /** 通用 and the enabled sites the sheet lists, and the off sites checked for cloud data. */
  rows(): { readonly listed: readonly string[]; readonly idle: readonly string[] };
}

async function highlightSyncEnabled(): Promise<boolean> {
  try {
    const stored: Record<string, unknown> = await chrome.storage.local.get({
      [StorageKeys.HIGHLIGHT_CLOUD_SYNC_ENABLED]: true,
    });
    return stored[StorageKeys.HIGHLIGHT_CLOUD_SYNC_ENABLED] !== false;
  } catch {
    return true;
  }
}

function statusPayload(row: readonly string[], scopes: CloudSyncPayload | null, platform: string) {
  return {
    platform,
    rows: row,
    ...(scopes?.accountScope ? { accountScope: scopes.accountScope } : {}),
    ...(scopes?.timelineHierarchyAccountScope
      ? { timelineHierarchyAccountScope: scopes.timelineHierarchyAccountScope }
      : {}),
    ...(scopes?.highlightAccountScope
      ? { highlightAccountScope: scopes.highlightAccountScope }
      : {}),
  };
}

/** Connection first; statuses only when Drive is connected (metadata reads, never content). */
export async function loadSheet(env: SheetEnvironment, signal: AbortSignal): Promise<SheetData> {
  const connection = parseConnection(
    await env.send({ type: 'gv.sync.getState' }).catch(() => null),
  );
  if (!connection?.connected) return { connection, rows: [], unconfirmed: [], loaded: true };
  const page = env.page();
  const { listed, idle } = env.rows();
  const highlights = await highlightSyncEnabled();
  // One request carries one platform: the shared row's, whose own-page scopes go with it.
  const platform = sharedRowPlatform(page);
  const unconfirmed: string[] = [];
  let own: CloudSyncPayload | null = null;
  for (const row of listed) {
    try {
      const context = await resolveRowContext(row, page, highlights);
      if (row === page.ownPlatform && row === platform) own = context.payload;
    } catch {
      // No page here names this row's account: it shows 无法确认账号 and never syncs.
      unconfirmed.push(row);
    }
  }
  if (signal.aborted) throw new Error('superseded');
  const requested = [...listed, ...idle];
  const reply = await env
    .send({ type: 'gv.sync.getStatus', payload: statusPayload(requested, own, platform) })
    .catch(() => null);
  const parsed = parseStatusRows(reply);
  const byRow = new Map((parsed ?? []).map((row) => [row.row, row]));
  const rows = requested.map((row): StatusRow => {
    const status = byRow.get(row);
    if (!parsed) return blankRow(row, 'failed');
    // The background leaves out another isolated platform's row rather than guess its account.
    if (!status || unconfirmed.includes(row)) return blankRow(row, 'account_unconfirmed');
    return status;
  });
  for (const row of rows)
    if (
      row.status === 'account_unconfirmed' &&
      listed.includes(row.row) &&
      !unconfirmed.includes(row.row)
    )
      unconfirmed.push(row.row);
  return { connection, rows, unconfirmed, loaded: true };
}

function blankRow(row: string, status: 'failed' | 'account_unconfirmed'): StatusRow {
  return { row, included: true, status, bothChanged: false, files: [] };
}

/** The popup's way in: Google Drive as the provider, sync on, then the interactive sign-in. */
export async function connectDrive(send: SyncSend): Promise<boolean> {
  const state = parseConnection(await send({ type: 'gv.sync.getState' }).catch(() => null));
  const reverts: (() => Promise<unknown>)[] = [];
  try {
    if (state && state.provider !== 'googleDrive') {
      await send({ type: 'gv.sync.setProvider', payload: { provider: 'googleDrive' } });
      reverts.push(() =>
        send({ type: 'gv.sync.setProvider', payload: { provider: state.provider } }),
      );
    }
    if (!state || state.mode === 'disabled') {
      await send({ type: 'gv.sync.setMode', payload: { mode: 'manual' } });
      reverts.push(() => send({ type: 'gv.sync.setMode', payload: { mode: 'disabled' } }));
    }
    const reply = parseConnection(
      await send({ type: 'gv.sync.authenticate', payload: { interactive: true } }),
    );
    if (reply?.connected) return true;
  } catch {
    // Falls through to put the settings back.
  }
  for (const revert of reverts.reverse()) await revert().catch(() => undefined);
  return false;
}

export async function disconnectDrive(send: SyncSend): Promise<void> {
  await send({ type: 'gv.sync.signOut' }).catch(() => undefined);
}

/** md5 of the named cloud files right now, read the way the row's upload named them. */
async function cloudChecksums(
  send: SyncSend,
  row: string,
  scopes: CloudSyncPayload,
  files: readonly string[],
): Promise<Record<string, string>> {
  const reply = await send({
    type: 'gv.sync.getStatus',
    payload: statusPayload([row], scopes, scopes.platform),
  }).catch(() => null);
  const status = parseStatusRows(reply)?.find((candidate) => candidate.row === row);
  return Object.fromEntries(
    (status?.files ?? [])
      .filter((file) => files.includes(file.name) && file.md5 !== null)
      .map((file) => [file.name, file.md5 ?? '']),
  );
}

/** 恢复上一版: every included row's cloud files go back to their latest history copy. */
export async function restorePrevious(
  env: SheetEnvironment,
  rows: readonly StatusRow[],
): Promise<{ restored: number; failed: number }> {
  const page = env.page();
  const highlights = await highlightSyncEnabled();
  let restored = 0;
  let failed = 0;
  for (const row of rows) {
    const files = row.files.filter((file) => file.md5 !== null).map((file) => file.name);
    if (!files.length) continue;
    try {
      const result = await restoreRowFiles(
        env.send,
        (await resolveRowContext(row.row, page, highlights)).payload,
        files,
      );
      restored += result.restored;
      failed += result.failed;
    } catch {
      failed += files.length;
    }
  }
  return { restored, failed };
}

/** One step of a run; `before` is each row's status when the run started. */
export function createStepRunner(
  env: SheetEnvironment,
  before: () => ReadonlyMap<string, StatusRow>,
) {
  const uploaded = async (row: string, outcome: UploadOutcome): Promise<StepResult> => {
    if (outcome.kind === 'refused') return outcome;
    if (outcome.kind === 'failed') {
      const { kind: _failed, ...failure } = outcome;
      return { kind: 'failed', failure: { op: 'upload', ...failure } };
    }
    const { payload } = outcome;
    const files = revertibleFiles(before().get(row));
    const md5 = files.length ? await cloudChecksums(env.send, row, payload, files) : {};
    return { kind: 'done', upload: { row, payload, files, md5 }, unrecorded: outcome.unrecorded };
  };
  return async (
    step: RunStep,
    signal: AbortSignal,
    runSnapshotId: string | undefined,
  ): Promise<StepResult> => {
    const page = env.page();
    const { op, row } = step;
    let context;
    try {
      context = await resolveRowContext(row, page, await highlightSyncEnabled());
    } catch {
      const error = 'account_unconfirmed';
      return {
        kind: 'failed',
        failure: op === 'download' ? { op, failure: { cause: error } } : { op, error },
      };
    }
    if (step.answer) {
      // Either answer acts only for the accounts the refusal was for.
      const answered = await answerRefusal(env.send, context, page, step.answer);
      if (answered.kind !== 'merge') return uploaded(row, answered);
    }
    if (op === 'upload') return uploaded(row, await uploadRow(env.send, context, page));
    const outcome = await downloadRow(
      env.send,
      context,
      page,
      signal,
      runSnapshotId ? { snapshotId: runSnapshotId } : 'start',
    );
    return outcome.kind === 'downloaded'
      ? { kind: 'done', snapshotId: outcome.snapshotId, unrecorded: outcome.unrecorded }
      : {
          kind: 'failed',
          failure: { op, failure: outcome.failure },
          snapshotId: outcome.snapshotId,
        };
  };
}

/** The toast's 撤销 undoes the whole run: offered while one snapshot holds every download. */
export function canUndo(record: RunRecord): boolean {
  return record.snapshots.length <= 1 && (record.snapshots.length > 0 || record.uploads.length > 0);
}

/** What undoing a run did. `stopped`: its download snapshot was not undone, so nothing was. */
export type RunUndoResult =
  | { readonly kind: 'stopped'; readonly snapshot: CloudSyncUndoResult }
  | {
      readonly kind: 'undone';
      /** The snapshot's own result, when the run downloaded. */
      readonly snapshot: CloudSyncUndoResult | null;
      /** Cloud files changed since the run, so kept. */
      readonly keptFiles: boolean;
      /** Cloud files that could not be put back; a retry tries them again. */
      readonly failedFiles: boolean;
      /** Whether anything was there to undo at all. */
      readonly anything: boolean;
    };

/**
 * Undoes a run: its own download snapshot by id (a later download's is never
 * touched, and a superseded or failed one stops everything), then each
 * uploaded file whose cloud copy is still the one this run wrote goes back to
 * its previous version. A file changed since is kept, as a later local edit is;
 * that check also makes a retry skip the files already put back.
 */
export async function undoRun(env: SheetEnvironment, record: RunRecord): Promise<RunUndoResult> {
  const [snapshotId] = record.snapshots;
  let snapshot: CloudSyncUndoResult | null = null;
  if (snapshotId) {
    snapshot = await undoCloudSyncSnapshot(snapshotId);
    if (snapshot.status === 'superseded' || snapshot.status === 'failed')
      return { kind: 'stopped', snapshot };
    if (snapshot.status === 'restored')
      await env
        .page()
        .requestTab?.({ type: 'gv.folders.reload' })
        .catch(() => undefined);
  }
  let keptFiles = false;
  let failedFiles = false;
  let restoredFiles = 0;
  for (const upload of record.uploads) {
    const now = await cloudChecksums(env.send, upload.row, upload.payload, upload.files);
    const unchanged = upload.files.filter(
      (name) => upload.md5[name] !== undefined && now[name] === upload.md5[name],
    );
    if (unchanged.length < upload.files.length) keptFiles = true;
    const result = await restoreRowFiles(env.send, upload.payload, unchanged);
    restoredFiles += result.restored;
    if (result.failed) failedFiles = true;
  }
  return {
    kind: 'undone',
    snapshot,
    keptFiles,
    failedFiles,
    anything: restoredFiles > 0 || (snapshot?.status === 'restored' && snapshot.restoredKeys > 0),
  };
}
