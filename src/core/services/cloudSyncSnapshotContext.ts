import { canonicalJson } from '@/core/utils/canonicalHash';

import { CloudSyncFailure } from './CloudSyncFailure';
import type { CloudSyncSnapshot, SnapshotContext } from './cloudSyncSnapshotTypes';

/** Route indexes can move while the account key continues to identify the same local owner. */
export function sameSnapshotContext(a: SnapshotContext, b: SnapshotContext): boolean {
  return (
    a.source === b.source &&
    a.platform === b.platform &&
    a.accountScope?.accountKey === b.accountScope?.accountKey
  );
}

export function mergeSnapshotContexts(
  contexts: readonly SnapshotContext[],
  context: SnapshotContext,
) {
  return contexts.some((held) => canonicalJson(held) === canonicalJson(context))
    ? contexts
    : [...contexts, context];
}

export function assertReadySnapshotRun(
  snapshot: CloudSyncSnapshot | null,
  id: string,
  owner: string,
): asserts snapshot is CloudSyncSnapshot & { run: NonNullable<CloudSyncSnapshot['run']> } {
  if (
    !snapshot ||
    snapshot.kind !== 'snapshot' ||
    snapshot.id !== id ||
    snapshot.run?.owner !== owner
  )
    throw new CloudSyncFailure('snapshot_superseded', 'Cloud snapshot is no longer current');
  // Complete the issued row before admitting the next one, so late receipts cannot change owners.
  if (snapshot.run.active)
    throw new CloudSyncFailure(
      'invalid_sync_request',
      'Complete the current sync row before starting another',
    );
}
