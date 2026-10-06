import type { SyncAccountScope } from '@/core/types/sync';
import { isSafariICloudConflictError } from '@/core/utils/safariICloudSync';
import { EXTENSION_VERSION } from '@/core/utils/version';
import type { StarStore } from '@/features/savedLibrary/starStore';
import { mergeStarState, type StarState } from '@/features/savedLibrary/starSyncData';
import {
  buildStarsV2,
  decodeStarSyncSources,
  type StarSyncSources,
} from '@/features/savedLibrary/starSyncPayload';

import { legacyStarredExport } from './legacyStarredExport';

export interface StarTransferPort {
  identity: string;
  assertActive(): void;
  read(): Promise<StarSyncSources>;
  writeV2(payload: unknown): Promise<void>;
  /** The legacy v1 twin; absent for a file older versions never read. */
  writeV1?(payload: unknown): Promise<void>;
  /** The part of the local stars this file holds, given what the file held when read. */
  select?(local: StarState, remote: StarState): StarState;
}

function fingerprint(state: StarState): string {
  const records = (items: object[]) =>
    items
      .map((item) => JSON.stringify(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))))
      .sort();
  return JSON.stringify([
    records(Object.values(state.data.messages).flat()),
    records(state.tombstones),
  ]);
}

export class StarDriveSyncCoordinator {
  private readonly queues = new Map<string, Promise<void>>();

  push(store: StarStore, port: StarTransferPort, scope: SyncAccountScope | null): Promise<void> {
    const previous = this.queues.get(port.identity) ?? Promise.resolve();
    const pending = previous.catch(() => {}).then(() => this.transfer(store, port, scope));
    this.queues.set(port.identity, pending);
    void pending
      .finally(() => {
        if (this.queues.get(port.identity) === pending) this.queues.delete(port.identity);
      })
      .catch(() => {});
    return pending;
  }

  private async transfer(
    store: StarStore,
    port: StarTransferPort,
    scope: SyncAccountScope | null,
  ): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      port.assertActive();
      const remote = await port.read();
      port.assertActive();
      await store.mergeSync(remote, scope);
      port.assertActive();
      const held = decodeStarSyncSources(remote, scope);
      const select = (local: StarState) => (port.select ? port.select(local, held) : local);
      const snapshot = select(await store.getSyncSnapshot(scope));
      port.assertActive();
      try {
        await port.writeV2(buildStarsV2(snapshot, scope, EXTENSION_VERSION));
        port.assertActive();
        await port.writeV1?.({
          format: 'gemini-voyager.starred.v1',
          exportedAt: new Date().toISOString(),
          version: EXTENSION_VERSION,
          data: legacyStarredExport(snapshot.data),
        });
      } catch (error) {
        if (isSafariICloudConflictError(error)) {
          port.assertActive();
          continue;
        }
        throw error;
      }
      port.assertActive();
      const readback = await port.read();
      port.assertActive();
      const verified = decodeStarSyncSources(readback, scope);
      await store.mergeSync(readback, scope);
      port.assertActive();
      const latest = select(await store.getSyncSnapshot(scope));
      port.assertActive();
      // Verify the latest queued edits too: a deletion made during upload must reach both files.
      const covered = mergeStarState(
        [verified.data, latest.data],
        [...verified.tombstones, ...latest.tombstones],
        Date.now(),
      );
      const actualV2 = decodeStarSyncSources({ v2: readback.v2 }, scope);
      const actualV1 = decodeStarSyncSources(
        { v1: readback.v1, v1AccountHash: readback.v1AccountHash },
        scope,
      );
      const projection = { data: legacyStarredExport(latest.data), tombstones: [] };
      if (
        readback.v2 &&
        fingerprint(actualV2) === fingerprint(covered) &&
        (!port.writeV1 || (readback.v1 && fingerprint(actualV1) === fingerprint(projection)))
      )
        return;
    }
    throw new Error('Star upload could not be verified after 3 merge attempts');
  }
}
