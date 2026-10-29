import { CloudSyncFailure, cloudSyncFailureCode } from '@/core/services/CloudSyncFailure';
import {
  assertCloudSyncSnapshotRun,
  captureCloudSyncSnapshot,
  finishCloudSyncRunRow,
  type SnapshotContext,
} from '@/core/services/CloudSyncSnapshotService';

export type CloudSyncSnapshotRunRequest = 'start' | { snapshotId: string };
type RunRow = { snapshotId: string; operationId: string };

/** Runtime data is parsed once; omitted preserves independent-download behavior. */
export function parseCloudSyncSnapshotRun(value: unknown): CloudSyncSnapshotRunRequest | undefined {
  if (value === undefined || value === 'start') return value;
  if (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    'snapshotId' in value &&
    typeof value.snapshotId === 'string' &&
    value.snapshotId.length > 0 &&
    Object.keys(value).length === 1
  )
    return { snapshotId: value.snapshotId };
  throw new CloudSyncFailure('invalid_sync_request', 'invalid_sync_request');
}

/** Bind the sender document when the browser supplies documentId, plus its page/tab/frame. */
export function cloudSyncSnapshotRunOwner(sender: chrome.runtime.MessageSender): string {
  return JSON.stringify([sender.id, sender.url, sender.tab?.id, sender.frameId, sender.documentId]);
}

/** Check a continuation before any network read; capture repeats this fence after preflight. */
export async function assertCloudSyncSnapshotRunRequest(
  request: CloudSyncSnapshotRunRequest | undefined,
  sender: chrome.runtime.MessageSender,
): Promise<void> {
  if (request && request !== 'start')
    await assertCloudSyncSnapshotRun(request.snapshotId, cloudSyncSnapshotRunOwner(sender));
}

export async function captureCloudSyncSnapshotRun(
  request: CloudSyncSnapshotRunRequest | undefined,
  sender: chrome.runtime.MessageSender,
  context: SnapshotContext,
): Promise<RunRow | undefined> {
  if (!request) return undefined;
  const operationId = crypto.randomUUID();
  try {
    const snapshot = await captureCloudSyncSnapshot({
      context,
      keys: [],
      run: { owner: cloudSyncSnapshotRunOwner(sender), operationId },
      ...(request === 'start' ? {} : { snapshotId: request.snapshotId }),
    });
    return { snapshotId: snapshot.id, operationId };
  } catch (cause) {
    const code = cloudSyncFailureCode(cause);
    if (code === 'snapshot_superseded' || code === 'invalid_sync_request') throw cause;
    throw new CloudSyncFailure(
      'snapshot_failed',
      cause instanceof Error ? cause.message : String(cause),
      { cause },
    );
  }
}

/** Release after the owner settles, preserving its first failure and already-applied result. */
export async function settleCloudSyncRunRow<T>(run: RunRow | undefined, apply: () => Promise<T>) {
  if (!run) return { value: await apply(), releaseFailed: false };
  const outcome = await apply().then(
    (value) => ({ kind: 'returned' as const, value }),
    (error: unknown) => ({ kind: 'threw' as const, error }),
  );
  const releaseFailed = await finishCloudSyncRunRow(run.snapshotId, run.operationId).then(
    () => false,
    () => true,
  );
  if (outcome.kind === 'threw') throw outcome.error;
  return { value: outcome.value, releaseFailed };
}
