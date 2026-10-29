import type { StorageWriteKey } from './cloudSyncSnapshotTypes';

/** Existing owners admit undo alongside their ordinary writes in this context. */
export type CloudSyncUndoOwner = <T>(operation: () => Promise<T>) => Promise<T>;

interface UndoOwnerRegistration {
  readonly run: CloudSyncUndoOwner;
  readonly assertWritable?: () => void;
}

class CloudSyncUndoOwners {
  private readonly owners = new Map<string, UndoOwnerRegistration>();

  register(key: string, run: CloudSyncUndoOwner, assertWritable?: () => void): () => void {
    const owner = { run, assertWritable };
    this.owners.set(key, owner);
    return () => {
      if (this.owners.get(key) === owner) this.owners.delete(key);
    };
  }

  assertWritable(target: StorageWriteKey): void {
    if (target.area === 'local') this.owners.get(target.key)?.assertWritable?.();
  }

  run<T>(targets: readonly StorageWriteKey[], operation: () => Promise<T>): Promise<T> {
    const owners = new Set<CloudSyncUndoOwner>();
    for (const target of targets) {
      const owner = target.area === 'local' ? this.owners.get(target.key) : undefined;
      if (owner) owners.add(owner.run);
    }
    // Acquire owner admission before the snapshot queue: an earlier save may still record a receipt.
    const admitted = [...owners].reduceRight<() => Promise<T>>(
      (next, owner) => () => owner(next),
      operation,
    );
    return admitted();
  }
}

const undoOwners = new CloudSyncUndoOwners();

export function registerCloudSyncUndoOwner(
  key: string,
  run: CloudSyncUndoOwner,
  assertWritable?: () => void,
): () => void {
  return undoOwners.register(key, run, assertWritable);
}

/** A synchronous final fence preserves the check-to-write adjacency. */
export function assertCloudSyncUndoOwnerWritable(target: StorageWriteKey): void {
  undoOwners.assertWritable(target);
}

export function runCloudSyncUndoOwners<T>(
  targets: readonly StorageWriteKey[],
  operation: () => Promise<T>,
): Promise<T> {
  return undoOwners.run(targets, operation);
}
